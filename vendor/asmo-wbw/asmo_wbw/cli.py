"""asmo-wbw command line.

    python -m asmo_wbw preview --dir FOLDER
    python -m asmo_wbw batch   --dir FOLDER [--include-low-confidence]
    python -m asmo_wbw undo    TOKEN --store DIR [--yes]
    python -m asmo_wbw doctor
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from . import __version__
from .pipeline import (
    batch_boot,
    default_store,
    discover_images,
    find_description,
    load_boot,
    preview_boot,
    undo_target,
)


def _collect(args: argparse.Namespace) -> tuple[list[Path], object]:
    images: list[Path] = []
    desc_path = Path(args.description).resolve() if getattr(args, "description", None) else None
    folder = Path(args.dir).resolve() if getattr(args, "dir", None) else None
    if folder:
        images.extend(discover_images(folder))
        if desc_path is None:
            found = find_description(folder)
            if found:
                desc_path = found
    for p in getattr(args, "images", None) or []:
        images.append(Path(p).resolve())
    # Drop duplicates, keep order.
    seen: set[str] = set()
    uniq: list[Path] = []
    for p in images:
        key = str(p)
        if key in seen:
            continue
        seen.add(key)
        uniq.append(p)
    if not uniq:
        raise SystemExit("No image files given. Pass --dir FOLDER or image paths.")
    parsed = load_boot(description_path=desc_path, title=getattr(args, "title", None))
    return uniq, parsed


def cmd_preview(args: argparse.Namespace) -> int:
    images, parsed = _collect(args)
    preview = preview_boot(images, parsed, use_cutout=args.cutout)
    if args.json:
        print(json.dumps(preview, indent=2, ensure_ascii=False))
        return 0
    fields = preview["fields"]
    print(f"listing slug:  {preview['listing_slug']}")
    if fields:
        shown = ", ".join(f"{k}={v!r}" for k, v in fields.items() if k != "condition")
        print(f"fields:        {shown}")
        if "condition" in fields:
            print(f"condition:     {fields['condition']}")
    for n in preview.get("notes") or []:
        print(f"note:          {n}")
    print()
    for row in preview["images"]:
        flag = " CONFIRM" if row["confirm_queue"] else ""
        conf = "" if row["confidence"] is None else f"  conf={row['confidence']:.2f}"
        print(f"PLAN  {row['original_name']}  ->  {row['proposed_name']}  ({row['view']}{conf}{flag})")
        for note in row.get("notes") or []:
            print(f"      {note}")
    if preview["n_confirm"]:
        print(f"\n{preview['n_confirm']} image(s) flagged for the confirm queue (low confidence).")
    return 0


def cmd_batch(args: argparse.Namespace) -> int:
    images, parsed = _collect(args)
    store = Path(args.store).resolve() if args.store else default_store(images)
    result = batch_boot(
        images,
        parsed,
        store,
        include_low_confidence=args.include_low_confidence,
        use_cutout=args.cutout,
    )
    if args.json:
        print(json.dumps(result, indent=2, ensure_ascii=False))
    else:
        print(f"listing slug:  {result['listing_slug']}")
        print(f"store:         {result['store_dir']}")
        print(f"confirm queue: {result['confirm_queue_path']}")
        for row in result["results"]:
            name = row.get("original_name")
            if row.get("ok") and not row.get("skipped"):
                print(f"DONE  {name}  ->  {row['proposed_name']}  [{row.get('op_id')}]")
            elif row.get("skipped"):
                print(f"SKIP  {name}  ({row.get('reason')})")
            else:
                print(f"FAIL  {name}  ({row.get('reason')})")
        print(
            f"renamed {result['n_renamed']}, skipped {result['n_skipped']}, failed {result['n_failed']}"
        )
    return 1 if result["n_failed"] else 0


def cmd_undo(args: argparse.Namespace) -> int:
    if not args.store:
        raise SystemExit("undo requires --store (the .asmo-wbw directory from the batch).")
    result = undo_target(args.token, args.store, force=args.yes)
    print(result["message"])
    return 0 if result["ok"] else 1



def cmd_run(args: argparse.Namespace) -> int:
    """BootLister entry: listing JSON on stdin or --in FILE, result JSON on stdout."""
    import json as _json
    from .contract import ContractError
    from .run import process_payload

    if args.input:
        raw = Path(args.input).read_text(encoding="utf-8")
    else:
        raw = sys.stdin.read()
    if not raw.strip():
        raise SystemExit("No listing JSON on stdin or --in")
    try:
        data = _json.loads(raw)
    except _json.JSONDecodeError as exc:
        raise SystemExit(f"Invalid JSON: {exc}") from exc
    out_dir = Path(args.out_dir).resolve() if args.out_dir else Path.cwd() / "asmo-wbw-out"
    store = Path(args.store).resolve() if args.store else None
    try:
        result = process_payload(
            data,
            out_dir=out_dir,
            store_dir=store,
            fetch=bool(args.fetch),
            use_cutout=bool(getattr(args, "cutout", False)),
        )
    except ContractError as exc:
        print(exc, file=sys.stderr)
        return 2
    print(_json.dumps(result, indent=2, ensure_ascii=False))
    return 0 if result.get("ok") else 1


def cmd_doctor(_args: argparse.Namespace) -> int:
    from .views import _cv2, _try_cutout_mask

    print(f"asmoWBW {__version__}")
    print("folder:        /workspace/asmo-wbw  (does not edit /workspace/asmo-agent)")
    cv2 = _cv2()
    print(f"opencv:        {'yes ' + str(cv2.__version__) if cv2 is not None else 'no (numpy fallback is fine)'}")
    # Probe cut-out without running a file if the module import is enough.
    models = Path("/workspace/photo-to-video/models")
    local_models = [
        p.name
        for p in (
            models / "silueta.onnx",
            models / "u2netp.onnx",
            models / "depth_anything_v2_small.onnx",
        )
        if p.is_file()
    ]
    print(f"local models:  {', '.join(local_models) or 'none found (optional)'}")
    print("cloud AI:      disabled")
    print("uploads:       disabled")
    print("live listings: never written")
    # The cut-out probe is import-only; don't require a photo.
    _ = _try_cutout_mask
    return 0


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="asmo-wbw",
        description="Name western-boot photos from a deep description plus the pictures.",
    )
    p.add_argument("--version", action="version", version=f"asmoWBW {__version__}")
    sub = p.add_subparsers(dest="cmd", required=True)

    def add_io(sp: argparse.ArgumentParser) -> None:
        sp.add_argument("--dir", help="Folder with images and a description.txt")
        sp.add_argument("--description", help="Path to a .txt/.md/.json deep description")
        sp.add_argument("--title", help="Optional listing title (also accepted as a Title: line)")
        sp.add_argument("--cutout", action="store_true", help="Use the local cut-out model if studio backdrop is weak")
        sp.add_argument("--json", action="store_true", help="Print machine-readable JSON")
        sp.add_argument("images", nargs="*", help="Image files (used with --description)")

    pr = sub.add_parser("preview", help="Show proposed names without renaming")
    add_io(pr)
    pr.set_defaults(func=cmd_preview)

    ba = sub.add_parser("batch", help="Rename high-confidence photos (blob-backed, undoable)")
    add_io(ba)
    ba.add_argument("--store", help="Journal directory (default: <folder>/.asmo-wbw)")
    ba.add_argument(
        "--include-low-confidence",
        action="store_true",
        help="Also rename confirm-queue photos",
    )
    ba.set_defaults(func=cmd_batch)

    un = sub.add_parser("undo", help="Restore one file from the journal blob")
    un.add_argument("token", help="op id, current path, or original path")
    un.add_argument("--store", required=True, help="Journal directory")
    un.add_argument("--yes", action="store_true", help="Overwrite if the renamed file changed")
    un.set_defaults(func=cmd_undo)

    run = sub.add_parser("run", help="BootLister entry: listing JSON in, result JSON out")
    run.add_argument("--in", dest="input", help="Path to a listing JSON object or array (default: stdin)")
    run.add_argument("--out-dir", help="Directory for web JPEG/WebP (default: ./asmo-wbw-out)")
    run.add_argument("--store", help="Journal directory for original-byte backups")
    run.add_argument("--fetch", action="store_true", help="Operator-only: fetch photo URLs (never westernbootworld.com or eBay)")
    run.add_argument("--cutout", action="store_true", help="Use the local cut-out model if the studio backdrop is weak")
    run.set_defaults(func=cmd_run)

    doc = sub.add_parser("doctor", help="Show local setup (no network)")
    doc.set_defaults(func=cmd_doctor)
    return p


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        return int(args.func(args))
    except BrokenPipeError:
        return 0
    except Exception as exc:  # noqa: BLE001
        print(exc, file=sys.stderr)
        return 1

"""Preview, batch rename, undo, and confirm-queue.

Originals are never edited in place without a blob backup. Undo restores
the exact original bytes and file name, matching ASMO's safety contract.
Photo-to-video sample files and the core ASMO tree are never written to.
"""

from __future__ import annotations

import json
import shutil
import uuid
from pathlib import Path
from typing import Any, Iterable

from .hashutil import sha256_file
from .journal import Journal, recover_pending
from .naming import plan_image_names
from .parse import ParsedBoot, load_description_file, parse_description
from .views import classify_images

IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".tif", ".tiff", ".bmp"}
PROFILE = "asmo-wbw"
PROFILE_VERSION = "0.1.0"
PROVIDER = "asmo-wbw-local"


def default_store(files: Iterable[str | Path]) -> Path:
    files = list(files)
    if not files:
        return Path(".asmo-wbw").resolve()
    return Path(files[0]).resolve().parent / ".asmo-wbw"


def discover_images(folder: str | Path) -> list[Path]:
    folder = Path(folder)
    out = []
    for p in sorted(folder.iterdir()):
        if p.is_file() and p.suffix.lower() in IMAGE_EXTS and not p.name.startswith("."):
            out.append(p)
    return out


def find_description(folder: str | Path) -> Path | None:
    folder = Path(folder)
    for name in (
        "description.txt",
        "description.md",
        "description.json",
        "desc.txt",
        "README.txt",
    ):
        p = folder / name
        if p.is_file():
            return p
    return None


def load_boot(
    *,
    description_path: str | Path | None = None,
    description_text: str | None = None,
    title: str | None = None,
) -> ParsedBoot:
    if description_path:
        return load_description_file(description_path, title=title)
    if description_text is None:
        raise ValueError("A deep description is required (--description or description.txt)")
    return parse_description(description_text, title=title)


def preview_boot(
    images: list[str | Path],
    parsed: ParsedBoot,
    *,
    use_cutout: bool = False,
    precomputed_views: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    paths = [str(Path(p).resolve()) for p in images]
    if precomputed_views is not None:
        views = precomputed_views
    else:
        views = [v.to_dict() for v in classify_images(paths, use_cutout=use_cutout)]
    # Attach paths in order if a caller passed a short view list.
    for i, v in enumerate(views):
        v.setdefault("path", paths[i] if i < len(paths) else "")
        v.setdefault("ext", Path(v["path"]).suffix.lower() or ".jpg")
    planned = plan_image_names(parsed, views)
    confirm = []
    rows = []
    for item, src in zip(planned["images"], views, strict=False):
        row = {
            "original_path": src.get("path") or item.get("path"),
            "original_name": Path(src.get("path") or item.get("path") or "").name,
            "proposed_name": item["proposed_name"],
            "proposed_stem": item["proposed_stem"],
            "view": item["view"],
            "confidence": src.get("confidence"),
            "confirm_queue": bool(src.get("confirm_queue")),
            "source": src.get("source"),
            "notes": list(src.get("notes") or []),
            "scores": src.get("scores") or {},
        }
        if row["confirm_queue"]:
            confirm.append(row)
        rows.append(row)
    return {
        "listing_slug": planned["listing_slug"],
        "parts": planned["parts"],
        "fields": parsed.to_dict()["fields"],
        "sources": parsed.to_dict()["sources"],
        "notes": list(parsed.notes),
        "images": rows,
        "confirm_queue": confirm,
        "n_images": len(rows),
        "n_confirm": len(confirm),
    }


def _write_confirm_queue(store: Path, preview: dict[str, Any]) -> Path:
    path = store / "confirm-queue.json"
    path.write_text(json.dumps(preview, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return path


def batch_boot(
    images: list[str | Path],
    parsed: ParsedBoot,
    store_dir: str | Path,
    *,
    include_low_confidence: bool = False,
    use_cutout: bool = False,
    precomputed_views: list[dict[str, Any]] | None = None,
    recover_first: bool = True,
) -> dict[str, Any]:
    store = Path(store_dir)
    store.mkdir(parents=True, exist_ok=True)
    recovered = recover_pending(store) if recover_first else []
    preview = preview_boot(
        images, parsed, use_cutout=use_cutout, precomputed_views=precomputed_views
    )
    queue_path = _write_confirm_queue(store, preview)
    journal = Journal(store)
    batch_id = str(uuid.uuid4())
    results: list[dict[str, Any]] = []
    try:
        for row in preview["images"]:
            src = Path(row["original_path"])
            dest = src.with_name(row["proposed_name"])
            entry: dict[str, Any] = {**row, "ok": False, "skipped": False}
            if dest.resolve() == src.resolve():
                entry.update(ok=True, skipped=True, reason="already named")
                results.append(entry)
                continue
            if row["confirm_queue"] and not include_low_confidence:
                entry.update(skipped=True, reason="confirm-queue (low confidence)")
                results.append(entry)
                continue
            if dest.exists():
                entry.update(skipped=True, reason=f"destination exists: {dest.name}")
                results.append(entry)
                continue
            if not src.is_file():
                entry.update(reason="missing source")
                results.append(entry)
                continue
            digest = sha256_file(src)
            op = journal.begin_op(
                batch_id=batch_id,
                original_path=str(src),
                original_hash=digest,
                profile=PROFILE,
                profile_version=PROFILE_VERSION,
                provider_used=PROVIDER,
                actions={"plan": {**row, "proposed_path": str(dest)}},
            )
            try:
                journal.store_blob(digest, src)
                journal.commit_op(op["op_id"], blob_hash=digest)
                tmp = dest.with_name(f".{dest.name}.wbw-tmp-{op['op_id']}")
                shutil.copy2(src, tmp)
                tmp_hash = sha256_file(tmp)
                if tmp_hash != digest:
                    tmp.unlink(missing_ok=True)
                    raise RuntimeError("staged copy hash mismatch")
                tmp.replace(dest)
                src.unlink()
                new_hash = sha256_file(dest)
                journal.commit_op(
                    op["op_id"],
                    status="done",
                    new_path=str(dest),
                    new_hash=new_hash,
                    blob_hash=digest,
                )
                entry.update(ok=True, op_id=op["op_id"], new_path=str(dest), new_hash=new_hash)
            except Exception as exc:  # noqa: BLE001 — record and leave original if possible
                # Best-effort rollback of this one file.
                dest_exists = dest.exists()
                src_exists = src.exists()
                if dest_exists and not src_exists:
                    dest.replace(src)
                entry.update(ok=False, reason=str(exc), op_id=op["op_id"])
                journal.commit_op(op["op_id"], status="failed", skip_reason=str(exc))
            results.append(entry)
    finally:
        journal.close()
    return {
        **preview,
        "batch_id": batch_id,
        "store_dir": str(store),
        "confirm_queue_path": str(queue_path),
        "recovered": recovered,
        "results": results,
        "n_renamed": sum(1 for r in results if r.get("ok") and not r.get("skipped")),
        "n_skipped": sum(1 for r in results if r.get("skipped")),
        "n_failed": sum(1 for r in results if not r.get("ok") and not r.get("skipped")),
    }


def undo_target(token: str, store_dir: str | Path, force: bool = False) -> dict[str, Any]:
    journal = Journal(store_dir)
    try:
        matches = journal.find_by_path_or_id(token)
        row = next((r for r in matches if r["status"] == "done"), None)
        if row is None:
            row = journal.latest_done_by_new_path(token)
        if not row or row["status"] != "done":
            return {"ok": False, "message": f"No done operation found for {token}"}
        if not row.get("blob_hash") or not row.get("new_path"):
            return {"ok": False, "message": f"Operation {row['op_id']} has no stored original"}
        new_path = Path(row["new_path"])
        if new_path.exists():
            current = sha256_file(new_path)
            expected = row.get("new_hash")
            if expected and current != expected and not force:
                return {
                    "ok": False,
                    "message": (
                        f"File changed since asmoWBW wrote it: {new_path}. "
                        "Pass --yes to overwrite."
                    ),
                }
        blob = journal.blob_path(row["blob_hash"])
        if not blob.is_file():
            return {"ok": False, "message": f"Original blob missing for {row['op_id']}"}
        original = Path(row["original_path"])
        original.parent.mkdir(parents=True, exist_ok=True)
        tmp = Path(str(original) + f".wbw-undo-{row['op_id']}")
        tmp.write_bytes(blob.read_bytes())
        tmp.replace(original)
        if new_path.resolve() != original.resolve() and new_path.exists():
            new_path.unlink()
        restored = sha256_file(original)
        if restored != row["original_hash"]:
            return {"ok": False, "message": f"Undo hash mismatch for {original}"}
        journal.commit_op(row["op_id"], status="undone")
        journal.release_blob(row["blob_hash"])
        return {"ok": True, "message": f"Restored {original}", "op_id": row["op_id"]}
    finally:
        journal.close()

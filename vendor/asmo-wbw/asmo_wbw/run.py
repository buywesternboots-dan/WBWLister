"""BootLister entry point: one listing JSON in, a result JSON and files out."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from . import __version__
from .contract import ContractError, parse_payload
from .copy import (
    alt_text,
    caption_text,
    credit_line,
    keywords as keyword_list,
    open_graph,
    pack_filename,
    seo_description,
    seo_title,
    slug_tokens,
    title_text,
)
from .facts import facts_fingerprint, listing_facts, listing_model
from .hashutil import sha256_file
from .journal import Journal, recover_pending
from .media import media_source, optimize_image
from .views import VIEW_WORDS, classify_image

PROFILE = "asmo-wbw-bootlister"
PROFILE_VERSION = "0.2.0"
PROVIDER = "asmo-wbw-local"
COPYRIGHT = "westernbootworld.com"


def _json_field(value: Any) -> dict | None:
    if isinstance(value, dict):
        return value
    if isinstance(value, str) and value.strip():
        try:
            parsed = json.loads(value)
        except json.JSONDecodeError:
            return None
        return parsed if isinstance(parsed, dict) else None
    return None


def _should_reuse(item: dict[str, Any], fp: str) -> bool:
    applied = _json_field(item.get("opt_applied")) or {}
    if applied.get("media") != "lens":
        return False
    if applied.get("facts_fp") != fp:
        return False
    images = applied.get("images") or []
    photos = item.get("photos") or []
    if not images or len(images) != len(photos):
        return False
    for i, rec in enumerate(images):
        if str(rec.get("stored_url") or "") != str(photos[i]):
            return False
    return True


def _filename(values: dict[str, Any], style: str, n: int, view: str | None, taken: set[str]) -> str:
    tokens, pinned = slug_tokens(values, style)
    suffix = f"-{view}" if view and view in VIEW_WORDS else f"-{n}"
    stem = pack_filename(tokens, pinned, suffix, max_len=80)
    name = f"{stem}.jpg"
    if name.lower() in taken:
        suffix = f"-{view}-{n}" if view and view in VIEW_WORDS else f"-{n}"
        # If still colliding, add a counter.
        base = pack_filename(tokens, pinned, suffix, max_len=80)
        name = f"{base}.jpg"
        k = 2
        while name.lower() in taken:
            extra = f"-{k}"
            name = pack_filename(tokens, pinned, suffix + extra, max_len=80) + ".jpg"
            k += 1
    taken.add(name.lower())
    return name


def _media_map(item: dict[str, Any]) -> dict[int, dict[str, Any]]:
    out: dict[int, dict[str, Any]] = {}
    for rec in item.get("media") or []:
        if not isinstance(rec, dict):
            continue
        n = int(rec.get("n") or 0)
        if n:
            out[n] = rec
    return out


def process_listing(
    listing: dict[str, Any],
    *,
    out_dir: str | Path,
    store_dir: str | Path | None = None,
    fetch: bool = False,
    use_cutout: bool = False,
    include_low_confidence_views: bool = False,
) -> dict[str, Any]:
    """Process one normalized listing. Writes derivatives under out_dir."""
    facts = listing_facts(listing)
    values = facts["values"]
    style = facts["style"] or listing_model(facts["item"])
    fp = facts_fingerprint(facts["item"])
    reused = _should_reuse(listing, fp)
    applied = _json_field(listing.get("opt_applied")) or {}
    listing_id = listing["id"]
    photos = list(listing.get("photos") or [])
    media = _media_map(listing)
    total = max(len(photos), max(media, default=0))
    # If there are media entries without photos URLs, still emit them.
    if not total and media:
        total = max(media)
        photos = [media[i].get("stored_url") or "" for i in range(1, total + 1)]

    out_root = Path(out_dir) / str(listing_id)
    out_root.mkdir(parents=True, exist_ok=True)
    store = Path(store_dir) if store_dir else out_root / ".asmo-wbw"
    store.mkdir(parents=True, exist_ok=True)
    recover_pending(store)

    seo_t = applied.get("seo_title") if reused else seo_title(values, style, listing_id)
    source_desc = ""
    original = listing.get("opt_original") if isinstance(listing.get("opt_original"), dict) else {}
    source_desc = str(listing.get("description") or original.get("description") or "")
    seo_d = applied.get("seo_description") if reused else seo_description(values, style, listing_id, source_desc)
    credit = credit_line(listing.get("seller_profile") or {}, listing.get("seller") or "")
    tokens, _pinned = slug_tokens(values, style)
    listing_slug = "-".join(tokens) if tokens else f"listing-{listing_id}"

    journal = Journal(store)
    images_out: list[dict[str, Any]] = []
    confirm: list[dict[str, Any]] = []
    taken: set[str] = set()
    errors: list[str] = []
    notes: list[str] = list(listing.get("_dropped_private") and [
        f"Ignored private column(s): {', '.join(listing['_dropped_private'])}"
    ] or [])
    if listing.get("_dropped_private"):
        notes = [f"Ignored private column(s): {', '.join(listing['_dropped_private'])}"]

    try:
        for n in range(1, max(total, 1) + 1 if total else 1):
            if total == 0:
                break
            url = photos[n - 1] if n - 1 < len(photos) else ""
            rec = media.get(n) or {"n": n, "stored_url": url}
            rec.setdefault("stored_url", url)
            view = None
            confirm_flag = False
            view_src = None
            src_bytes, src_how = media_source(rec, fetch=fetch)
            if src_how == "url-not-fetched":
                notes.append(f"photo {n}: URL present but not fetched (pass --fetch on an operator run)")
            if src_how.startswith("missing"):
                errors.append(f"photo {n}: {src_how}")

            if src_bytes:
                # Classify from local pixels only; never guess a view without bytes.
                tmp_path = out_root / f".src-{n}.bin"
                tmp_path.write_bytes(src_bytes)
                try:
                    classified = classify_image(tmp_path, use_cutout=use_cutout)
                    if classified.confirm_queue and not include_low_confidence_views:
                        confirm_flag = True
                        view = None
                    else:
                        view = classified.view if classified.view in VIEW_WORDS else None
                        confirm_flag = classified.confirm_queue
                    view_src = classified.source
                except Exception as exc:  # noqa: BLE001
                    notes.append(f"photo {n}: view analysis skipped ({exc})")
                finally:
                    tmp_path.unlink(missing_ok=True)

            reused_img = None
            if reused:
                for im in applied.get("images") or []:
                    if int(im.get("n") or 0) == n:
                        reused_img = im
                        break
            filename = (reused_img or {}).get("file") or _filename(values, style, n, view, taken)
            if not filename.lower().endswith(".jpg"):
                filename = f"{filename}.jpg"
            taken.add(filename.lower())
            webp_name = Path(filename).stem + ".webp"
            alt = (reused_img or {}).get("alt") or alt_text(values, style, listing_id, n, total, view)
            caption = caption_text(values, style, listing_id, n, total, view)
            title = title_text(values, style, listing_id, n, view)
            kws = keyword_list(values, style)
            meta = {
                "title": title,
                "description": caption,
                "keywords": kws,
                "credit": credit,
                "copyright": COPYRIGHT,
                "gps": None,
            }
            jpeg_rel = filename
            webp_rel = webp_name
            width = rec.get("width")
            height = rec.get("height")
            gps_stripped = bool((rec.get("exif") or {}).get("gps_present"))
            op_id = None
            if src_bytes:
                digest = __import__("hashlib").sha256(src_bytes).hexdigest()
                op = journal.begin_op(
                    batch_id=str(listing_id),
                    original_path=rec.get("path") or rec.get("stored_url") or f"media:{n}",
                    original_hash=digest,
                    profile=PROFILE,
                    profile_version=PROFILE_VERSION,
                    provider_used=PROVIDER,
                    actions={"n": n, "filename": filename, "listing_id": listing_id},
                )
                blob_tmp = store / "inbox" 
                blob_tmp.mkdir(exist_ok=True)
                src_file = blob_tmp / f"{digest}"
                if not src_file.is_file():
                    src_file.write_bytes(src_bytes)
                journal.store_blob(digest, src_file)
                try:
                    optimized = optimize_image(src_bytes, meta=meta)
                    jpeg_path = out_root / filename
                    webp_path = out_root / webp_name
                    jpeg_path.write_bytes(optimized["jpeg"])
                    webp_path.write_bytes(optimized["webp"])
                    width, height = optimized["width"], optimized["height"]
                    gps_stripped = bool(optimized["gps_stripped"] or gps_stripped)
                    new_hash = sha256_file(jpeg_path)
                    journal.commit_op(
                        op["op_id"],
                        status="done",
                        new_path=str(jpeg_path),
                        new_hash=new_hash,
                        blob_hash=digest,
                    )
                    op_id = op["op_id"]
                except Exception as exc:  # noqa: BLE001
                    journal.commit_op(op["op_id"], status="failed", skip_reason=str(exc))
                    errors.append(f"photo {n}: optimize failed ({exc})")
            else:
                # No pixels: still return the planned names and copy.
                (out_root / filename).parent.mkdir(parents=True, exist_ok=True)

            og = open_graph(
                title=title,
                description=caption,
                image=str(Path(str(listing_id)) / jpeg_rel),
                width=width,
                height=height,
                alt=alt,
            )
            row = {
                "n": n,
                "stored_url": rec.get("stored_url") or url,
                "source": src_how,
                "view": view,
                "view_source": view_src,
                "confirm_queue": confirm_flag,
                "filename": filename,
                "alt": alt,
                "caption": caption,
                "title": title,
                "keywords": kws,
                "jpeg": str(Path(str(listing_id)) / jpeg_rel),
                "webp": str(Path(str(listing_id)) / webp_rel) if src_bytes else None,
                "width": width,
                "height": height,
                "gps_stripped": gps_stripped,
                "metadata": meta,
                "open_graph": og,
                "op_id": op_id,
            }
            images_out.append(row)
            if confirm_flag:
                confirm.append(row)
    finally:
        journal.close()

    first = next((im for im in images_out if im.get("jpeg")), None)
    listing_og = open_graph(
        title=seo_t,
        description=seo_d,
        image=first["jpeg"] if first else None,
        width=first.get("width") if first else None,
        height=first.get("height") if first else None,
        alt=first.get("alt") if first else None,
    )
    used_fields = {k: v for k, v in values.items() if v not in (None, "", []) and k not in {"sized_label", "brand_phrase", "color_phrase", "noun"}}
    if values.get("noun"):
        used_fields["noun"] = values["noun"]
    if style:
        used_fields["style"] = style

    return {
        "ok": not errors,
        "tool": "asmoWBW",
        "version": __version__,
        "listing_id": listing_id,
        "seller": listing.get("seller"),
        "facts_fp": fp,
        "reused_applied": reused,
        "listing_slug": listing_slug,
        "fields": used_fields,
        "omitted": facts["omitted"],
        "flags": facts["flags"],
        "seo_title": seo_t,
        "seo_description": seo_d,
        "open_graph": listing_og,
        "credit": credit,
        "images": images_out,
        "confirm_queue": confirm,
        "n_images": len(images_out),
        "n_confirm": len(confirm),
        "store_dir": str(store),
        "out_dir": str(out_root),
        "notes": notes,
        "errors": errors,
        "listing_text_readonly": True,
        "fetch_used": fetch,
    }


def process_payload(
    data: Any,
    *,
    out_dir: str | Path,
    store_dir: str | Path | None = None,
    fetch: bool = False,
    use_cutout: bool = False,
) -> dict[str, Any]:
    listings = parse_payload(data)
    results = [
        process_listing(
            item,
            out_dir=out_dir,
            store_dir=Path(store_dir) / str(item["id"]) if store_dir else None,
            fetch=fetch,
            use_cutout=use_cutout,
        )
        for item in listings
    ]
    if len(results) == 1:
        return results[0]
    return {
        "ok": all(r.get("ok") for r in results),
        "tool": "asmoWBW",
        "version": __version__,
        "n": len(results),
        "results": results,
    }

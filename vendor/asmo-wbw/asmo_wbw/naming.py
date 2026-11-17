"""SEO names built from a parsed description (asmoWBW).

Follows the photo-to-video rule in ptv/naming.py, with one change of
input: words must actually appear in the deep description (plus title
and photo metadata if provided). Nothing is guessed.

    listing slug:  lucchese-caiman-belly-cowboy-boots-size-9-ee
    image stem:    lucchese-caiman-belly-cowboy-boots-size-9-ee-side

Lowercase ASCII hyphens, max 80 characters, descriptors dropped first.
Per-image suffixes are the view words: side, front, toe, sole, heel,
back, detail, pair.
"""

from __future__ import annotations

import re
import unicodedata
from typing import TYPE_CHECKING, Any, Iterable

if TYPE_CHECKING:
    from .parse import ParsedBoot

MAX_LEN = 80
VIEW_WORDS = ("side", "front", "toe", "sole", "heel", "back", "detail", "pair")

# Longest phrase first; value is the slug text. Same list as ptv.naming.
TYPES = [
    ("cowboy boots", "cowboy boots"),
    ("western boots", "western boots"),
    ("cowgirl boots", "cowgirl boots"),
    ("ankle boots", "ankle boots"),
    ("riding boots", "riding boots"),
    ("work boots", "work boots"),
    ("engineer boots", "engineer boots"),
    ("chelsea boots", "chelsea boots"),
    ("booties", "booties"),
    ("loafers", "loafers"),
    ("loafer", "loafers"),
    ("moccasins", "moccasins"),
    ("moccasin", "moccasins"),
    ("flats", "flats"),
    ("pumps", "pumps"),
    ("heels", "heels"),
    ("sandals", "sandals"),
    ("sneakers", "sneakers"),
    ("oxfords", "oxfords"),
    ("oxford", "oxfords"),
    ("boots", "boots"),
    ("boot", "boots"),
    ("shoes", "shoes"),
    ("shoe", "shoes"),
]

EXOTIC = [
    "caiman", "crocodile", "alligator", "gator", "ostrich", "rattlesnake",
    "snakeskin", "snake", "python", "lizard", "eel", "stingray", "shark",
    "elephant", "hippo", "bison", "buffalo", "teju", "anteater", "kangaroo",
    "cobra",
]
EXOTIC_QUALIFIERS = [
    "diamondback", "belly", "hornback", "full quill", "quill", "smooth",
    "ring tail", "back cut", "tail",
]
COLOURS = [
    "black", "brown", "tan", "cognac", "chocolate", "honey", "bone", "white",
    "red", "burgundy", "oxblood", "grey", "gray", "blue", "green", "natural",
    "rust", "camel", "taupe", "sand",
]
MATERIALS = ["leather", "suede", "nubuck", "roughout", "canvas", "patent leather"]
STYLES = [
    "harness", "engineer", "roper", "square toe", "snip toe", "round toe",
    "pointed toe", "lace up", "slip on", "slip-on", "packer", "buckaroo",
    "stockman",
]


def ascii_slug(text: str) -> str:
    t = unicodedata.normalize("NFKD", text or "").encode("ascii", "ignore").decode("ascii").lower()
    t = re.sub(r"[^a-z0-9]+", "-", t)
    return re.sub(r"-{2,}", "-", t).strip("-")


def _has(text: str, phrase: str) -> bool:
    return re.search(r"(?<![a-z])" + re.escape(phrase) + r"(?![a-z])", text) is not None


def _first_in_text(text: str, vocab: list[str]) -> list[str]:
    hits = []
    for v in vocab:
        m = re.search(r"(?<![a-z])" + re.escape(v) + r"(?![a-z])", text)
        if m:
            hits.append((m.start(), v))
    return [min(hits)[1]] if hits else []


def type_from_text(text: str) -> str:
    blob = (text or "").lower()
    for phrase, slug in TYPES:
        if _has(blob, phrase):
            return slug
    return ""


def slug_parts_from_text(
    text: str,
    brand: str = "",
    size: str = "",
    width: str = "",
) -> dict[str, Any]:
    """Descriptor words and type from text that is actually present."""
    title = (text or "").lower()
    brand_l = (brand or "").lower()
    words: list[str] = []
    exotic = [e for e in EXOTIC if _has(title, e)]
    if exotic:
        words += [q for q in EXOTIC_QUALIFIERS if _has(title, q) and q not in ("tail", "smooth")][:1]
        words += exotic[:1]
        if words and words[0] == "belly":
            words = words[1:] + ["belly"]
    else:
        words += _first_in_text(title, COLOURS)
        words += _first_in_text(title, MATERIALS)
        words += _first_in_text(title, STYLES)
    words = [w for w in words if w not in brand_l]
    typ = type_from_text(title)
    return {
        "brand": brand,
        "descriptors": words,
        "type": typ,
        "size": str(size or "").strip(),
        "width": str(width or "").strip(),
    }


def _join(p: dict[str, Any], descriptors: list[str]) -> str:
    bits = [p["brand"], *descriptors, p["type"]]
    if p["size"]:
        bits.append(f"size {p['size']}")
    if p["width"]:
        bits.append(p["width"])
    return ascii_slug(" ".join(b for b in bits if b))


def listing_slug(
    parts: dict[str, Any] | None = None,
    parsed: "ParsedBoot | None" = None,
    max_len: int = MAX_LEN,
    reserve: int = 0,
) -> str:
    """SEO listing / pair slug. `reserve` leaves room for a view suffix."""
    if parts is None:
        if parsed is None:
            raise ValueError("listing_slug requires parts or parsed")
        parts = slug_parts_from_text(
            parsed.source_text,
            brand=parsed.field_value("brand") or "",
            size=str(parsed.field_value("size") or ""),
            width=str(parsed.field_value("width") or ""),
        )
    cap = max_len - reserve
    if cap < 8:
        cap = max_len
    desc = list(parts["descriptors"])
    s = _join(parts, desc)
    while len(s) > cap and desc:
        desc.pop()
        s = _join(parts, desc)
    if not s:
        fallback = ""
        if parsed is not None:
            fallback = ascii_slug(parsed.title or parsed.description or "")
        s = fallback or "boot"
    return s[:cap].rstrip("-")


def image_stem(
    listing: str,
    view: str,
    taken: Iterable[str] | None = None,
    max_len: int = MAX_LEN,
) -> str:
    """`<listing>-<view>` with collision suffixes, max 80, view kept."""
    view = (view or "detail").lower().strip()
    if view not in VIEW_WORDS:
        view = "detail"
    suffix = f"-{view}"
    # Rebuild room: if the listing slug is already long, trim it (descriptors
    # were already dropped by listing_slug when reserve was set).
    base = listing
    if len(base) + len(suffix) > max_len:
        base = base[: max_len - len(suffix)].rstrip("-")
    stem = f"{base}{suffix}"
    taken_set = {t.lower() for t in (taken or [])}
    if stem.lower() not in taken_set:
        return stem
    n = 2
    while True:
        extra = f"-{n}"
        room = max_len - len(suffix) - len(extra)
        trimmed = base[:room].rstrip("-")
        candidate = f"{trimmed}{suffix}{extra}"
        if candidate.lower() not in taken_set:
            return candidate
        n += 1


def plan_image_names(
    parsed: "ParsedBoot",
    files: list[dict[str, Any]],
    max_len: int = MAX_LEN,
) -> dict[str, Any]:
    """Build the listing slug and a proposed stem for each image.

    `files` items need at least `path` and may include `view`,
    `confidence`, `confirm_queue`.
    """
    parts = slug_parts_from_text(
        parsed.source_text,
        brand=parsed.field_value("brand") or "",
        size=str(parsed.field_value("size") or ""),
        width=str(parsed.field_value("width") or ""),
    )
    # Reserve enough for the longest view word plus a collision number.
    slug = listing_slug(parts=parts, parsed=parsed, max_len=max_len, reserve=len("-detail-2"))
    taken: list[str] = []
    images = []
    for item in files:
        view = item.get("view") or "detail"
        stem = image_stem(slug, view, taken, max_len=max_len)
        taken.append(stem)
        ext = item.get("ext")
        if not ext:
            from pathlib import Path

            ext = Path(item.get("path") or item.get("name") or "x.jpg").suffix.lower() or ".jpg"
        images.append(
            {
                **item,
                "view": view if view in VIEW_WORDS else "detail",
                "proposed_stem": stem,
                "proposed_name": f"{stem}{ext}",
            }
        )
    return {"listing_slug": slug, "parts": parts, "images": images}

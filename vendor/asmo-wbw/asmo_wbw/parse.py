"""Deterministic structured fields from a deep boot description.

Only facts that are actually present in the provided text (and optional
photo metadata) are returned. Nothing is guessed or inferred from a
missing field. Each value records its source span.
"""

from __future__ import annotations

import json
import re
import unicodedata
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Any

# Longer phrases first so "Tony Lama" wins over a bare "Lama", etc.
BRANDS = [
    "salvatore ferragamo",
    "vintage shoe company",
    "rios of mercedes",
    "anderson bean",
    "black jack",
    "old gringo",
    "tony lama",
    "dan post",
    "j.b. hill",
    "jb hill",
    "r. watson",
    "r watson",
    "twisted x",
    "tanner mark",
    "cody james",
    "horse power",
    "rocketbuster",
    "liberty boot",
    "el dorado",
    "los altos",
    "double h",
    "lucchese",
    "tecovas",
    "ariat",
    "justin",
    "nocona",
    "fenoglio",
    "chisolm",
    "boulet",
    "corral",
    "stallion",
    "olathe",
    "rujo",
    "clifton",
    "hondo",
    "stewart",
    "sendra",
    "cuadra",
    "ferrini",
    "durango",
    "laredo",
    "minnetonka",
    "dingo",
    "stetson",
    "wrangler",
    "shyanne",
    "matisse",
    "ferragamo",
    "frye",
    "lane",
    "cinch",
]

EXOTIC = [
    "caiman",
    "crocodile",
    "alligator",
    "gator",
    "ostrich",
    "rattlesnake",
    "snakeskin",
    "snake",
    "python",
    "lizard",
    "eel",
    "stingray",
    "shark",
    "elephant",
    "hippo",
    "bison",
    "buffalo",
    "teju",
    "anteater",
    "kangaroo",
    "cobra",
]
EXOTIC_QUALIFIERS = [
    "full quill",
    "diamondback",
    "ring tail",
    "back cut",
    "hornback",
    "belly",
    "quill",
]
MATERIALS = [
    "patent leather",
    "leather",
    "suede",
    "nubuck",
    "roughout",
    "canvas",
]
COLOURS = [
    "distressed dark brown",
    "light golden brown",
    "light brown",
    "camel tan",
    "dark brown",
    "oxblood",
    "burgundy",
    "chocolate",
    "cognac",
    "natural",
    "taupe",
    "camel",
    "honey",
    "black",
    "brown",
    "tan",
    "bone",
    "white",
    "red",
    "grey",
    "gray",
    "blue",
    "green",
    "rust",
    "sand",
]
TOE_SHAPES = [
    "wide square toe",
    "pointed toe",
    "square toe",
    "round toe",
    "snip toe",
    "french toe",
    "almond toe",
    "moc-toe",
    "moc toe",
    "pointy toe",
]
HEEL_STYLES = [
    "underslung heel",
    "stacked heel",
    "walking heel",
    "cowboy heel",
    "cuban heel",
    "riding heel",
    "block heel",
    "kitten heel",
]
ERA_WORDS = [
    "deadstock",
    "vintage",
    "retro",
    "nos",
    "new old stock",
]
ERA_YEARS = re.compile(
    r"\b(?:(?:circa|c\.)\s*)?((?:19|20)\d0s|(?:19|20)\d{2}s?)\b",
    re.I,
)

# Width tokens, longest first.
WIDTHS = [
    "EEEE",
    "EEE",
    "EEW",
    "EE",
    "EW",
    "4E",
    "3E",
    "AAAA",
    "AAA",
    "AA",
    "A",
    "B",
    "C",
    "D",
    "E",
    "M",
    "W",
    "N",
    "S",
]
_WIDTH_ALT = "|".join(WIDTHS)

SIZE_LABELED = re.compile(
    r"(?im)^[^\n]{0,40}\bsize[ \t]*:[ \t]*([^\n]{0,40})$",
)
SIZE_INLINE = re.compile(
    rf"(?i)\b(?:us\s+)?(?:men'?s|women'?s|mens|womens|unisex|kids?)?\s*"
    rf"size\s*:?\s*(\d+(?:\.\d+)?)\s*({_WIDTH_ALT})?\b",
)
SIZE_COMPACT = re.compile(
    rf"(?i)\b(?:men'?s|women'?s|mens|womens|unisex)?\s*"
    rf"(\d+(?:\.\d+)?)\s*({_WIDTH_ALT})\b",
)
MODEL_LABELED = re.compile(r"(?im)^[^\n]{0,20}\bmodel[ \t]*:[ \t]*([^\n]{0,40})$")
COLOR_LABELED = re.compile(r"(?im)^[^\n]{0,20}\bcolou?r[ \t]*:[ \t]*([^\n]{0,60})$")
BRAND_LABELED = re.compile(r"(?im)^[^\n]{0,20}\bbrand[ \t]*:[ \t]*([^\n]{0,60})$")
HEEL_HEIGHT = re.compile(
    r"(?i)\bheel\s*height\s*:?\s*(\d+(?:\.\d+)?)\s*(in(?:ches?)?|cm|mm)?",
)
CONDITION_SCORE = re.compile(
    r"(?i)(Uppers|Linings|Outsoles|Overall)\s*:\s*(\d+)\s*/\s*10"
    r"([^\n]*)",
)

TYPOS = {
    "rattlensake": "rattlesnake",
    "rattlsnake": "rattlesnake",
    "rattlensnake": "rattlesnake",
}


def fix_typos(text: str) -> str:
    out = text or ""
    for bad, good in TYPOS.items():
        out = re.sub(re.escape(bad), good, out, flags=re.I)
    return out


def normalize_space(text: str) -> str:
    t = (text or "").replace("\xa0", " ")
    t = unicodedata.normalize("NFKC", t)
    return t


def _has(text: str, phrase: str) -> bool:
    return re.search(r"(?<![a-z0-9])" + re.escape(phrase) + r"(?![a-z0-9])", text, re.I) is not None


def _find(text: str, phrase: str) -> re.Match[str] | None:
    return re.search(r"(?<![a-z0-9])" + re.escape(phrase) + r"(?![a-z0-9])", text, re.I)


def _title_case_brand(raw: str) -> str:
    small = {"of", "the", "and", "de", "da"}
    parts = re.split(r"(\s+|-)", raw.strip())
    out = []
    for i, p in enumerate(parts):
        if not p or p.isspace() or p == "-":
            out.append(p)
            continue
        low = p.lower()
        if i > 0 and low in small:
            out.append(low)
        elif re.fullmatch(r"j\.?b\.?", low):
            out.append(p.upper() if "." in p else "JB")
        else:
            out.append(p[:1].upper() + p[1:].lower())
    return "".join(out).strip()


@dataclass
class Field:
    value: Any
    source: str

    def to_dict(self) -> dict[str, Any]:
        return {"value": self.value, "source": self.source}


@dataclass
class ParsedBoot:
    brand: Field | None = None
    model: Field | None = None
    material: Field | None = None
    exotic: Field | None = None
    color: Field | None = None
    toe_shape: Field | None = None
    heel: Field | None = None
    heel_height: Field | None = None
    size: Field | None = None
    width: Field | None = None
    condition: Field | None = None
    era: Field | None = None
    boot_type: Field | None = None
    title: str = ""
    description: str = ""
    source_text: str = ""
    notes: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        out: dict[str, Any] = {
            "title": self.title,
            "description": self.description,
            "source_text": self.source_text,
            "notes": list(self.notes),
            "fields": {},
            "sources": {},
        }
        for name in (
            "brand",
            "model",
            "material",
            "exotic",
            "color",
            "toe_shape",
            "heel",
            "heel_height",
            "size",
            "width",
            "condition",
            "era",
            "boot_type",
        ):
            f = getattr(self, name)
            if f is not None and f.value not in (None, "", []):
                out["fields"][name] = f.value
                out["sources"][name] = f.source
        return out

    def field_value(self, name: str, default: Any = "") -> Any:
        f = getattr(self, name)
        if f is None:
            return default
        return f.value


def _pick_labeled(pattern: re.Pattern[str], text: str) -> str | None:
    m = pattern.search(text)
    if not m:
        return None
    val = m.group(1).strip().strip("-–—:").strip()
    return val or None


def _first_vocab(text: str, vocab: list[str]) -> tuple[str, int] | None:
    hits: list[tuple[int, str]] = []
    for v in vocab:
        m = _find(text, v)
        if m:
            hits.append((m.start(), v))
    if not hits:
        return None
    hits.sort()
    return hits[0][1], hits[0][0]


def _material_and_exotic(text: str) -> tuple[Field | None, Field | None, Field | None]:
    """Return (material_list_field, exotic_field, qualifier-aware display)."""
    exotic_hit = _first_vocab(text, EXOTIC)
    quals = [q for q in EXOTIC_QUALIFIERS if _has(text, q) and q not in ("tail", "smooth")]
    mats = [m for m in MATERIALS if _has(text, m)]
    exotic_field = None
    material_field = None
    words: list[str] = []
    if exotic_hit:
        name = exotic_hit[0]
        if quals:
            # "caiman belly" reads material-first; "diamondback rattlesnake" qualifier-first.
            if quals[0] == "belly":
                display = f"{name} belly"
            else:
                display = f"{quals[0]} {name}"
            words = [quals[0], name] if quals[0] != "belly" else [name, "belly"]
        else:
            display = name
            words = [name]
        exotic_field = Field(display, f"phrase in description: {display}")
        # Keep genuine leather as a secondary material if present with an exotic.
        extra = [m for m in mats if m != "patent leather"]
        material_words = [display] + [m for m in extra if m not in display]
        material_field = Field(material_words, "phrases in description")
    elif mats:
        material_field = Field(mats, "phrases in description")
        words = mats
    return material_field, exotic_field, Field(words, "descriptor words") if words else None


def _era(text: str, brand: str | None) -> Field | None:
    search = text
    if brand:
        search = re.sub(re.escape(brand), " ", search, flags=re.I)
    m = ERA_YEARS.search(search)
    if m:
        return Field(m.group(1).lower(), f"year in description: {m.group(1)}")
    hit = _first_vocab(search, ERA_WORDS)
    if hit:
        return Field(hit[0].lower(), f"phrase in description: {hit[0]}")
    return None


def _condition(text: str) -> Field | None:
    scores: dict[str, Any] = {}
    notes: list[str] = []
    for label, val, rest in CONDITION_SCORE.findall(text):
        scores[label.lower()] = int(val)
        note = rest.strip(" -\t")
        if note:
            notes.append(f"{label}: {note}")
    if not scores and not notes:
        return None
    return Field({"scores": scores, "notes": notes}, "condition report in description")


def _size_width(text: str) -> tuple[Field | None, Field | None]:
    """Size and width only from explicit size language, never from measurements."""
    size_f = None
    width_f = None
    labeled = SIZE_LABELED.search(text)
    labeled_line = labeled.group(0) if labeled else ""
    # Prefer a labeled "Size:" / "US Men's size:" line.
    search_order = []
    if labeled_line:
        search_order.append(("size line", labeled_line))
    search_order.append(("size phrase", text))

    for source, blob in search_order:
        m = SIZE_INLINE.search(blob)
        if m:
            size_f = Field(_norm_size(m.group(1)), f"{source}: {m.group(0).strip()}")
            if m.group(2):
                width_f = Field(m.group(2).upper(), f"{source}: {m.group(0).strip()}")
            break
        m2 = SIZE_COMPACT.search(blob)
        if m2 and source == "size line":
            size_f = Field(_norm_size(m2.group(1)), f"{source}: {m2.group(0).strip()}")
            width_f = Field(m2.group(2).upper(), f"{source}: {m2.group(0).strip()}")
            break

    # Compact 9EE / 9.5D often sits on the size line (or a title line) after a number.
    if size_f and not width_f and labeled_line:
        m3 = re.search(rf"(?i)(?<![\d.]){re.escape(str(size_f.value))}\s*({_WIDTH_ALT})\b", labeled_line)
        if m3:
            width_f = Field(m3.group(1).upper(), f"size line: {m3.group(0)}")
    return size_f, width_f


def _norm_size(raw: str) -> str:
    s = raw.strip()
    if re.fullmatch(r"\d+\.0", s):
        s = s[:-2]
    return s


def parse_description(
    text: str,
    title: str | None = None,
    metadata: dict[str, Any] | None = None,
) -> ParsedBoot:
    """Parse a free-form deep description, optional title, and photo metadata."""
    raw = normalize_space(text or "")
    title_in = normalize_space(title or "")
    # If the caller didn't pass a title, a first "Title:" line still counts.
    if not title_in:
        m = re.search(r"(?im)^title\s*:\s*(.+)$", raw)
        if m:
            title_in = m.group(1).strip()
    raw = fix_typos(raw)
    title_in = fix_typos(title_in)
    # Source text used for "words actually present" includes title + body
    # plus any metadata facts the photos themselves carried.
    meta_bits = []
    metadata = metadata or {}
    for key in ("title", "description", "keywords", "artist", "make", "model"):
        val = metadata.get(key)
        if not val:
            continue
        if isinstance(val, list):
            val = " ".join(str(v) for v in val if v)
        meta_bits.append(str(val))
    source = "\n".join(p for p in (title_in, raw, " ".join(meta_bits)) if p)
    source_l = source.lower()

    parsed = ParsedBoot(title=title_in, description=raw, source_text=source)

    brand_labeled = _pick_labeled(BRAND_LABELED, source)
    if brand_labeled:
        parsed.brand = Field(_title_case_brand(brand_labeled), f"labeled Brand: {brand_labeled}")
    else:
        hit = _first_vocab(source, BRANDS)
        if hit:
            parsed.brand = Field(_title_case_brand(hit[0]), f"brand phrase in description: {hit[0]}")

    model_l = _pick_labeled(MODEL_LABELED, source)
    if model_l:
        parsed.model = Field(model_l, f"labeled Model: {model_l}")

    color_l = _pick_labeled(COLOR_LABELED, source)
    if color_l:
        parsed.color = Field(re.sub(r"\s+/\s+", " / ", color_l), f"labeled Color: {color_l}")
    else:
        # Only a colour word that actually appears; prefer the earliest one.
        # Search title first, then the rest, but record the word as written.
        hit = _first_vocab(source, COLOURS)
        if hit:
            parsed.color = Field(hit[0], f"colour phrase in description: {hit[0]}")

    mat, exo, _desc = _material_and_exotic(source)
    parsed.material = mat
    parsed.exotic = exo

    toe = _first_vocab(source, TOE_SHAPES)
    if toe:
        parsed.toe_shape = Field(toe[0].replace("moc toe", "moc-toe"), f"phrase in description: {toe[0]}")

    heel = _first_vocab(source, HEEL_STYLES)
    if heel:
        parsed.heel = Field(heel[0], f"phrase in description: {heel[0]}")
    hh = HEEL_HEIGHT.search(source)
    if hh:
        unit = (hh.group(2) or "in").lower()
        if unit.startswith("inch"):
            unit = "in"
        parsed.heel_height = Field(f"{hh.group(1)} {unit}", f"measurement: {hh.group(0).strip()}")

    parsed.size, parsed.width = _size_width(source)
    # Width appearing on the title (e.g. 9EE) should agree with the size line.
    if parsed.size:
        title_w = None
        if title_in:
            m = re.search(
                rf"(?<![\d.]){re.escape(str(parsed.size.value))}\s*({_WIDTH_ALT})\b",
                title_in,
                re.I,
            )
            if m:
                title_w = m.group(1).upper()
        if title_w and parsed.width and title_w != parsed.width.value:
            parsed.notes.append(
                f"width conflict (title {title_w} vs description {parsed.width.value}) — omitted"
            )
            parsed.width = None
        elif title_w and not parsed.width:
            parsed.width = Field(title_w, f"title size+width: {parsed.size.value}{title_w}")

    parsed.condition = _condition(source)
    parsed.era = _era(source, parsed.field_value("brand") or None)

    # Product type is resolved by naming.py from words present; stash a hint.
    from .naming import type_from_text

    typ = type_from_text(source_l)
    if typ:
        parsed.boot_type = Field(typ, f"type phrase in description: {typ}")

    return parsed


def load_description_file(path: str | Path, title: str | None = None) -> ParsedBoot:
    """Load a .txt/.md description or a JSON object with title/description/fields."""
    p = Path(path)
    raw = p.read_text(encoding="utf-8")
    metadata: dict[str, Any] = {}
    body = raw
    given_title = title
    if p.suffix.lower() == ".json":
        data = json.loads(raw)
        if not isinstance(data, dict):
            raise ValueError("description JSON must be an object")
        given_title = given_title or data.get("title") or ""
        body = data.get("description") or data.get("text") or ""
        # Pre-supplied fields are trusted as "labeled" facts, not guessed.
        extra = data.get("fields") or {}
        parsed = parse_description(str(body), title=str(given_title or ""), metadata=metadata)
        for key, val in extra.items():
            if val in (None, "", [], {}) or not hasattr(parsed, key):
                continue
            current = getattr(parsed, key)
            if current is None:
                setattr(parsed, key, Field(val, f"json fields.{key}"))
        return parsed
    return parse_description(body, title=given_title)

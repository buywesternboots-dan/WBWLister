"""Usable listing facts for naming and copy.

Follows BootLister listingFacts / imageValues / listingModel / exactMaker
rules: guessed fields are used only if also verified or stated in the
title or description; exact maker and exact maker+full style-number
matches only; leading zeros in style numbers stay as written.
"""

from __future__ import annotations

import json
import re
import unicodedata
from typing import Any

GENDER_RE = re.compile(r"\b(men(?:'?s)?|mens|women(?:'?s)?|womens|kids|man|woman|ladies|youth)\b", re.I)
LABEL_RE = re.compile(
    r"\b(model|style|lot|sku)(?:\s+(?:number|no\.?))?\s*[#:]\s*([A-Za-z0-9][A-Za-z0-9-]*)"
    r"|\b(model|style|lot|sku)\s+(?:number|no\.?)\s+([A-Za-z0-9][A-Za-z0-9-]*)",
    re.I,
)
STYLE_LINE = re.compile(r"^\s*style(?:\s+number)?\s*:\s*(\S(?:.*\S)?)\s*$", re.I)
SIZE_TOKEN = re.compile(r"^(?:\d{1,2}(?:\.5)?)(?:-?[a-e]{1,4})?$", re.I)
COMPOUND_COLOR = re.compile(r"^(black cherry|chocolate brown)$", re.I)
COLOR_WORD = re.compile(
    r"^(black|brown|tan|cognac|chocolate|honey|red|bone|white|grey|gray|blue|"
    r"green|burgundy|oxblood|natural|camel|saddle|rust|cherry)$",
    re.I,
)

# Exact material names and aliases (one hit only). Not a fuzzy search.
MATERIALS = [
    ("Caiman Lizard", ["caiman lizard", "hornback lizard", "hbl"]),
    ("Caiman Belly", ["caiman belly"]),
    ("Hornback Caiman", ["hornback caiman", "caiman hornback"]),
    ("Caiman", ["caiman"]),
    ("Full Quill Ostrich", ["full quill ostrich", "full-quill ostrich", "fq ostrich", "full quill"]),
    ("Smooth Ostrich", ["smooth ostrich"]),
    ("Ostrich Leg", ["ostrich leg"]),
    ("Ostrich", ["ostrich"]),
    ("Alligator", ["alligator", "gator"]),
    ("Crocodile", ["crocodile", "croc"]),
    ("Teju Lizard", ["teju lizard", "tegu lizard", "teju", "tegu"]),
    ("Ring Lizard", ["ring lizard"]),
    ("Lizard", ["lizard"]),
    ("Python", ["python"]),
    ("Snake", ["rattlesnake", "sea snake", "snake"]),
    ("Eel", ["eel"]),
    ("Stingray", ["stingray", "shagreen"]),
    ("Shark", ["shark"]),
    ("Hippo", ["hippopotamus", "hippo"]),
    ("Elephant", ["elephant"]),
    ("Sea Turtle", ["sea turtle", "turtle"]),
    ("Anteater", ["anteater"]),
    ("Bullfrog", ["bullfrog", "frog"]),
    ("Toad", ["toad"]),
    ("Bison", ["bison", "buffalo"]),
    ("Kangaroo", ["kangaroo"]),
    ("Peccary", ["peccary"]),
    ("Goat", ["goat"]),
    ("Calf", ["calfskin", "calf"]),
    ("Cowhide", ["cowhide"]),
    ("Suede", ["suede"]),
    ("Roughout", ["roughout", "rough out"]),
    ("Leather", ["leather"]),
]


def has(value: Any) -> bool:
    return value is not None and str(value).strip() != ""


def maker_key(name: Any) -> str:
    s = unicodedata.normalize("NFC", str(name or "")).lower()
    s = re.sub(r"[^a-z0-9]+", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def norm_style(value: Any) -> str:
    s = unicodedata.normalize("NFC", str(value or "")).replace("\xa0", " ")
    return re.sub(r"\s+", " ", s).strip().lower()


def _json_field(value: Any) -> dict | None:
    if value in (None, ""):
        return None
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
        except json.JSONDecodeError:
            return None
        return parsed if isinstance(parsed, dict) else None
    return value if isinstance(value, dict) else None


def source_text(item: dict[str, Any]) -> str:
    original = _json_field(item.get("opt_original")) or {}
    parts = [
        item.get("title"),
        item.get("description"),
        original.get("title"),
        original.get("description"),
    ]
    return "\n".join(str(p) for p in parts if p not in (None, ""))


def mentions(text: str, value: Any) -> bool:
    s = str(value or "").strip()
    if not s:
        return False
    return re.search(r"\b" + re.escape(s) + r"\b", text, re.I) is not None


def mentioned_size(text: str, size: Any) -> bool:
    s = str(size or "").strip()
    if not s:
        return False
    return re.search(r"\b(?:size\s*:?\s*)?" + re.escape(s) + r"(?:\s*-?\s*[a-e]{1,4})?\b", text, re.I) is not None


def mentioned_width(text: str, size: Any, width: Any) -> bool:
    w = str(width or "").strip()
    if not w:
        return False
    size_esc = re.escape(str(size or "").strip())
    width_esc = re.escape(w)
    if str(size or "").strip() and re.search(rf"\b{size_esc}\s*-?\s*{width_esc}\b", text, re.I):
        return True
    return re.search(rf"\bwidth\s*:?\s*{width_esc}\b", text, re.I) is not None


def accept_token(token: Any) -> bool:
    """A size, width, or price is not a style number. Leading zeros stay."""
    t = str(token or "").strip()
    if not t or len(t) > 20:
        return False
    if SIZE_TOKEN.match(t) or re.fullmatch(r"[a-e]{1,4}", t, re.I):
        return False
    if t.startswith("$") or re.fullmatch(r"\d+\.\d{2}", t):
        return False
    digits = re.sub(r"\D", "", t)
    if len(digits) < 3 or re.fullmatch(r"0+", digits):
        return False
    return True


def extract_model(text: str) -> str:
    for m in LABEL_RE.finditer(text or ""):
        label = (m.group(1) or m.group(3) or "").lower()
        token = m.group(2) or m.group(4) or ""
        if label == "sku" and re.match(r"^sku#[a-z0-9]", m.group(0).strip(), re.I):
            continue
        if accept_token(token):
            return token  # as written, including leading zeros
    return ""


def _style_field(value: Any) -> str:
    s = str(value or "").strip()
    if not s or len(s) > 40:
        return ""
    parts = s.split()
    if len(parts) > 3 or not all(re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9-]*", p) and accept_token(p) for p in parts):
        return ""
    return s


def listing_model(item: dict[str, Any]) -> str:
    original = _json_field(item.get("opt_original")) or {}
    texts = [
        f"{item.get('title') or ''}\n{item.get('description') or ''}",
        f"{original.get('title') or ''}\n{original.get('description') or ''}",
    ]
    for text in texts:
        found = extract_model(text)
        if found:
            return found
    if "id_text" in (item.get("verified") or []):
        return _style_field(item.get("id_text"))
    return ""


def explicit_styles(item: dict[str, Any]) -> list[str]:
    out: list[str] = []
    if "id_text" in (item.get("verified") or []):
        saved = str(item.get("id_text") or "").strip()
        if saved:
            out.append(saved)
    original = _json_field(item.get("opt_original")) or {}
    text = str(original.get("description") or item.get("description") or "")
    for line in text.splitlines():
        m = STYLE_LINE.match(line)
        if m:
            out.append(m.group(1))
    # unique, keep order
    seen: set[str] = set()
    uniq = []
    for s in out:
        if s not in seen:
            seen.add(s)
            uniq.append(s)
    return uniq


def color_phrase(color: Any) -> str:
    parts: list[str] = []
    for part in re.split(r"\s*(?:,|/|&|\band\b)\s*", str(color or ""), flags=re.I):
        bit = part.strip()
        if not bit:
            continue
        if COMPOUND_COLOR.match(bit):
            parts.append(re.sub(r"\b\w", lambda m: m.group(0).upper(), bit))
            continue
        words = bit.split()
        if len(words) > 1 and all(COLOR_WORD.match(w) for w in words):
            parts.extend(w[:1].upper() + w[1:] for w in words)
        else:
            parts.append(bit)
    return ", ".join(parts)


def exact_material_name(text: Any) -> str:
    s = re.sub(r"\s+", " ", str(text or "").strip().lower())
    if not s:
        return ""
    hits = []
    for name, aliases in MATERIALS:
        if name.lower() == s or s in aliases:
            hits.append(name)
    return hits[0] if len(hits) == 1 else ""


def exact_maker(brand: Any, makers: list[dict[str, Any]] | None) -> dict[str, Any] | None:
    """One exact directory row, or None. No fuzzy or partial hits."""
    raw = str(brand or "").strip()
    if not raw or not makers:
        return None
    key = maker_key(raw)
    if not key:
        return None
    hits = [m for m in makers if maker_key(m.get("name")) == key]
    return hits[0] if len(hits) == 1 else None


def apply_style_and_maker(item: dict[str, Any]) -> dict[str, Any]:
    """Apply exact maker / exact maker+full style from payload snapshots only."""
    flags = {
        "brand_exact": False,
        "style_status": "blank",
        "material_status": "none",
    }
    directory = item.get("maker_directory") or []
    if not isinstance(directory, list):
        directory = []
    maker = exact_maker(item.get("brand"), directory)
    verified = set(item.get("verified") or [])
    if maker:
        current = str(item.get("brand") or "")
        if "brand" not in verified or maker_key(current) == maker_key(maker.get("name")):
            item = {**item, "brand": maker["name"]}
            item["guessed"] = [g for g in (item.get("guessed") or []) if g != "brand"]
            flags["brand_exact"] = True

    sample = item.get("style_sample") or {}
    if not isinstance(sample, dict):
        sample = {}
    matches = sample.get("matches") or []
    status = sample.get("status")
    if status == "ambiguous":
        flags["style_status"] = "ambiguous"
    elif status == "candidate" and len(matches) == 1:
        flags["style_status"] = "matched"
        match = matches[0] or {}
        style = match.get("style_number")
        current = str(item.get("id_text") or "").strip()
        if style and (not current or "id_text" not in verified or norm_style(current) == norm_style(style)):
            # Keep the style string verbatim (leading zeros).
            item = {**item, "id_text": str(style)}
            item["guessed"] = [g for g in (item.get("guessed") or []) if g != "id_text"]
            item["verified"] = list(dict.fromkeys([*(item.get("verified") or []), "id_text"]))
        mat = exact_material_name(match.get("other_card_text"))
        cur_mat = str(item.get("material") or "").strip()
        cur_exact = exact_material_name(cur_mat)
        if mat and cur_exact and cur_exact != mat:
            flags["material_status"] = "needs-human"
        elif mat and (not cur_mat or "material" not in verified or cur_exact == mat):
            item = {**item, "material": mat}
            item["guessed"] = [g for g in (item.get("guessed") or []) if g != "material"]
            flags["material_status"] = "applied"
        elif match.get("other_card_text") and not cur_exact:
            flags["material_status"] = "needs-human"
    elif sample.get("styles"):
        flags["style_status"] = "none"

    # Accepted style_ref (seller/admin already accepted one card).
    style_ref = item.get("style_ref")
    if isinstance(style_ref, dict) and style_ref.get("style_number") and flags["style_status"] != "ambiguous":
        style = str(style_ref["style_number"])
        current = str(item.get("id_text") or "").strip()
        if not current or "id_text" not in verified or norm_style(current) == norm_style(style):
            item = {**item, "id_text": style}
            item["verified"] = list(dict.fromkeys([*(item.get("verified") or []), "id_text"]))
            if flags["style_status"] == "blank":
                flags["style_status"] = "matched"

    # Confirmed boot_references only when the model already appears in text or verified id_text.
    text = source_text(item)
    model_now = listing_model(item) or str(item.get("id_text") or "")
    for ref in item.get("boot_references") or []:
        if not isinstance(ref, dict):
            continue
        if str(ref.get("status") or "").lower() != "confirmed":
            continue
        model = str(ref.get("model") or "").strip()
        if not model:
            continue
        if mentions(text, model) or norm_style(model) == norm_style(model_now):
            if not listing_model({**item, "id_text": item.get("id_text"), "verified": item.get("verified")}):
                # already have a model from text; don't overwrite with a different one
                pass
            if not item.get("id_text"):
                item = {**item, "id_text": model}

    return {"item": item, "flags": flags, "maker": maker}


def _usable_stored(item: dict[str, Any], field: str) -> bool:
    if not has(item.get(field)):
        return False
    guessed = item.get("guessed") or []
    verified = item.get("verified") or []
    return field not in guessed or field in verified


def _condition_ok(item: dict[str, Any], text: str) -> bool:
    if not _usable_stored(item, "condition"):
        return False
    verified = set(item.get("verified") or [])
    if "condition" in verified:
        return True
    cond = str(item.get("condition") or "")
    if cond == "New":
        return bool(re.search(r"\b(brand new|deadstock|never worn|nwt|new with tags)\b", text, re.I))
    if cond == "Custom Made":
        return bool(re.search(r"\bcustom[- ]made|\bmade to order\b", text, re.I))
    if cond == "Broken In":
        return bool(re.search(r"\b(broken in|worn|used|pre-?owned)\b", text, re.I))
    return mentions(text, cond)


def listing_facts(item: dict[str, Any]) -> dict[str, Any]:
    applied = apply_style_and_maker(dict(item))
    item = applied["item"]
    flags = applied["flags"]
    text = source_text(item)
    verified = set(item.get("verified") or [])
    omitted: list[dict[str, str]] = []
    used: list[str] = []

    def take(field: str, ok: bool | None = None) -> Any:
        if ok is None:
            # Stored (not guessed) values are usable; guessed values also
            # qualify when the listing text already states the same value.
            ok = _usable_stored(item, field) or (
                has(item.get(field))
                and field in (item.get("guessed") or [])
                and (mentions(text, item.get(field)) or (field == "size" and mentioned_size(text, item.get("size"))) or (field == "width" and mentioned_width(text, item.get("size"), item.get("width"))))
            )
        if ok and has(item.get(field)):
            used.append(field)
            return item.get(field)
        if has(item.get(field)) or field in (item.get("guessed") or []):
            inferred = field in (item.get("guessed") or []) and field not in verified
            omitted.append({
                "field": field,
                "reason": (
                    "Inferred from the listing and not verified, so it is left out of the new wording."
                    if inferred
                    else "Left out of the new wording because the listing does not state it."
                ),
            })
        return None

    stated_gender = bool(GENDER_RE.search(text))
    gender = take(
        "sized_for",
        has(item.get("sized_for"))
        and ("sized_for" in verified or stated_gender)
        and (_usable_stored(item, "sized_for") or stated_gender),
    )
    boot = str(item.get("boot") or "")
    if boot == "belt":
        noun = "belt"
    elif boot == "boot":
        noun = "cowboy boots"
    else:
        noun = ""

    values = {
        "brand": take("brand"),
        "sized_for": gender,
        "sized_label": f"listed for {str(gender).lower()}" if gender else "",
        "size": take("size"),
        "width": take("width"),
        "color": take("color"),
        "material": take("material"),
        "material_cut": take("material_cut"),
        "material_type": take("material_type"),
        "toe": take("toe"),
        "heel": take("heel"),
        "sole": take("sole"),
        "condition": take("condition", _condition_ok(item, text)),
        "made_in": take("made_in"),
        "sole_length": take("sole_length"),
        "sole_width": take("sole_width"),
        "heel_height": take("heel_height"),
        "shaft_circ": take("shaft_circ"),
        "shaft_height": take("shaft_height"),
        "noun": noun,
        "keywords": take("keywords"),
    }
    # imageValues: a stored field may still be filled from the listing text
    # even if take() left it out (e.g. guessed but restated).
    def keep(field: str) -> Any:
        current = values.get(field)
        if has(current):
            return current
        raw = item.get(field)
        if field == "size" and mentioned_size(text, raw):
            used.append(field)
            return raw
        if field == "width" and mentioned_width(text, values.get("size") or item.get("size"), raw):
            used.append(field)
            return raw
        if raw and mentions(text, raw):
            used.append(field)
            return raw
        return current

    values["brand"] = keep("brand")
    values["size"] = keep("size")
    values["width"] = keep("width")
    values["material"] = keep("material")
    values["color"] = keep("color")
    values["color_phrase"] = color_phrase(values.get("color"))
    values["brand_phrase"] = str(values.get("brand") or "").strip()
    values["style"] = listing_model(item)
    # id_photos tokens: use as a model candidate only when accept_token passes
    # and we do not already have a style from the listing text / verified id.
    if not values["style"]:
        for rec in item.get("id_photos") or []:
            if not isinstance(rec, dict):
                continue
            token = str(rec.get("text") or "").strip()
            if accept_token(token):
                values["style"] = token
                break

    return {
        "values": values,
        "omitted": omitted,
        "used": list(dict.fromkeys(used)),
        "text": text,
        "item": item,
        "flags": flags,
        "style": values["style"],
    }


def fnv1a_32(text: str) -> int:
    h = 2166136261
    for ch in text:
        h ^= ord(ch)
        h = (h * 16777619) & 0xFFFFFFFF
    return h


def facts_fingerprint(item: dict[str, Any]) -> str:
    facts = listing_facts(item)
    original = _json_field(item.get("opt_original")) or {}
    body = json.dumps(
        {
            "values": facts["values"],
            "used": sorted(facts["used"]),
            "photos": list(item.get("photos") or []),
            "source_title": original.get("title") or item.get("title") or "",
            "source_description": original.get("description") or item.get("description") or "",
        },
        ensure_ascii=False,
        separators=(",", ":"),
    )
    return format(fnv1a_32(body), "08x")


def possessive(who: Any) -> str:
    s = str(who or "").strip()
    if not s:
        return ""
    return f"{s}'" if re.search(r"s$", s, re.I) else f"{s}'s"


def gender_token(who: Any) -> str:
    s = str(who or "").lower()
    if s.startswith("women"):
        return "womens"
    if s.startswith("men"):
        return "mens"
    if s.startswith("kid"):
        return "kids"
    return ""


def size_token(size: Any, width: Any) -> str:
    sz = re.sub(r"[^a-z0-9-]+", "", str(size or "").lower().replace(".", "-")).strip("-")
    w = re.sub(r"[^a-z0-9]+", "", str(width or "").lower())
    if not sz and not w:
        return ""
    return f"{sz}{w}"

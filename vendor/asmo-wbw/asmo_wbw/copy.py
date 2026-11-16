"""Alt text, captions, titles, and Open Graph fields.

Wording is varied deterministically by listing id (and photo index) so
listings do not all read the same. Templates only interpolate usable
facts; nothing is invented.
"""

from __future__ import annotations

import re
from typing import Any

from .facts import fnv1a_32, gender_token, possessive
from .naming import ascii_slug


def _pick(seed: str, n: int) -> int:
    if n <= 0:
        return 0
    return fnv1a_32(seed) % n


def clip_words(text: str, limit: int) -> str:
    t = re.sub(r"\s+", " ", str(text or "")).strip()
    if len(t) <= limit:
        return t
    cut = t[:limit]
    sp = cut.rfind(" ")
    return (cut[:sp] if sp > 40 else cut).strip()


def fact_bits(values: dict[str, Any], style: str) -> dict[str, str]:
    brand = str(values.get("brand_phrase") or values.get("brand") or "").strip()
    who = possessive(values.get("sized_for")) if values.get("sized_for") else ""
    color = str(values.get("color_phrase") or values.get("color") or "").strip()
    material = str(values.get("material") or "").strip()
    noun = str(values.get("noun") or "").strip()
    size = str(values.get("size") or "").strip()
    width = str(values.get("width") or "").strip()
    size_bits = []
    if size:
        size_bits.append(f"size {size}")
    if width:
        size_bits.append(f"{width} width")
    size_line = " ".join(size_bits)
    compact = f"{size}{width}".strip()
    meas = []
    if values.get("sole_length"):
        meas.append(f"sole {values['sole_length']} in")
    if values.get("heel_height"):
        meas.append(f"heel {values['heel_height']} in")
    if values.get("shaft_height"):
        meas.append(f"shaft {values['shaft_height']} in")
    if values.get("shaft_circ"):
        meas.append(f"shaft circ {values['shaft_circ']} in")
    toe = str(values.get("toe") or "").strip()
    heel = str(values.get("heel") or "").strip()
    return {
        "brand": brand,
        "who": who,
        "style": str(style or "").strip(),
        "color": color,
        "material": material,
        "noun": noun,
        "size_line": size_line,
        "compact": compact,
        "measures": ", ".join(meas),
        "toe": toe,
        "heel": heel,
        "product": " ".join(p for p in (brand, who, str(style or "").strip(), color, material, noun) if p).strip(),
    }


def _join(*parts: str) -> str:
    return re.sub(r"\s+", " ", " ".join(p for p in parts if p)).strip()


def seo_title(values: dict[str, Any], style: str, listing_id: int) -> str:
    b = fact_bits(values, style)
    options = [
        _join(b["brand"], b["who"], b["style"], b["color"], b["material"], b["noun"], b["size_line"]),
        _join(b["brand"], b["style"], b["noun"], "in", b["color"], b["material"], b["size_line"]),
        _join(b["color"], b["material"], b["brand"], b["noun"], b["style"] and f"style {b['style']}", b["size_line"]),
        _join(b["brand"], b["noun"], b["style"] and f"style {b['style']}", b["color"], b["material"], b["size_line"]),
    ]
    options = [o for o in options if o]
    if not options:
        return "Listing photo"
    return options[_pick(f"{listing_id}|seo_title", len(options))]


def seo_description(values: dict[str, Any], style: str, listing_id: int, source_description: str = "") -> str:
    b = fact_bits(values, style)
    compact = b["compact"]
    lead_opts = [
        _join(b["brand"], b["style"], compact and f"size {compact}", b["color"]),
        _join(b["brand"], b["noun"], b["style"] and f"style {b['style']}", b["size_line"], b["color"]),
        _join(b["color"], b["material"], b["brand"], b["noun"], compact and f"size {compact}"),
    ]
    lead_opts = [x.rstrip(" .") for x in lead_opts if x]
    lead = lead_opts[_pick(f"{listing_id}|seo_desc_lead", len(lead_opts))] if lead_opts else ""
    rest = re.sub(r"\s+", " ", source_description or "").strip()
    # Don't invent; only reuse the listing's own description words.
    body = f"{lead}. {rest}" if lead and rest else (lead or rest)
    if b["measures"] and b["measures"] not in body:
        # Measurements are usable facts; append if they fit the clip.
        body = f"{body} {b['measures'].rstrip('.') }.".strip()
    return clip_words(body, 155)


def alt_text(
    values: dict[str, Any],
    style: str,
    listing_id: int,
    n: int,
    total: int,
    view: str | None = None,
) -> str:
    b = fact_bits(values, style)
    options = [
        _join(b["brand"], b["who"], b["style"], b["color"], b["material"], b["noun"], b["size_line"]),
        _join(b["color"], b["material"], b["brand"], b["noun"], b["style"] and f"style {b['style']}", b["size_line"]),
        _join(b["brand"], b["noun"], "in", b["color"], b["material"], b["style"] and f"style {b['style']}", b["size_line"]),
        _join(b["brand"], b["style"], b["noun"], b["color"], b["material"], b["size_line"]),
    ]
    options = [o for o in options if o] or ["listing photo"]
    # Offset by photo index so two photos of the same listing don't read identically.
    base = options[_pick(f"{listing_id}|alt|{n}", len(options))]
    if view:
        base = f"{base} ({view} view)"
    if total > 1:
        return f"{base} - photo {n} of {total}"
    if n > 1:
        return f"{base} - photo {n}"
    return base


def caption_text(
    values: dict[str, Any],
    style: str,
    listing_id: int,
    n: int,
    total: int,
    view: str | None = None,
) -> str:
    b = fact_bits(values, style)
    options = [
        _join(b["brand"], b["noun"] or "photo", b["style"] and f"style {b['style']}", b["color"], b["material"], b["size_line"]).rstrip() + ".",
        _join(b["color"], b["material"], b["brand"], b["noun"], b["style"] and f", style {b['style']}", b["size_line"]).rstrip() + ".",
        _join(b["brand"], b["style"], "in", b["color"], b["material"], b["size_line"]).rstrip() + ".",
    ]
    if b["measures"]:
        options.append(_join(b["brand"], b["noun"], b["style"] and f"style {b['style']}", b["size_line"]).rstrip() + f". {b['measures'][:1].upper() + b['measures'][1:]}.")
    if b["toe"] or b["heel"]:
        extra = ", ".join(x for x in (b["toe"], b["heel"]) if x)
        options.append(_join(b["brand"], b["noun"], extra, b["style"] and f"style {b['style']}", b["size_line"]).rstrip() + ".")
    options = [o for o in options if o and o != "."]
    cap = options[_pick(f"{listing_id}|caption|{n}", len(options))] if options else "Listing photo."
    if view and view not in cap.lower():
        cap = cap.rstrip(".") + f" ({view} view)."
    if total > 1 and f"photo {n} of {total}" not in cap.lower():
        cap = cap.rstrip(".") + f". Photo {n} of {total}."
    return cap


def title_text(values: dict[str, Any], style: str, listing_id: int, n: int, view: str | None = None) -> str:
    # Shorter than the alt; used as IPTC/XMP title and image title.
    base = seo_title(values, style, listing_id)
    if view:
        return f"{base} ({view})"
    return f"{base} (photo {n})" if n else base


def keywords(values: dict[str, Any], style: str, extra: list[str] | None = None) -> list[str]:
    bits = [
        values.get("brand"),
        possessive(values.get("sized_for")) if values.get("sized_for") else "",
        style,
        values.get("color_phrase") or values.get("color"),
        values.get("material"),
        values.get("noun"),
        values.get("size") and f"size {values['size']}",
        values.get("width") and f"{values['width']} width",
        values.get("toe"),
        values.get("heel"),
    ]
    if values.get("keywords"):
        bits.extend(re.split(r"\s*,\s*", str(values["keywords"])))
    out: list[str] = []
    seen: set[str] = set()
    for b in [*bits, *(extra or [])]:
        s = re.sub(r"\s+", " ", str(b or "")).strip()
        if not s:
            continue
        key = s.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(s)
    return out


def credit_line(seller_profile: dict[str, Any], seller: str) -> str:
    who = (seller_profile or {}).get("display_name") or seller or ""
    who = str(who).strip()
    if not who:
        return "westernbootworld.com"
    return f"{who} via westernbootworld.com"


def open_graph(
    *,
    title: str,
    description: str,
    image: str | None = None,
    width: int | None = None,
    height: int | None = None,
    alt: str | None = None,
) -> dict[str, Any]:
    og: dict[str, Any] = {
        "og:title": title,
        "og:description": description,
        "og:type": "website",
        "og:site_name": "Western Boot World",
    }
    if image:
        og["og:image"] = image
    if width:
        og["og:image:width"] = int(width)
    if height:
        og["og:image:height"] = int(height)
    if alt:
        og["og:image:alt"] = alt
    return og


def slug_tokens(values: dict[str, Any], style: str) -> tuple[list[str], set[str]]:
    """Brand, gender, model, color, material, noun, compact size. Pin model+size."""

    def slugs(text: Any) -> list[str]:
        return [t for t in ascii_slug(str(text or "")).split("-") if t]

    seq: list[str] = []
    seq += slugs(values.get("brand_phrase") or values.get("brand"))
    g = gender_token(values.get("sized_for"))
    if g:
        seq.append(g)
    seq += slugs(style)
    seq += slugs((values.get("color_phrase") or values.get("color") or "").replace(",", " "))
    seq += slugs(values.get("material"))
    seq += slugs(values.get("noun"))
    size = size_token_safe(values.get("size"), values.get("width"))
    if size:
        seq.append(size)
    seen: set[str] = set()
    tokens: list[str] = []
    for t in seq:
        if not t or t in seen:
            continue
        seen.add(t)
        tokens.append(t)
    pinned = set(slugs(style))
    if size:
        pinned.add(size)
    return tokens, pinned


def size_token_safe(size: Any, width: Any) -> str:
    from .facts import size_token

    return size_token(size, width)


def pack_filename(tokens: list[str], pinned: set[str], tail: str, max_len: int = 80) -> str:
    room = max_len - len(tail)
    if room < 8:
        room = max_len
    lst = list(tokens)
    length = lambda: len("-".join(lst))  # noqa: E731
    while length() > room and any(t not in pinned for t in lst):
        drop = next((i for i in range(len(lst) - 1, -1, -1) if lst[i] not in pinned), -1)
        if drop < 0:
            break
        lst.pop(drop)
    name = "-".join(lst)
    if len(name) > room:
        name = name[:room].rstrip("-")
        if "-" in name:
            name = name.rsplit("-", 1)[0]
    return f"{name}{tail}" if name else tail.lstrip("-")

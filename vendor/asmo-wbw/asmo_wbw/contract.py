"""Validate and normalize BootLister's per-listing JSON (input contract).

Listing text is read-only. List Perfectly private money columns are dropped
and never used. Optional bonus keys are tolerated. This module does not
fetch URLs or call westernbootworld.com / eBay.
"""

from __future__ import annotations

from typing import Any

# lib/lp.js LP_PRIVATE, plus snake_case forms that must never be read.
LP_PRIVATE = (
    "Notes",
    "Cost of Goods",
    "Sold Price",
    "Shipping Cost",
    "Other Costs",
    "Sold Date",
    "Profit",
)
LP_PRIVATE_KEYS = {k.lower() for k in LP_PRIVATE} | {
    "notes",
    "cost_of_goods",
    "sold_price",
    "shipping_cost",
    "other_costs",
    "sold_date",
    "profit",
    "costofgoods",
    "soldprice",
    "shippingcost",
    "othercosts",
    "solddate",
}

CORE_KEYS = (
    "id",
    "seller",
    "source",
    "source_id",
    "source_url",
    "status",
    "boot",
    "boot_score",
    "photos",
    "src_photos",
    "title",
    "description",
    "id_text",
    "price",
    "wbw_price",
    "brand",
    "sized_for",
    "size",
    "size_estimated",
    "width",
    "material_type",
    "material",
    "material_cut",
    "made_in",
    "condition",
    "color",
    "keywords",
    "sole_length",
    "sole_width",
    "heel_height",
    "shaft_circ",
    "shaft_height",
    "sole",
    "heel",
    "toe",
    "guessed",
    "verified",
    "opt_error",
    "opt_original",
    "opt_proposal",
    "opt_applied",
    "seller_profile",
)

BONUS_KEYS = (
    "markets",
    "source_condition",
    "missing_group_price",
    "style_ref",
    "style_sample",
    "boot_references",
    "id_photos",
    "id_checked_at",
    "seller_notes",
    "sku",
    "media",
    "maker_directory",
    "posted",
    "asmowbw_prior",
    "asmowbw",
    "og_base_url",
)


class ContractError(ValueError):
    """Listing JSON does not satisfy the BootLister input contract."""


def _is_private_key(key: str) -> bool:
    k = str(key).strip()
    if k in LP_PRIVATE:
        return True
    norm = k.lower().replace(" ", "_")
    return norm in LP_PRIVATE_KEYS or k.lower() in LP_PRIVATE_KEYS


def _as_list(value: Any, name: str) -> list:
    if value is None:
        return []
    if isinstance(value, list):
        return value
    raise ContractError(f"{name} must be an array")


def _as_str(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        # Keep style-like numbers as strings so leading zeros in sibling
        # fields are not the only string path; numeric price stays str too
        # if it arrived as a number? Price may be number or string.
        return str(value)
    return str(value)


def _seller_profile(raw: Any, seller: str) -> dict[str, Any]:
    if raw is None:
        raw = {}
    if not isinstance(raw, dict):
        raise ContractError("seller_profile must be an object")
    name = raw.get("name") or seller
    return {
        "name": str(name or "").strip() or seller,
        "display_name": raw.get("display_name") or None,
        "location": raw.get("location") or None,
        "website": raw.get("website") or None,
        "brand_context": raw.get("brand_context") or None,
    }


def normalize_listing(data: Any) -> dict[str, Any]:
    """Validate one listing object and return a clean copy.

    Private money columns are discarded (never copied into the result).
    Unknown bonus keys are kept. Missing core keys are filled with null
    or empty arrays, except `id` and `seller`, which are required.
    """
    if not isinstance(data, dict):
        raise ContractError("Listing input must be a JSON object")
    dropped: list[str] = []
    clean: dict[str, Any] = {}
    for key, value in data.items():
        if _is_private_key(str(key)):
            dropped.append(str(key))
            continue
        clean[str(key)] = value

    if "listing" in clean and isinstance(clean["listing"], dict) and "id" not in clean:
        # Tolerate a { "listing": { ... } } wrapper.
        inner = normalize_listing(clean["listing"])
        inner.setdefault("_dropped_private", [])
        inner["_dropped_private"] = list(inner.get("_dropped_private") or []) + dropped
        return inner

    if "id" not in clean or clean["id"] in (None, ""):
        raise ContractError("Listing id is required")
    try:
        listing_id = int(clean["id"])
    except (TypeError, ValueError) as exc:
        raise ContractError("Listing id must be an integer") from exc
    seller = str(clean.get("seller") or "").strip()
    if not seller:
        raise ContractError("seller is required")

    photos = _as_list(clean.get("photos"), "photos")
    photos = [str(p) for p in photos if p]
    if len(photos) > 30:
        photos = photos[:30]

    out: dict[str, Any] = {k: clean.get(k) for k in CORE_KEYS}
    out["id"] = listing_id
    out["seller"] = seller.lower() if seller == seller.lower() else seller
    # Keep the slug as BootLister stores it (already lowercased there).
    out["seller"] = seller
    out["photos"] = photos
    out["guessed"] = [str(x) for x in _as_list(clean.get("guessed"), "guessed")]
    out["verified"] = [str(x) for x in _as_list(clean.get("verified"), "verified")]
    out["seller_profile"] = _seller_profile(clean.get("seller_profile"), seller)
    out["boot"] = str(clean.get("boot") or "")
    out["status"] = str(clean.get("status") or "")
    for key in BONUS_KEYS:
        if key in clean:
            out[key] = clean[key]
    # Media may include path / base64 for local and test runs.
    if out.get("media") is not None and not isinstance(out["media"], list):
        raise ContractError("media must be an array when present")
    out["_dropped_private"] = dropped
    return out


def parse_payload(data: Any) -> list[dict[str, Any]]:
    """One listing, a {listing: ...} wrapper, or an array of listings (bulk)."""
    if isinstance(data, list):
        return [normalize_listing(item) for item in data]
    return [normalize_listing(data)]

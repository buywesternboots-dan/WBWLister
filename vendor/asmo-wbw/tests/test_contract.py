import json
from pathlib import Path

import pytest

from asmo_wbw.contract import ContractError, normalize_listing, parse_payload

FIX = Path(__file__).resolve().parents[1] / "fixtures" / "listings" / "appendix-example.json"


def test_appendix_example_validates():
    data = json.loads(FIX.read_text())
    item = normalize_listing(data)
    assert item["id"] == 1842
    assert item["seller"] == "danhoffenberg"
    assert item["title"].startswith("Lucchese 1883")
    assert item["id_text"] == "0123"
    assert item["style_ref"]["style_number"] == "0123"
    assert item["seller_profile"]["display_name"] == "Dan Hoffenberg"
    assert item["_dropped_private"] == []


def test_private_money_columns_are_dropped_and_never_kept():
    data = json.loads(FIX.read_text())
    data["Notes"] = "PRIVATE: cost was 80, profit 40"
    data["Cost of Goods"] = "80"
    data["Profit"] = "40"
    data["sold_price"] = "200"
    item = normalize_listing(data)
    for key in ("Notes", "Cost of Goods", "Profit", "sold_price", "notes"):
        assert key not in item or key == "_dropped_private"
    blob = json.dumps(item)
    assert "PRIVATE" not in blob
    assert "cost was 80" not in blob
    assert set(item["_dropped_private"]) >= {"Notes", "Cost of Goods", "Profit", "sold_price"}


def test_bonus_fields_are_optional():
    item = normalize_listing(
        {
            "id": 1,
            "seller": "testerseller",
            "status": "review",
            "boot": "boot",
            "photos": [],
            "title": "Ariat boots",
            "description": "Size 10 D",
            "guessed": [],
            "verified": [],
        }
    )
    assert "style_ref" not in item
    assert item["photos"] == []
    assert item["seller_profile"]["name"] == "testerseller"


def test_id_is_required():
    with pytest.raises(ContractError, match="id"):
        normalize_listing({"seller": "x", "photos": [], "guessed": [], "verified": []})


def test_bulk_array_and_wrapper():
    a = normalize_listing({"id": 2, "seller": "a", "photos": [], "guessed": [], "verified": []})
    wrapped = parse_payload({"listing": {"id": 3, "seller": "b", "photos": [], "guessed": [], "verified": []}})
    bulk = parse_payload(
        [
            {"id": 4, "seller": "c", "photos": [], "guessed": [], "verified": []},
            {"id": 5, "seller": "d", "photos": [], "guessed": [], "verified": []},
        ]
    )
    assert a["id"] == 2
    assert wrapped[0]["id"] == 3
    assert [r["id"] for r in bulk] == [4, 5]

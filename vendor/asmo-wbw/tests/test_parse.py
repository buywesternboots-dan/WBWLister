from pathlib import Path

from asmo_wbw.parse import load_description_file, parse_description

FIX = Path(__file__).resolve().parents[1] / "fixtures"


def test_lucchese_fields():
    p = load_description_file(FIX / "descriptions" / "lucchese-caiman.txt")
    assert p.field_value("brand") == "Lucchese"
    assert p.field_value("model") == "L131753"
    assert p.field_value("exotic") == "caiman belly"
    assert "caiman belly" in p.field_value("material")
    assert "leather" in p.field_value("material")
    assert str(p.field_value("color")).lower().startswith("distressed dark brown")
    assert p.field_value("toe_shape") == "pointed toe"
    assert p.field_value("heel") == "stacked heel"
    assert p.field_value("heel_height") == "1.9 in"
    assert p.field_value("size") == "9"
    assert p.field_value("width") == "EE"
    assert p.field_value("era") == "vintage"
    assert p.field_value("boot_type") == "cowboy boots"
    cond = p.field_value("condition")
    assert cond["scores"]["uppers"] == 8
    assert cond["scores"]["outsoles"] == 8


def test_tecovas_model_and_size():
    p = load_description_file(FIX / "descriptions" / "tecovas-1000.txt")
    assert p.field_value("brand") == "Tecovas"
    assert p.field_value("model") == "1000"
    assert p.field_value("size") == "12"
    assert p.field_value("width") == "D"
    assert p.field_value("boot_type") == "cowboy boots"
    # Material is leather (not exotic). Colour from the Color: line.
    assert "leather" in p.field_value("material")
    assert "tan" in str(p.field_value("color")).lower()


def test_tony_lama_does_not_guess_missing_color_or_model():
    p = load_description_file(FIX / "descriptions" / "tony-lama-rattlesnake.txt")
    assert p.field_value("brand") == "Tony Lama"
    assert p.field_value("model") in (None, "", [])
    assert p.field_value("color") in (None, "", [])
    assert p.field_value("size") == "9.5"
    assert p.field_value("width") == "D"
    assert p.field_value("exotic") == "diamondback rattlesnake"
    assert p.field_value("era") == "vintage"
    # Title typo rattlensake is corrected only as a source-text typo, never invented.
    assert "rattlesnake" in p.source_text.lower()


def test_tony_lama_body_only_does_not_invent_rattlesnake():
    p = load_description_file(FIX / "descriptions" / "tony-lama-body-only.txt")
    assert p.field_value("brand") == "Tony Lama"
    assert p.field_value("exotic") in (None, "", [])
    assert p.field_value("size") == "9.5"
    assert p.field_value("width") == "D"
    assert "rattlesnake" not in p.source_text.lower()


def test_ferragamo_does_not_treat_sole_width_as_boot_width():
    p = load_description_file(FIX / "descriptions" / "ferragamo-loafers.txt")
    assert p.field_value("brand") == "Salvatore Ferragamo"
    assert p.field_value("size") == "3"
    assert p.field_value("width") in (None, "", [])
    assert p.field_value("toe_shape") == "moc-toe"
    assert "suede" in p.field_value("material")


def test_vintage_shoe_company_era_is_not_the_brand_word():
    p = load_description_file(FIX / "descriptions" / "vintage-shoe-company.txt")
    assert p.field_value("brand") == "Vintage Shoe Company"
    assert p.field_value("model") == "S03147"
    assert p.field_value("size") == "7"
    assert p.field_value("width") == "M"
    assert p.field_value("boot_type") == "ankle boots"
    # "Vintage" only appears as part of the brand name.
    assert p.field_value("era") in (None, "", [])


def test_incomplete_description_does_not_invent_a_brand():
    p = load_description_file(FIX / "written" / "incomplete-no-brand.txt")
    assert p.field_value("brand") in (None, "", [])
    assert p.field_value("size") == "8"
    assert "leather" in (p.field_value("material") or [])


def test_written_ariat_and_justin():
    a = load_description_file(FIX / "written" / "ariat-sport-roper.txt")
    assert a.field_value("brand") == "Ariat"
    assert a.field_value("model") == "Sport Roper"
    assert a.field_value("toe_shape") == "round toe"
    assert a.field_value("heel") == "walking heel"
    assert a.field_value("size") == "10"
    assert a.field_value("width") == "D"
    j = load_description_file(FIX / "written" / "justin-ostrich.txt")
    assert j.field_value("brand") == "Justin"
    assert j.field_value("exotic") == "full quill ostrich"
    assert j.field_value("size") == "11"
    assert j.field_value("width") == "EE"


def test_json_fields_are_labeled_not_guessed(tmp_path: Path):
    p = tmp_path / "boot.json"
    p.write_text(
        '{"title": "Handmade cowboy boots", "description": "US Men\'s size: 8D", '
        '"fields": {"brand": "Nocona"}}',
        encoding="utf-8",
    )
    parsed = load_description_file(p)
    assert parsed.field_value("brand") == "Nocona"
    assert parsed.brand.source.startswith("json fields")
    assert parsed.field_value("size") == "8"
    assert parsed.field_value("width") == "D"


def test_parse_does_not_guess_size_from_measurements():
    text = "Lucchese cowboy boots\nShaft Height: 12 in\nHeel Height: 1.5 in\n"
    p = parse_description(text)
    assert p.field_value("size") in (None, "", [])
    assert p.field_value("width") in (None, "", [])
    assert p.field_value("brand") == "Lucchese"

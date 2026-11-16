from asmo_wbw.facts import (
    accept_token,
    apply_style_and_maker,
    exact_maker,
    listing_facts,
    listing_model,
    norm_style,
)


def _base(**kw):
    item = {
        "id": 10,
        "seller": "tester",
        "boot": "boot",
        "photos": [],
        "title": "Lucchese style 0123 cowboy boots size 10 D",
        "description": "Style #: 0123\nBlack cherry goat boots, size 10 D.",
        "brand": "Lucchese",
        "id_text": "0123",
        "size": "10",
        "width": "D",
        "color": "Black Cherry",
        "material": "Goat",
        "material_type": "Leather",
        "sized_for": "Men",
        "condition": "Broken In",
        "guessed": [],
        "verified": ["brand", "id_text", "size", "width", "color", "material"],
    }
    item.update(kw)
    return item


def test_leading_zeros_kept_in_style_number():
    facts = listing_facts(_base())
    assert facts["style"] == "0123"
    assert facts["values"]["style"] == "0123"
    assert listing_model(_base()) == "0123"
    # The token helper does not strip zeros.
    assert accept_token("0123") is True
    assert norm_style("0123") == "0123"


def test_guessed_field_omitted_unless_stated_or_verified():
    item = _base(guessed=["material_type", "sized_for", "condition"])
    # material_type "Leather" is not in the title/description (goat is).
    # sized_for "Men" is not in the text. condition "Broken In" is not in the text.
    facts = listing_facts(item)
    assert facts["values"]["material_type"] in (None, "", [])
    assert facts["values"]["sized_for"] in (None, "", [])
    assert facts["values"]["condition"] in (None, "", [])
    omitted = {o["field"] for o in facts["omitted"]}
    assert "material_type" in omitted
    assert "sized_for" in omitted
    # Verified or stated values still come through.
    assert facts["values"]["material"] == "Goat"
    assert facts["values"]["color"] == "Black Cherry"
    assert facts["values"]["size"] == "10"
    assert facts["values"]["width"] == "D"


def test_guessed_field_used_when_listing_text_states_it():
    item = _base(
        guessed=["material_type"],
        verified=["brand", "id_text", "size", "width", "color", "material"],
        description="Style #: 0123\nBlack cherry goat leather cowboy boots, size 10 D.",
    )
    facts = listing_facts(item)
    assert facts["values"]["material_type"] == "Leather"


def test_ambiguous_style_sample_is_rejected():
    item = _base(
        style_sample={
            "status": "ambiguous",
            "matches": [
                {"maker_name": "Lucchese", "style_number": "0123"},
                {"maker_name": "Lucchese", "style_number": "0123"},
            ],
            "styles": ["0123"],
        }
    )
    applied = apply_style_and_maker(item)
    assert applied["flags"]["style_status"] == "ambiguous"
    # Style still comes from the listing's own labeled text, not a chosen catalog card.
    facts = listing_facts(item)
    assert facts["flags"]["style_status"] == "ambiguous"
    assert facts["style"] == "0123"


def test_exact_maker_requires_a_single_exact_match():
    makers = [{"name": "Lucchese"}, {"name": "Lucchese 1883"}]
    assert exact_maker("Lucchese", makers)["name"] == "Lucchese"
    # A longer name is not a partial hit on Lucchese.
    assert exact_maker("Lucchese Classic", makers) is None
    # Two rows with the same key would be ambiguous — none chosen.
    assert exact_maker("Acme", [{"name": "Acme"}, {"name": "ACME"}]) is None
    assert exact_maker("No Such Brand", makers) is None

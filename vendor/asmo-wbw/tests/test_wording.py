from asmo_wbw.copy import alt_text, caption_text, seo_title
from asmo_wbw.facts import listing_facts


def _values(listing_id, title="Lucchese style 0123 cowboy boots size 10 D"):
    item = {
        "id": listing_id,
        "seller": "tester",
        "boot": "boot",
        "photos": ["a", "b"],
        "title": title,
        "description": "Style #: 0123\nBlack cherry goat Lucchese cowboy boots, size 10 D.",
        "brand": "Lucchese",
        "id_text": "0123",
        "size": "10",
        "width": "D",
        "color": "Black Cherry",
        "material": "Goat",
        "guessed": [],
        "verified": ["brand", "id_text", "size", "width", "color", "material"],
    }
    facts = listing_facts(item)
    return facts["values"], facts["style"]


def test_wording_varies_across_listings_without_inventing():
    v1, s1 = _values(1842)
    v2, s2 = _values(9001, title="Lucchese style 0123 cowboy boots size 10 D")
    t1, t2 = seo_title(v1, s1, 1842), seo_title(v2, s2, 9001)
    a1 = alt_text(v1, s1, 1842, 1, 2)
    a2 = alt_text(v2, s2, 9001, 1, 2)
    # Different listing ids should not always produce the identical sentence.
    assert {t1, t2, a1, a2}
    assert t1 != t2 or a1 != a2
    for text in (t1, t2, a1, a2):
        low = text.lower()
        assert "lucchese" in low
        assert "0123" in text
        # Not invented:
        assert "mens" not in low
        assert "men's" not in low
        assert "leather" not in low  # material_type was not a usable fact
        assert "made in" not in low


def test_two_photos_of_the_same_listing_are_not_identical():
    v, s = _values(1842)
    a1 = alt_text(v, s, 1842, 1, 2)
    a2 = alt_text(v, s, 1842, 2, 2)
    c1 = caption_text(v, s, 1842, 1, 2)
    c2 = caption_text(v, s, 1842, 2, 2)
    assert a1 != a2
    assert c1 != c2
    assert "photo 1 of 2" in a1
    assert "photo 2 of 2" in a2
    assert "0123" in a1 and "0123" in a2

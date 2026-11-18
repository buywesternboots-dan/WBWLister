from pathlib import Path

from asmo_wbw.naming import image_stem, listing_slug, plan_image_names
from asmo_wbw.parse import load_description_file

FIX = Path(__file__).resolve().parents[1] / "fixtures"


def _slug(name: str, sub: str = "descriptions") -> str:
    return listing_slug(parsed=load_description_file(FIX / sub / name))


def test_sample_listing_slugs_match_photo_to_video_rule():
    assert _slug("lucchese-caiman.txt") == "lucchese-caiman-belly-cowboy-boots-size-9-ee"
    assert _slug("tecovas-1000.txt") == "tecovas-tan-leather-cowboy-boots-size-12-d"
    assert (
        _slug("tony-lama-rattlesnake.txt")
        == "tony-lama-diamondback-rattlesnake-western-boots-size-9-5-d"
    )
    assert (
        _slug("vintage-shoe-company.txt")
        == "vintage-shoe-company-brown-leather-harness-ankle-boots-size-7-m"
    )
    assert (
        _slug("ferragamo-loafers.txt")
        == "salvatore-ferragamo-tan-suede-slip-on-loafers-size-3"
    )


def test_words_not_in_the_description_are_not_used():
    assert _slug("tony-lama-body-only.txt") == "tony-lama-western-boots-size-9-5-d"


def test_written_description_slugs():
    assert _slug("ariat-sport-roper.txt", "written") == "ariat-tan-leather-roper-boots-size-10-d"
    assert (
        _slug("justin-ostrich.txt", "written")
        == "justin-full-quill-ostrich-cowboy-boots-size-11-ee"
    )
    assert _slug("incomplete-no-brand.txt", "written") == "brown-leather-boots-size-8"


def test_image_stems_add_view_and_collide_safely():
    base = "lucchese-caiman-belly-cowboy-boots-size-9-ee"
    a = image_stem(base, "side")
    b = image_stem(base, "side", taken=[a])
    c = image_stem(base, "pair", taken=[a, b])
    assert a == f"{base}-side"
    assert b == f"{base}-side-2"
    assert c == f"{base}-pair"
    assert all(len(s) <= 80 for s in (a, b, c))


def test_long_slug_drops_descriptors_before_size_and_view():
    # A long brand + many descriptors must keep brand, type, size, width, view.
    from asmo_wbw.naming import listing_slug, slug_parts_from_text

    parts = slug_parts_from_text(
        "tan leather harness roper pointed toe cowboy boots",
        brand="Anderson Bean Extra Long Showcase Brand Name",
        size="11.5",
        width="EEE",
    )
    slug = listing_slug(parts=parts, reserve=len("-detail-2"))
    assert slug.startswith("anderson-bean")
    assert slug.endswith("size-11-5-eee") or "size-11-5-eee" in slug
    assert len(slug) <= 80 - len("-detail-2")
    stem = image_stem(slug, "detail")
    assert stem.endswith("-detail")
    assert len(stem) <= 80


def test_plan_image_names_keeps_original_extension():
    parsed = load_description_file(FIX / "descriptions" / "lucchese-caiman.txt")
    plan = plan_image_names(
        parsed,
        [
            {"path": "/tmp/a.JPG", "view": "side", "ext": ".jpg"},
            {"path": "/tmp/b.png", "view": "sole"},
        ],
    )
    assert plan["listing_slug"] == "lucchese-caiman-belly-cowboy-boots-size-9-ee"
    assert plan["images"][0]["proposed_name"].endswith("-side.jpg")
    assert plan["images"][1]["proposed_name"].endswith("-sole.png")

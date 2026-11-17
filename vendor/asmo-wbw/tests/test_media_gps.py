from pathlib import Path

import piexif
from PIL import Image

from asmo_wbw.media import optimize_image, source_has_gps

FIX = Path(__file__).resolve().parents[1] / "fixtures" / "listings" / "media"


def test_gps_is_stripped_from_output_jpeg_and_webp():
    src = (FIX / "aa12.jpg").read_bytes()
    assert source_has_gps(src) is True
    # piexif sees a GPS IFD on the fixture
    assert piexif.load(src).get("GPS")

    out = optimize_image(
        src,
        meta={
            "title": "Test title",
            "description": "Test caption",
            "keywords": ["Lucchese", "0123"],
            "credit": "Dan Hoffenberg via westernbootworld.com",
            "copyright": "westernbootworld.com",
        },
    )
    jpeg, webp = out["jpeg"], out["webp"]
    assert out["gps_stripped"] is True
    assert out["gps_present_in_output"] is False
    assert b"GPSLatitude" not in jpeg
    assert b"GPSLatitude" not in webp
    # Re-open: no GPS EXIF remains (XMP/IPTC may be present).
    assert source_has_gps(jpeg) is False
    try:
        gps = piexif.load(jpeg).get("GPS") or {}
    except Exception:
        gps = {}
    assert not gps
    # SEO metadata was written.
    assert b"dc:title" in jpeg or b"Test title" in jpeg
    assert b"westernbootworld.com" in jpeg
    with Image.open(__import__("io").BytesIO(jpeg)) as im:
        assert im.format == "JPEG"
        assert max(im.size) <= 2000
    with Image.open(__import__("io").BytesIO(webp)) as im:
        assert im.format == "WEBP"


def test_photo_without_gps_stays_clean():
    src = (FIX / "aa11.jpg").read_bytes()
    assert source_has_gps(src) is False
    out = optimize_image(src, meta={"title": "A", "description": "B", "keywords": [], "credit": "c", "copyright": "westernbootworld.com"})
    assert out["gps_stripped"] is False
    assert source_has_gps(out["jpeg"]) is False

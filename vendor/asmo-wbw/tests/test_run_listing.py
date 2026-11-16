import json
from pathlib import Path

from asmo_wbw.media import source_has_gps
from asmo_wbw.run import process_listing

ROOT = Path(__file__).resolve().parents[1]
EXAMPLE = json.loads((ROOT / "fixtures" / "listings" / "appendix-example.json").read_text())
MEDIA = ROOT / "fixtures" / "listings" / "media"


def _listing():
    item = json.loads(json.dumps(EXAMPLE))
    item["media"] = [
        {
            "n": 1,
            "stored_url": item["photos"][0],
            "path": str(MEDIA / "aa11.jpg"),
            "content_type": "image/jpeg",
            "exif": {"gps_present": False, "orientation": 1},
        },
        {
            "n": 2,
            "stored_url": item["photos"][1],
            "path": str(MEDIA / "aa12.jpg"),
            "content_type": "image/jpeg",
            "exif": {"gps_present": True, "orientation": 1},
        },
    ]
    # A tiny exact-maker directory so Lucchese can be confirmed exact.
    item["maker_directory"] = [{"name": "Lucchese"}]
    return item


def test_appendix_run_names_and_strips_gps(tmp_path: Path):
    result = process_listing(_listing(), out_dir=tmp_path, fetch=False)
    assert result["ok"], result["errors"]
    assert result["listing_id"] == 1842
    assert result["listing_text_readonly"] is True
    assert result["fetch_used"] is False
    # Leading zeros, no invented mens / leather type.
    slug = result["listing_slug"]
    assert "0123" in slug
    assert slug.startswith("lucchese-")
    assert "mens" not in slug
    assert "leather" not in slug
    assert result["fields"]["style"] == "0123"
    assert result["fields"]["material"] == "Goat"
    assert "material_type" not in result["fields"]
    assert "sized_for" not in result["fields"]
    assert result["flags"]["brand_exact"] is True

    assert result["n_images"] == 2
    first, second = result["images"]
    for row in (first, second):
        assert row["filename"].endswith(".jpg")
        assert row["filename"] == row["filename"].lower()
        assert "-" in row["filename"]
        assert "0123" in row["filename"]
        assert row["alt"]
        assert row["caption"]
        assert row["title"]
        assert row["open_graph"]["og:site_name"] == "Western Boot World"
        assert (tmp_path / row["jpeg"]).is_file()
        assert (tmp_path / row["webp"]).is_file()
        assert row["metadata"]["gps"] is None
        assert "westernbootworld.com" in row["metadata"]["credit"]
    assert first["filename"] != second["filename"]
    assert first["alt"] != second["alt"]
    assert first["caption"] != second["caption"]
    # Photo 2 had GPS and it is gone from the output file.
    assert second["gps_stripped"] is True
    out_jpeg = (tmp_path / second["jpeg"]).read_bytes()
    assert source_has_gps(out_jpeg) is False
    assert b"GPSLatitude" not in out_jpeg
    # Credit uses the seller display name.
    assert result["credit"].startswith("Dan Hoffenberg")


def test_run_does_not_fetch_without_flag(tmp_path: Path):
    item = json.loads(json.dumps(EXAMPLE))
    # No media bytes attached.
    result = process_listing(item, out_dir=tmp_path, fetch=False)
    assert result["fetch_used"] is False
    assert all(im["source"] == "url-not-fetched" for im in result["images"])
    assert all(im["webp"] is None for im in result["images"])
    assert any("not fetched" in n for n in result["notes"])

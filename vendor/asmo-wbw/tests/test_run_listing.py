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


def test_reuses_asmowbw_prior_when_facts_and_urls_match(tmp_path: Path):
    item = _listing()
    first = process_listing(item, out_dir=tmp_path / "a", fetch=False)
    assert first["ok"], first["errors"]
    assert first["facts_fp"]
    assert all(im.get("stored_url") for im in first["images"])
    assert first["reused_applied"] is False
    assert first["reused_source"] is None

    prior = {
        "facts_fp": first["facts_fp"],
        "seo_title": first["seo_title"],
        "seo_description": first["seo_description"],
        "images": [
            {
                "n": im["n"],
                "stored_url": im["stored_url"],
                "filename": im["filename"],
                "alt": im["alt"],
                "caption": im["caption"],
                "title": im["title"],
            }
            for im in first["images"]
        ],
    }
    item2 = _listing()
    item2["asmowbw_prior"] = prior
    second = process_listing(item2, out_dir=tmp_path / "b", fetch=False)
    assert second["ok"], second["errors"]
    assert second["reused_applied"] is True
    assert second["reused_source"] == "asmowbw"
    assert second["facts_fp"] == first["facts_fp"]
    assert second["seo_title"] == first["seo_title"]
    assert second["seo_description"] == first["seo_description"]
    for a, b in zip(first["images"], second["images"], strict=True):
        assert b["filename"] == a["filename"]
        assert b["alt"] == a["alt"]
        assert b["caption"] == a["caption"]
        assert b["stored_url"] == a["stored_url"]


def test_tolerates_asmowbw_alias_for_prior(tmp_path: Path):
    first = process_listing(_listing(), out_dir=tmp_path / "a", fetch=False)
    item = _listing()
    item["asmowbw"] = {
        "facts_fp": first["facts_fp"],
        "seo_title": "Kept SEO title",
        "seo_description": "Kept SEO description that is long enough.",
        "images": [
            {
                "n": im["n"],
                "stored_url": im["stored_url"],
                "file": "custom-prior-name-%d.jpg" % im["n"],
                "alt": "kept alt %d" % im["n"],
                "caption": "kept caption %d" % im["n"],
            }
            for im in first["images"]
        ],
    }
    second = process_listing(item, out_dir=tmp_path / "b", fetch=False)
    assert second["reused_applied"] is True
    assert second["reused_source"] == "asmowbw"
    assert second["seo_title"] == "Kept SEO title"
    assert second["images"][0]["filename"] == "custom-prior-name-1.jpg"
    assert second["images"][0]["alt"] == "kept alt 1"
    assert second["images"][0]["caption"] == "kept caption 1"


def test_does_not_reuse_when_facts_fingerprint_changes(tmp_path: Path):
    first = process_listing(_listing(), out_dir=tmp_path / "a", fetch=False)
    item = _listing()
    item["asmowbw_prior"] = {
        "facts_fp": "not-the-current-fingerprint",
        "seo_title": "Stale title",
        "images": [
            {"n": im["n"], "stored_url": im["stored_url"], "filename": im["filename"], "alt": im["alt"]}
            for im in first["images"]
        ],
    }
    second = process_listing(item, out_dir=tmp_path / "b", fetch=False)
    assert second["reused_applied"] is False
    assert second["reused_source"] is None
    assert second["seo_title"] != "Stale title"


def test_does_not_reuse_when_photo_urls_change_order(tmp_path: Path):
    first = process_listing(_listing(), out_dir=tmp_path / "a", fetch=False)
    item = _listing()
    # Flip stored_url order on the prior record so URLs no longer match photos[i].
    images = [
        {"n": im["n"], "stored_url": im["stored_url"], "filename": im["filename"], "alt": im["alt"]}
        for im in first["images"]
    ]
    images[0]["stored_url"], images[1]["stored_url"] = images[1]["stored_url"], images[0]["stored_url"]
    item["asmowbw_prior"] = {"facts_fp": first["facts_fp"], "seo_title": first["seo_title"], "images": images}
    second = process_listing(item, out_dir=tmp_path / "b", fetch=False)
    assert second["reused_applied"] is False
    assert second["reused_source"] is None


def test_prefers_asmowbw_prior_over_opt_applied(tmp_path: Path):
    first = process_listing(_listing(), out_dir=tmp_path / "a", fetch=False)
    item = _listing()
    item["asmowbw_prior"] = {
        "facts_fp": first["facts_fp"],
        "seo_title": "From asmoWBW",
        "images": [
            {"n": im["n"], "stored_url": im["stored_url"], "filename": "asmo-prior-%d.jpg" % im["n"], "alt": im["alt"]}
            for im in first["images"]
        ],
    }
    item["opt_applied"] = {
        "media": "lens",
        "facts_fp": first["facts_fp"],
        "seo_title": "From lens",
        "images": [
            {"n": im["n"], "stored_url": im["stored_url"], "file": "lens-prior-%d.jpg" % im["n"], "alt": im["alt"]}
            for im in first["images"]
        ],
    }
    second = process_listing(item, out_dir=tmp_path / "b", fetch=False)
    assert second["reused_source"] == "asmowbw"
    assert second["seo_title"] == "From asmoWBW"
    assert second["images"][0]["filename"] == "asmo-prior-1.jpg"


def test_reuses_opt_applied_lens_when_no_asmo_prior(tmp_path: Path):
    first = process_listing(_listing(), out_dir=tmp_path / "a", fetch=False)
    item = _listing()
    item["opt_applied"] = {
        "media": "lens",
        "facts_fp": first["facts_fp"],
        "seo_title": "Lens title",
        "seo_description": "Lens description.",
        "images": [
            {"n": im["n"], "stored_url": im["stored_url"], "file": "lens-name-%d.jpg" % im["n"], "alt": "lens alt %d" % im["n"]}
            for im in first["images"]
        ],
    }
    second = process_listing(item, out_dir=tmp_path / "b", fetch=False)
    assert second["reused_applied"] is True
    assert second["reused_source"] == "opt_applied"
    assert second["seo_title"] == "Lens title"
    assert second["images"][0]["filename"] == "lens-name-1.jpg"
    assert second["images"][0]["alt"] == "lens alt 1"


def test_og_base_url_makes_og_image_absolute_https(tmp_path: Path):
    item = _listing()
    item["og_base_url"] = "https://cdn.example.com/media/"
    result = process_listing(item, out_dir=tmp_path, fetch=False)
    assert result["ok"], result["errors"]
    og = result["open_graph"]["og:image"]
    assert og.startswith("https://cdn.example.com/media/")
    assert og.endswith(".jpg")
    assert not og.startswith("https://cdn.example.com/media//")
    for im in result["images"]:
        assert im["open_graph"]["og:image"].startswith("https://cdn.example.com/media/")
        assert im["open_graph"]["og:image"].endswith(im["filename"]) or im["jpeg"] in im["open_graph"]["og:image"]


def test_cli_og_base_url_overrides_listing_field(tmp_path: Path):
    item = _listing()
    item["og_base_url"] = "https://from-listing.example/media"
    result = process_listing(
        item,
        out_dir=tmp_path,
        fetch=False,
        og_base_url="https://from-cli.example/cdn",
    )
    assert result["open_graph"]["og:image"].startswith("https://from-cli.example/cdn/")


def test_rejects_non_https_og_base_url(tmp_path: Path):
    from asmo_wbw.contract import ContractError

    item = _listing()
    item["og_base_url"] = "http://insecure.example/media"
    try:
        process_listing(item, out_dir=tmp_path, fetch=False)
        raise AssertionError("expected ContractError")
    except ContractError as exc:
        assert "https" in str(exc).lower()


def test_run_does_not_overwrite_source_blobs(tmp_path: Path):
    item = _listing()
    src = Path(item["media"][0]["path"])
    before = src.read_bytes()
    mtime = src.stat().st_mtime_ns
    result = process_listing(item, out_dir=tmp_path, fetch=False)
    assert result["ok"], result["errors"]
    after = src.read_bytes()
    assert after == before
    assert src.stat().st_mtime_ns == mtime

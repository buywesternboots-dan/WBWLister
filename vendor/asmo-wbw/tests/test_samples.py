"""Run the namer over copies of the photo-to-video sample listings.

The photo-to-video tree is read-only: images are copied into a temp folder
before anything is named.
"""

from __future__ import annotations

import shutil
from pathlib import Path

from asmo_wbw.parse import load_description_file
from asmo_wbw.pipeline import preview_boot
from tests.conftest import listing_photos

FIX = Path(__file__).resolve().parents[1] / "fixtures" / "descriptions"

CASES = [
    (
        "lucchese",
        "lucchese-caiman.txt",
        "lucchese-caiman-belly-cowboy-boots-size-9-ee",
    ),
    (
        "tecovas",
        "tecovas-1000.txt",
        "tecovas-tan-leather-cowboy-boots-size-12-d",
    ),
    (
        "tony_lama",
        "tony-lama-rattlesnake.txt",
        "tony-lama-diamondback-rattlesnake-western-boots-size-9-5-d",
    ),
    (
        "vintage_shoe",
        "vintage-shoe-company.txt",
        "vintage-shoe-company-brown-leather-harness-ankle-boots-size-7-m",
    ),
    (
        "ferragamo",
        "ferragamo-loafers.txt",
        "salvatore-ferragamo-tan-suede-slip-on-loafers-size-3",
    ),
]


def test_preview_on_copies_of_each_sample(tmp_path: Path):
    for key, desc_name, expected_slug in CASES:
        photos = listing_photos(key)
        work = tmp_path / key
        work.mkdir()
        copies = []
        for src in photos:
            dest = work / src.name
            shutil.copy2(src, dest)
            copies.append(dest)
        # Source files must still be in the cache, unchanged.
        for src, dest in zip(photos, copies):
            assert src.is_file()
            assert dest.is_file()
            assert src.read_bytes() == dest.read_bytes()
        parsed = load_description_file(FIX / desc_name)
        preview = preview_boot(copies, parsed)
        assert preview["listing_slug"] == expected_slug
        assert preview["n_images"] == len(copies)
        names = [row["proposed_name"] for row in preview["images"]]
        assert len(names) == len(set(names)), names
        for row in preview["images"]:
            assert row["proposed_name"].startswith(expected_slug)
            assert row["view"] in {
                "side",
                "front",
                "toe",
                "sole",
                "heel",
                "back",
                "detail",
                "pair",
            }
            # Copies only — the working files were not renamed by preview.
            assert Path(row["original_path"]).is_file()
        # And the photo-to-video originals were not touched.
        for src in photos:
            assert src.is_file()
            assert src.resolve().parts[:4] == ("/", "workspace", "photo-to-video", "cache")

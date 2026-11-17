from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

FIXTURES = ROOT / "fixtures"
PTV_MANIFESTS = Path(
    "/workspace/photo-to-video/samples/v5-grounded/queue-pending"
)

SAMPLE_IDS = {
    "lucchese": "LP-f8727fcc0269",
    "tecovas": "LP-0b82048eb427",
    "tony_lama": "LP-e29e881c95af",
    "vintage_shoe": "LP-ed13c8228252",
    "ferragamo": "LP-e16da57a4147",
}


def listing_photos(listing_key: str) -> list[Path]:
    lid = SAMPLE_IDS[listing_key]
    man = PTV_MANIFESTS / lid / "manifest.json"
    if not man.is_file():
        pytest.skip(f"sample manifest missing: {man}")
    data = json.loads(man.read_text(encoding="utf-8"))
    paths = []
    for photo in data.get("photos") or []:
        p = Path(photo.get("path") or "")
        if photo.get("is_filler"):
            continue
        if p.is_file():
            paths.append(p)
    if not paths:
        pytest.skip(f"no cached photos for {lid}")
    return paths

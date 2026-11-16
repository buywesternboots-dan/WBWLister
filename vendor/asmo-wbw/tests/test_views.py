from pathlib import Path

from asmo_wbw.views import classify_image, score_views
from tests.conftest import listing_photos

# Seller-order labels on these photos are often wrong. Ground truth was
# checked against the actual Lucchese frames (copies only; originals stay put).
LUCCHESE_TRUTH = {
    0: "side",
    1: "toe",
    2: "sole",
    3: "pair",
    4: "back",
    5: "front",
    6: "heel",
}


def test_lucchese_key_views_from_silhouette():
    photos = listing_photos("lucchese")
    got = {}
    for idx, expected in LUCCHESE_TRUTH.items():
        result = classify_image(photos[idx])
        got[idx] = result.view
        assert result.view == expected, (
            f"photo {idx}: expected {expected}, got {result.view} "
            f"scores={result.scores} feats={result.features}"
        )
        # The clearly distinct silhouettes should be high-confidence.
        if expected in {"side", "front", "sole", "back", "toe", "heel"}:
            assert result.confirm_queue is False, (
                f"photo {idx} ({expected}) should be high confidence, "
                f"conf={result.confidence} scores={result.scores}"
            )


def test_low_confidence_detail_is_flagged():
    # A feature-less (or studio-less, heavy crop) frame should land in
    # the confirm queue rather than be forced into a boot view.
    scores = score_views(
        {
            "studio": 0.0,
            "n": 1,
            "split": False,
            "area": 0.92,
            "fill": 0.92,
            "aspect": 1.0,
            "dx": 0.0,
            "lum": 160,
            "topw": 1.0,
            "botw": 1.0,
            "crop_top": 1,
            "crop_bot": 1,
            "crop_side": 1,
        }
    )
    assert max(scores, key=scores.get) == "detail"
    assert scores["detail"] >= 0.6


def test_side_score_needs_l_shape_offset():
    side = score_views(
        {
            "studio": 1.0,
            "n": 1,
            "split": False,
            "area": 0.37,
            "fill": 0.45,
            "aspect": 1.17,
            "dx": 0.28,
            "lum": 66,
            "topw": 0.45,
            "botw": 0.88,
            "crop_top": 0,
            "crop_bot": 0,
            "crop_side": 0,
        }
    )
    assert max(side, key=side.get) == "side"
    assert side["side"] >= 0.6


def test_non_studio_backdrop_is_confirm_queue(tmp_path):
    """A photo that is not on a light seamless should not be a confident detail."""
    from PIL import Image
    from asmo_wbw.views import classify_image

    img = tmp_path / "blanket.jpg"
    # Dark, busy backdrop — nothing like a studio seamless.
    Image.new("RGB", (200, 260), (80, 50, 40)).save(img, "JPEG")
    result = classify_image(img)
    assert result.confirm_queue is True
    assert result.confidence <= 0.45

from pathlib import Path

from PIL import Image

from asmo_wbw.hashutil import sha256_file
from asmo_wbw.parse import parse_description
from asmo_wbw.pipeline import batch_boot, preview_boot, undo_target


DESC = """
Ariat
Tan leather roper boots
Color: Tan
US Men's size: 10D
"""


def _tiny_jpeg(path: Path, color: tuple[int, int, int]) -> None:
    Image.new("RGB", (32, 32), color).save(path, "JPEG")


def test_preview_does_not_rename(tmp_path: Path):
    img = tmp_path / "IMG_001.jpg"
    _tiny_jpeg(img, (40, 40, 40))
    original = sha256_file(img)
    parsed = parse_description(DESC)
    views = [
        {
            "path": str(img),
            "view": "side",
            "confidence": 0.9,
            "confirm_queue": False,
            "ext": ".jpg",
        }
    ]
    preview = preview_boot([img], parsed, precomputed_views=views)
    assert preview["listing_slug"] == "ariat-tan-leather-roper-boots-size-10-d"
    assert preview["images"][0]["proposed_name"] == (
        "ariat-tan-leather-roper-boots-size-10-d-side.jpg"
    )
    assert img.exists()
    assert sha256_file(img) == original
    assert img.name == "IMG_001.jpg"


def test_batch_renames_and_undo_restores_exact_bytes(tmp_path: Path):
    img = tmp_path / "SHOT.jpg"
    _tiny_jpeg(img, (90, 40, 20))
    original = sha256_file(img)
    original_bytes = img.read_bytes()
    parsed = parse_description(DESC)
    views = [
        {
            "path": str(img),
            "view": "pair",
            "confidence": 0.91,
            "confirm_queue": False,
            "ext": ".jpg",
        }
    ]
    store = tmp_path / "store"
    result = batch_boot([img], parsed, store, precomputed_views=views, recover_first=False)
    assert result["n_renamed"] == 1
    new_path = Path(result["results"][0]["new_path"])
    assert new_path.name == "ariat-tan-leather-roper-boots-size-10-d-pair.jpg"
    assert new_path.is_file()
    assert not img.exists()
    assert sha256_file(new_path) == original
    undone = undo_target(str(new_path), store)
    assert undone["ok"], undone
    assert img.is_file()
    assert not new_path.exists()
    assert img.read_bytes() == original_bytes
    assert sha256_file(img) == original


def test_batch_skips_low_confidence_unless_forced(tmp_path: Path):
    img = tmp_path / "blur.jpg"
    _tiny_jpeg(img, (200, 200, 200))
    parsed = parse_description(DESC)
    views = [
        {
            "path": str(img),
            "view": "detail",
            "confidence": 0.4,
            "confirm_queue": True,
            "ext": ".jpg",
        }
    ]
    store = tmp_path / "store"
    skipped = batch_boot([img], parsed, store, precomputed_views=views, recover_first=False)
    assert skipped["n_renamed"] == 0
    assert skipped["n_skipped"] == 1
    assert img.exists()
    assert (store / "confirm-queue.json").is_file()
    forced = batch_boot(
        [img],
        parsed,
        store,
        precomputed_views=views,
        include_low_confidence=True,
        recover_first=True,
    )
    assert forced["n_renamed"] == 1
    assert not img.exists()


def test_crash_recovery_restores_original(tmp_path: Path):
    from asmo_wbw.hashutil import sha256_file as digest
    from asmo_wbw.journal import Journal, recover_pending

    img = tmp_path / "keep-me.jpg"
    _tiny_jpeg(img, (10, 20, 30))
    original = digest(img)
    store = tmp_path / "store"
    journal = Journal(store)
    op = journal.begin_op(
        batch_id="b1",
        original_path=str(img),
        original_hash=original,
        profile="asmo-wbw",
        profile_version="0.1.0",
        provider_used="test",
        actions={"plan": {"proposed_path": str(tmp_path / "renamed.jpg")}},
    )
    journal.store_blob(original, img)
    journal.commit_op(op["op_id"], blob_hash=original)
    # Simulate a crash after the original was removed and the dest was partial.
    partial = tmp_path / "renamed.jpg"
    partial.write_bytes(b"truncated")
    img.unlink()
    journal.close()
    notes = recover_pending(store)
    assert img.is_file()
    assert digest(img) == original
    assert not partial.exists()
    assert any("restored original" in n for n in notes)

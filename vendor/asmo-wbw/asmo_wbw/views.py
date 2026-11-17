"""Assign a view word to each boot photo from local image analysis.

View words: side, front, toe, sole, heel, back, detail, pair.

Uses a studio-backdrop silhouette (and, when available, the existing
local cut-out models already on the box). CPU only, no uploads, no
cloud APIs. Low-confidence guesses are flagged for a confirm queue.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image, ImageOps

VIEW_WORDS = ("side", "front", "toe", "sole", "heel", "back", "detail", "pair")

# A proposal is high-confidence when the top score clears the floor and
# beats the runner-up by a margin.
CONFIDENCE_FLOOR = 0.60
CONFIDENCE_MARGIN = 0.12
ANALYZE_SIZE = 320

_CV2 = None
_ORT_READY: bool | None = None


def _cv2():
    global _CV2
    if _CV2 is False:
        return None
    if _CV2 is None:
        try:
            import cv2  # type: ignore

            _CV2 = cv2
        except ImportError:
            _CV2 = False
            return None
    return _CV2


def _erode(mask: np.ndarray, k: int = 3) -> np.ndarray:
    cv2 = _cv2()
    if cv2 is not None:
        return cv2.erode(mask, np.ones((k, k), np.uint8))
    from numpy.lib.stride_tricks import sliding_window_view

    pad = k // 2
    p = np.pad(mask, pad)
    return sliding_window_view(p, (k, k)).min(axis=(-1, -2)).astype(np.uint8)


def _dilate(mask: np.ndarray, k: int = 3) -> np.ndarray:
    cv2 = _cv2()
    if cv2 is not None:
        return cv2.dilate(mask, np.ones((k, k), np.uint8))
    from numpy.lib.stride_tricks import sliding_window_view

    pad = k // 2
    p = np.pad(mask, pad)
    return sliding_window_view(p, (k, k)).max(axis=(-1, -2)).astype(np.uint8)


def _open(mask: np.ndarray, k: int = 3) -> np.ndarray:
    return _dilate(_erode(mask, k), k)


def _connected_components(mask: np.ndarray, min_frac: float = 0.02) -> list[dict[str, Any]]:
    """Run-length union-find; returns large components in area order."""
    h, w = mask.shape
    # First pass: label horizontal runs.
    run_labels = []
    parent: list[int] = []

    def find(a: int) -> int:
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a

    def union(a: int, b: int) -> None:
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[rb] = ra

    prev: list[tuple[int, int, int]] = []  # start, end, label
    next_id = 0
    for y in range(h):
        row = mask[y]
        runs: list[tuple[int, int, int]] = []
        x = 0
        while x < w:
            if not row[x]:
                x += 1
                continue
            x0 = x
            while x < w and row[x]:
                x += 1
            lab = next_id
            parent.append(lab)
            next_id += 1
            # union with overlapping runs on the previous row
            for ps, pe, pl in prev:
                if pe < x0 - 1:
                    continue
                if ps > x:
                    break
                if ps <= x and pe >= x0 - 1:
                    union(lab, pl)
            runs.append((x0, x, lab))
        run_labels.append(runs)
        prev = runs

    buckets: dict[int, list[tuple[int, int, int]]] = {}
    for y, runs in enumerate(run_labels):
        for x0, x1, lab in runs:
            root = find(lab)
            buckets.setdefault(root, []).append((y, x0, x1))

    total = h * w
    comps = []
    for runs in buckets.values():
        area = int(sum(x1 - x0 for _, x0, x1 in runs))
        if area < min_frac * total:
            continue
        ys = [y for y, _, _ in runs]
        xs0 = [x0 for _, x0, _ in runs]
        xs1 = [x1 for _, _, x1 in runs]
        miny, maxy = min(ys), max(ys)
        minx, maxx = min(xs0), max(x1 - 1 for x1 in xs1)
        comps.append(
            {
                "area": area,
                "miny": miny,
                "maxy": maxy,
                "minx": minx,
                "maxx": maxx,
                "runs": runs,
            }
        )
    comps.sort(key=lambda c: -c["area"])
    return comps


def _valley_split(mask: np.ndarray) -> dict[str, Any]:
    """True when a vertical valley separates two similar side-by-side masses."""
    h, w = mask.shape
    col = mask.mean(0).astype(np.float64)
    # Smooth so a 1-pixel gap is not required, but a real trough still shows.
    kernel = np.ones(5) / 5.0
    col = np.convolve(col, kernel, mode="same")
    a, b = int(w * 0.18), int(w * 0.82)
    mid = col[a:b]
    if mid.size < 12:
        return {"split": False, "val": 1.0, "left": 0.0, "right": 0.0}
    # Prefer an interior minimum with peaks on both sides (not an edge dip).
    margin = max(4, mid.size // 8)
    best = None
    for i in range(margin, mid.size - margin):
        val = float(mid[i])
        left = float(mid[:i].max())
        right = float(mid[i + 1 :].max())
        if val < 0.28 and left > 0.4 and right > 0.4:
            # Prominence: the trough should sit clearly below both peaks.
            prom = min(left, right) - val
            if prom >= 0.18:
                cand = (prom, -val, i, val, left, right)
                if best is None or cand > best:
                    best = cand
    if best is None:
        k = int(np.argmin(mid))
        return {
            "split": False,
            "val": round(float(mid[k]), 3),
            "left": round(float(mid[: max(k, 1)].max()) if k else 0.0, 3),
            "right": round(float(mid[k + 1 :].max()) if k < len(mid) - 1 else 0.0, 3),
        }
    _, _, _i, val, left, right = best
    return {"split": True, "val": round(val, 3), "left": round(left, 3), "right": round(right, 3)}


def studio_mask(path: str | Path, size: int = ANALYZE_SIZE) -> dict[str, Any]:
    """Foreground mask from a light studio seamless, plus basic geometry."""
    with Image.open(path) as im:
        im = ImageOps.exif_transpose(im).convert("RGB")
        im.thumbnail((size, size), Image.Resampling.BILINEAR)
        arr = np.asarray(im, dtype=np.float32)
    h, w = arr.shape[:2]
    b = max(4, min(h, w) // 40)
    ring = np.concatenate(
        [
            arr[:b].reshape(-1, 3),
            arr[-b:].reshape(-1, 3),
            arr[:, :b].reshape(-1, 3),
            arr[:, -b:].reshape(-1, 3),
        ]
    )
    med = np.median(ring, axis=0)
    dist = np.sqrt(((arr - med) ** 2).sum(-1))
    ring_close = float(np.mean(np.sqrt(((ring - med) ** 2).sum(1)) < 22))
    studio = float((med.mean() > 200) and (ring_close > 0.5))
    raw = (dist > 30).astype(np.uint8)
    mask = _open(raw, 3)
    comps = _connected_components(mask, min_frac=0.02)
    # Keep components that are a meaningful fraction of the largest.
    if comps:
        top = comps[0]["area"]
        comps = [c for c in comps if c["area"] >= max(0.08 * top, 0.02 * h * w)]
    split = _valley_split(mask)
    ys, xs = np.where(mask)
    feats: dict[str, Any] = {
        "studio": studio,
        "ring_close": round(ring_close, 3),
        "n": len(comps),
        "area": round(float(mask.mean()), 3) if mask.size else 0.0,
        "split": bool(split["split"]),
        "valley": split,
        "width": w,
        "height": h,
    }
    if len(xs) == 0:
        feats.update(fill=0, aspect=1, dx=0, lum=0, topw=0, botw=0, crop_top=0, crop_bot=0, crop_side=0)
        return {"mask": mask, "rgb": arr, "comps": comps, "features": feats}
    minx, maxx, miny, maxy = int(xs.min()), int(xs.max()), int(ys.min()), int(ys.max())
    bbw = max(maxx - minx + 1, 1)
    bbh = max(maxy - miny + 1, 1)
    fill = float(len(xs) / (bbw * bbh))
    top_band = ys <= miny + bbh * 0.33
    bot_band = ys >= miny + bbh * 0.66
    topx = float(xs[top_band].mean()) if np.any(top_band) else (minx + maxx) / 2
    botx = float(xs[bot_band].mean()) if np.any(bot_band) else (minx + maxx) / 2
    topw = float((mask[miny : miny + max(bbh // 4, 1)].mean(0) > 0).sum() / bbw)
    botw = float((mask[max(maxy - bbh // 4 + 1, 0) : maxy + 1].mean(0) > 0).sum() / bbw)
    lum = float(arr[mask.astype(bool)].mean())
    # Saturation-ish: channel spread of foreground (worn soles are flatter).
    fg = arr[mask.astype(bool)]
    sat = float(fg.std(axis=0).mean()) if len(fg) else 0.0
    feats.update(
        fill=round(fill, 3),
        aspect=round(bbh / bbw, 3),
        dx=round((botx - topx) / bbw, 3),
        lum=round(lum, 1),
        sat=round(sat, 1),
        topw=round(topw, 3),
        botw=round(botw, 3),
        crop_top=int(miny <= 1),
        crop_bot=int(maxy >= h - 2),
        crop_side=int(minx <= 1 or maxx >= w - 2),
    )
    return {"mask": mask, "rgb": arr, "comps": comps, "features": feats}


def _try_cutout_mask(path: str | Path, size: int = ANALYZE_SIZE) -> np.ndarray | None:
    """Optional local ONNX cut-out (the models already on this box). Never required."""
    global _ORT_READY
    if _ORT_READY is False:
        return None
    try:
        import sys

        ptv_root = Path("/workspace/photo-to-video")
        if str(ptv_root) not in sys.path:
            sys.path.append(str(ptv_root))
        from ptv.cutout import cutout  # type: ignore

        result = cutout(str(path), max_side=size, allow_scene=True)
        _ORT_READY = True
        alpha = result.get("alpha")
        if alpha is None:
            return None
        return (alpha > 0.5).astype(np.uint8)
    except Exception:
        _ORT_READY = False
        return None


def score_views(features: dict[str, Any]) -> dict[str, float]:
    """Heuristic scores in 0..1 for each view word. Not a trained model."""
    s = {v: 0.0 for v in VIEW_WORDS}
    studio = features.get("studio") or 0
    n = int(features.get("n") or 0)
    split = bool(features.get("split"))
    area = float(features.get("area") or 0)
    fill = float(features.get("fill") or 0)
    aspect = float(features.get("aspect") or 1)
    dx = abs(float(features.get("dx") or 0))
    lum = float(features.get("lum") or 0)
    topw = float(features.get("topw") or 0)
    botw = float(features.get("botw") or 0)
    crop_t = int(features.get("crop_top") or 0)
    crop_b = int(features.get("crop_bot") or 0)
    crop_s = int(features.get("crop_side") or 0)
    heavy_crop = crop_t + crop_b + crop_s

    # Detail: no studio seamless, or the object swallows the frame.
    if studio < 0.5 or area >= 0.88 or (heavy_crop >= 3 and fill >= 0.8):
        s["detail"] += 0.72 + 0.15 * (studio < 0.5) + 0.1 * (area >= 0.88)
    if studio < 0.5 and heavy_crop >= 2:
        s["detail"] += 0.15

    # Side: one L-shaped boot, shaft/foot offset, not cropped off the top.
    if n == 1 and not split and dx >= 0.15 and fill <= 0.58 and not crop_t and studio >= 0.5:
        s["side"] += 0.55 + min(dx, 0.35) + (0.15 if fill <= 0.50 else 0.0)
        if 0.9 <= aspect <= 1.4:
            s["side"] += 0.1

    # Pair: two distinct profile boots, or a stacked/arranged pair that
    # does not split cleanly down the middle and is wide at both ends.
    if n >= 2 and studio >= 0.5 and not crop_t and 0.35 <= area <= 0.7:
        s["pair"] += 0.55
        if dx >= 0.12 or fill <= 0.55:
            s["pair"] += 0.2
    if (
        not split
        and n == 1
        and studio >= 0.5
        and aspect >= 1.3
        and topw >= 0.85
        and botw >= 0.85
        and fill >= 0.65
        and not crop_t
    ):
        s["pair"] += 0.7

    # Back: wider than tall, toes out (bottom much wider than the shafts).
    if studio >= 0.5 and aspect <= 1.0 and (botw - topw) >= 0.25 and not crop_t and area <= 0.7:
        s["back"] += 0.75 + min(botw - topw, 0.3)

    # Front: tall pair, shafts in frame, toes gathered at the bottom
    # (bottom narrower than the shaft tops). Split is helpful but not
    # required when the two boots touch at the toes.
    frontish = (
        studio >= 0.5
        and aspect >= 1.35
        and not crop_t
        and area <= 0.55
        and (topw - botw) >= 0.10
        and fill <= 0.75
    )
    if frontish and (split or n >= 2 or (topw - botw) >= 0.12):
        s["front"] += 0.7
        if topw >= botw:
            s["front"] += 0.12
        if 1.45 <= aspect <= 1.9:
            s["front"] += 0.08

    # Toe: side-by-side vamps, tops cropped, mid/high fill, darker uppers.
    if studio >= 0.5 and split and crop_t and 0.55 <= area <= 0.80 and aspect < 1.3 and lum < 90:
        s["toe"] += 0.75
        if not crop_b:
            s["toe"] += 0.08

    # Sole: two outsoles fully in frame, worn (lighter) leather, mid area.
    if studio >= 0.5 and split and not crop_t and lum >= 90 and 0.4 <= area <= 0.75:
        s["sole"] += 0.75
        if fill >= 0.65:
            s["sole"] += 0.1

    # Heel: close crop of the heel counters, tops leaving the frame, high fill.
    if studio >= 0.5 and (split or n >= 2) and crop_t and area >= 0.75:
        s["heel"] += 0.75
        if fill >= 0.8:
            s["heel"] += 0.12

    # Clamp
    for k in s:
        s[k] = round(min(max(s[k], 0.0), 1.0), 3)
    return s


@dataclass
class ViewResult:
    path: str
    view: str
    confidence: float
    confirm_queue: bool
    scores: dict[str, float] = field(default_factory=dict)
    features: dict[str, Any] = field(default_factory=dict)
    source: str = "silhouette-heuristic"
    notes: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "path": self.path,
            "view": self.view,
            "confidence": self.confidence,
            "confirm_queue": self.confirm_queue,
            "scores": self.scores,
            "features": {k: v for k, v in self.features.items() if k not in {"mask", "rgb", "comps"}},
            "source": self.source,
            "notes": list(self.notes),
        }


def classify_image(path: str | Path, use_cutout: bool = False) -> ViewResult:
    path = str(path)
    data = studio_mask(path)
    feats = data["features"]
    source = "studio-silhouette"
    notes: list[str] = []
    if use_cutout and feats.get("studio", 0) < 0.5:
        alt = _try_cutout_mask(path)
        if alt is not None:
            notes.append("used local cut-out model; studio backdrop was weak")
            source = "cutout-silhouette"
            # Recompute features from the model mask at the mask's own size.
            # Keep it simple: swap the mask into a temporary feature pass.
            # (Cut-out is a fallback, not the default path.)
            ys, xs = np.where(alt)
            if len(xs):
                h, w = alt.shape
                minx, maxx, miny, maxy = int(xs.min()), int(xs.max()), int(ys.min()), int(ys.max())
                bbw = max(maxx - minx + 1, 1)
                bbh = max(maxy - miny + 1, 1)
                feats = {
                    **feats,
                    "n": max(int(feats.get("n") or 1), 1),
                    "area": round(float(alt.mean()), 3),
                    "fill": round(float(len(xs) / (bbw * bbh)), 3),
                    "aspect": round(bbh / bbw, 3),
                    "crop_top": int(miny <= 1),
                    "crop_bot": int(maxy >= h - 2),
                    "crop_side": int(minx <= 1 or maxx >= w - 2),
                    "studio": 0.6,  # treat a confident cut-out as usable
                }
    scores = score_views(feats)
    ranked = sorted(scores.items(), key=lambda kv: -kv[1])
    view, top = ranked[0]
    second = ranked[1][1] if len(ranked) > 1 else 0.0
    if top < 0.35:
        view, top = "detail", max(top, 0.3)
        notes.append("no strong silhouette cue; proposing detail")
    confidence = top
    confirm = (top < CONFIDENCE_FLOOR) or ((top - second) < CONFIDENCE_MARGIN)
    # A dark or cluttered backdrop defeats the studio silhouette. Do not
    # treat "detail" as high-confidence in that case unless a cut-out
    # model actually supported the view.
    if (feats.get("studio") or 0) < 0.5 and source != "cutout-silhouette":
        confirm = True
        confidence = min(float(confidence), 0.45)
        notes.append("non-studio backdrop; confirm-queue")
    if confirm and "low confidence — confirm-queue" not in notes and "non-studio backdrop; confirm-queue" not in notes:
        notes.append("low confidence — confirm-queue")
    elif confirm and "confirm-queue" not in " ".join(notes):
        notes.append("low confidence — confirm-queue")
    return ViewResult(
        path=path,
        view=view,
        confidence=round(float(confidence), 3),
        confirm_queue=bool(confirm),
        scores=scores,
        features=feats,
        source=source,
        notes=notes,
    )


def classify_images(
    paths: list[str | Path],
    use_cutout: bool = False,
) -> list[ViewResult]:
    return [classify_image(p, use_cutout=use_cutout) for p in paths]

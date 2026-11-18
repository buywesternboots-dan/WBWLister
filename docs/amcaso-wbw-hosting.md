# Hosting amcasoWBW for BootLister

> AMCASO (All Media Compression And Search Optimization) was called ASMO before Nov 17, 2026. BootLister reads `AMCASO_WBW_*` env vars first and falls back to the older `ASMO_WBW_*` names. The vendored tool (`vendor/asmo-wbw`, Python package `asmo_wbw` v0.2) and `scripts/asmo-wbw-worker.py` keep their old names on purpose: an installed worker already runs from those paths and env vars. The `items.asmowbw` column, `asmowbw/` Blob prefix, and the old `asmowbw*` API actions are kept for compatibility.

## Current: one-click AMCASO WBW runs inside BootLister (Nov 17, 2026)

The **AMCASO WBW** button (per pair, on the selection bar, and in the header for the whole view) needs no Python, no worker, no PC, and no new env vars. `lib/amcaso-wbw-engine.js` and `lib/amcaso-wbw-media.js` are a JavaScript port of amcasoWBW 0.3.2's WBW path (facts, names, copy, and lossless XMP/IPTC writing, EXIF GPS removal). JPEG, PNG, and WebP keep their pixels and dimensions. GIF and BMP are kept as the original bytes. Nothing is resized or re-encoded at a lower quality. `test/amcaso-engine.test.mjs` checks names and copy against the Python tool's text output (`test/fixtures/amcaso-golden/`).

Per click and per pair, `lib/amcaso-wbw-oneclick.js` reads the pair's original photos, writes one full-size prepared copy per photo under `prepared/<id>/<n>/`, makes those copies `items.photos`, and keeps the originals in `items.asmowbw.original_photos` for **Undo AMCASO WBW**. A pair that fails (unreadable photo, unsupported file) is listed and nothing is written for it; the other pairs still run. A pair whose prepared photos already match its originals and facts is skipped, so a second click stores nothing new. A fact change re-runs from the originals.

Not ported: pixel view analysis (side/front/sole words in names). Photos are named `-N` and "photo N of M", which is what the Python tool does for any photo it cannot classify with confidence.

The Python worker below is the older path behind the `amcasowbw` API action. The UI no longer calls it. A running worker (including one that still reports the old asmoWBW name) is not required for the AMCASO WBW button. `ASMO_WBW_URL` and `ASMO_WBW_TOKEN` stay in the code so an older worker can still answer `/health`, `/run`, and `/undo`.

amcasoWBW v0.2.1 is a local Python CLI (`python -m asmo_wbw run --in listing.json --out-dir out/`). It needs Python 3.11+, Pillow, NumPy, and piexif. It is CPU-only and free. It does not fit comfortably inside a short Vercel serverless request, so the live AMCASO button should call it as a background/sidecar worker.

This PR does not deploy anything, create accounts, or add environment variables. It only documents what a later deploy would need.

## Choice: Python worker on an existing machine (recommended)

Run `scripts/asmo-wbw-worker.py` on the shared box (or any always-on host you already have). It is a small stdlib HTTP wrapper around the vendored tool.

BootLister (on Vercel) builds one listing JSON per click, may attach photo bytes already stored on Vercel Blob, POSTs to the worker, stores the result on `items.asmowbw`, and uploads optimized JPEG/WebP to Blob.

**Why this path:** no new paid service, no size or timeout fight with a Vercel function, and it matches amcasoWBW's own integration note (use a worker or a separate Python service, not a short serverless request). Bulk runs stay operator-triggered: the admin UI sends listings in small batches (one per request).

**What a later deploy would need**

1. Python 3.11+ on the worker host, then:
   `python3 -m venv vendor/asmo-wbw/.venv && vendor/asmo-wbw/.venv/bin/pip install -r vendor/asmo-wbw/requirements.txt`
2. Start the worker, bound to loopback unless you add a shared secret:
   `ASMO_WBW_HOST=127.0.0.1 ASMO_WBW_PORT=8787 vendor/asmo-wbw/.venv/bin/python scripts/asmo-wbw-worker.py`
3. A way for the Vercel app to reach that worker (a tunnel, a private URL, or running BootLister on the same host). Then set `ASMO_WBW_URL` (for example `http://127.0.0.1:8787`). Optional: `ASMO_WBW_TOKEN` and the same value on the worker.
4. Existing `DATABASE_URL` and Vercel Blob token already used by BootLister. No new paid API keys.
5. Raise the `/api/items` route duration if the Vercel function waits on the worker (Pro: `maxDuration` 60–300s). Process one listing per request. Hobby's 10s cap will likely be too short for real photos.

Local CLI fallback (same machine, no HTTP worker): set `ASMO_WBW_PYTHON` to that venv's Python, or place the venv at `vendor/asmo-wbw/.venv`. The Next.js app will spawn `python -m asmo_wbw run`. This works on the box and in tests. It will not work on a standard Vercel Node function, because Python and the image libraries are not there.

## Not chosen: Vercel Python serverless function

A Vercel Python function *might* hold the 114MB venv (Pillow + NumPy + piexif), which is under the usual 250MB uncompressed limit, but:

- Hobby functions time out in 10s (60s in some Fluid setups). Pro defaults to 60s, max 300s. Reading up to 30 full-size photos and writing metadata can overrun a short budget, and a bulk click is worse. The in-app path does not resize or recompress those photos.
- Cold starts with NumPy are slow.
- There is no durable disk for the undo journal (we'd still have to ship files back through the response).
- amcasoWBW's INTEGRATION.md says not to run it inside a short serverless request.

Skip this unless a later measurement shows a single small listing reliably finishes within the plan's limit.

## Not chosen: a new paid worker host

A Render/Fly/Cloud Run service would work the same as the box worker, but it is a new account and may cost money. Only consider it if the existing box cannot be reached from Vercel.

## Rules the worker must keep

- Operator-triggered runs only. No scheduler.
- Never fetch westernbootworld.com or eBay hosts. Prefer photo bytes already on Vercel Blob.
- Listing title, description, price, and size stay read-only.
- Free tools only. No paid AI.

## amcasoWBW v0.2.1

BootLister sends the previous `items.asmowbw` record as `asmowbw_prior`. amcasoWBW reuses filenames, alt, caption, and SEO when `facts_fp` still matches and each image `stored_url` still equals `photos[i]` in order. The stored record keeps `reused_applied`, `reused_source`, `facts_fp`, and per-image `stored_url`.

Every run passes `og_base_url` / `--og-base-url` `https://bootlister.vercel.app` so `og:image` is already an absolute https URL. BootLister does not rewrite it.

Undo uses the `items.asmowbw` record as the source of truth. Original photo blobs and `items.photos` URLs are never overwritten or deleted.

# Hosting asmoWBW for BootLister

asmoWBW v0.2 is a local Python CLI (`python -m asmo_wbw run --in listing.json --out-dir out/`). It needs Python 3.11+, Pillow, NumPy, and piexif. It is CPU-only and free. It does not fit comfortably inside a short Vercel serverless request, so the live ASMO button should call it as a background/sidecar worker.

This PR does not deploy anything, create accounts, or add environment variables. It only documents what a later deploy would need.

## Choice: Python worker on an existing machine (recommended)

Run `scripts/asmo-wbw-worker.py` on the shared box (or any always-on host you already have). It is a small stdlib HTTP wrapper around the vendored tool.

BootLister (on Vercel) builds one listing JSON per click, may attach photo bytes already stored on Vercel Blob, POSTs to the worker, stores the result on `items.asmowbw`, and uploads optimized JPEG/WebP to Blob.

**Why this path:** no new paid service, no size or timeout fight with a Vercel function, and it matches asmoWBW's own integration note (use a worker or a separate Python service, not a short serverless request). Bulk runs stay operator-triggered: the admin UI sends listings in small batches (one per request).

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

- Hobby functions time out in 10s (60s in some Fluid setups). Pro defaults to 60s, max 300s. Optimizing up to 30 photos (decode, resize, JPEG + WebP, EXIF/XMP) can overrun a short budget, and a bulk click is worse.
- Cold starts with NumPy are slow.
- There is no durable disk for the undo journal (we'd still have to ship files back through the response).
- asmoWBW's INTEGRATION.md says not to run it inside a short serverless request.

Skip this unless a later measurement shows a single small listing reliably finishes within the plan's limit.

## Not chosen: a new paid worker host

A Render/Fly/Cloud Run service would work the same as the box worker, but it is a new account and may cost money. Only consider it if the existing box cannot be reached from Vercel.

## Rules the worker must keep

- Operator-triggered runs only. No scheduler.
- Never fetch westernbootworld.com or eBay hosts. Prefer photo bytes already on Vercel Blob.
- Listing title, description, price, and size stay read-only.
- Free tools only. No paid AI.

## TODO (asmoWBW v0.2.1)

Reuse of a still-fresh prior `items.asmowbw` result is coming in asmoWBW v0.2.1. The field name is not settled yet. Leave BootLister as it is until that version lands: do not add a BootLister-side reuse of asmoWBW results, and keep sending the current listing JSON on each run. Today, asmoWBW's `reused_applied` flag only looks at the existing lens `opt_applied` pass.

`og:image` must be an absolute `https` URL after BootLister rewrites it (the Blob JPEG URL, or the site origin plus `/img/{id}/{n}/{file}`). Never leave a relative path.

Undo uses the `items.asmowbw` record as the source of truth. Original photo blobs and `items.photos` URLs are never overwritten or deleted.

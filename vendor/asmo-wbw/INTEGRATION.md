# asmoWBW: integration guide for WBW Lister (BootLister)

asmoWBW v0.2.1 is a local, free, CPU-only Python tool. BootLister hands it one listing JSON
(see specs/bootlister-asmo-input-contract.md). It returns, per photo, an SEO filename, alt text,
caption/title, cleaned metadata (GPS stripped, XMP/IPTC written where possible), web JPEG + WebP,
and Open Graph fields, plus an undo journal. Output contract: specs/asmo-wbw-output-contract.md.

## Install
    python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
    .venv/bin/python -m pytest -q          # 51 tests should pass

## Call it from BootLister (the ASMO button)
    .venv/bin/python -m asmo_wbw run --in listing.json --out-dir out/ --store out/.asmo-wbw --og-base-url https://example.public/media
    cat listing.json | .venv/bin/python -m asmo_wbw run --out-dir out/
    # add --fetch only for an operator-triggered run that downloads photo URLs
Result is JSON on stdout. Images land in out/<listing_id>/.
The CLI `--og-base-url` (or listing field `og_base_url`) must be an https origin so `og:image` is an absolute URL.

## What BootLister should send
- Build the JSON with listingInput(item, seller, media?) as in the input contract.
- Always include title, description, items.verified / items.guessed, and photos in display order.
- Send `style_sample` and/or `maker_directory` so exact maker / maker+style matching works
  without asmoWBW loading the catalog or calling any website. `maker_directory` is an array of
  objects with a name: `[{name}]`, for example `[{"name": "Lucchese"}]`.
- Optionally `media[]` with path/base64 bytes so no download is needed.
- Persist the asmoWBW result on `items.asmowbw`. On the next run, send that record back as
  `asmowbw_prior` (the field `asmowbw` is also accepted). asmoWBW reuses filenames, alt,
  caption, and SEO when `facts_fp` still matches and each image `stored_url` still matches
  `photos[i]` in order — the same freshness rule as the `opt_applied` lens pass.
- Pass `og_base_url` (or `--og-base-url`) so every `og:image` is an absolute https URL.

## Undo and originals
The undo source of truth is the `items.asmowbw` record BootLister stores (the last asmoWBW
result, including `facts_fp` and per-image `stored_url`, filenames, and copy). asmoWBW never
overwrites original photo blobs: derivatives are written only under `--out-dir`, and the
journal under `--store` keeps exact original-byte backups. Do not point `--out-dir` at the
source blob store.

CLI journal undo (restore a derivative from the backup, not a source blob):
    .venv/bin/python -m asmo_wbw undo <op-id-or-path> --store out/.asmo-wbw

## Hard rules (enforced in code, keep them)
- Exact maker and exact maker + full style-number matches only; leading zeros kept.
- Guessed fields used only when also verified or stated in title/description. Nothing invented.
- Listing title/description/price/size are read-only. LP private money columns are never read.
- Operator-triggered bulk runs only; no scheduler. Free tools only; no paid AI.
- Never calls westernbootworld.com or the eBay API.

## Open decisions (Dan's defaults unless he changes them)
1. Stored, non-guessed fields (made_in, sole, measurements) are treated as given, like listingFacts.
2. ~~og:image is a local path; BootLister should rewrite it.~~ Resolved: `og:image` must be an
   absolute https URL. BootLister passes `og_base_url` or `--og-base-url`.
3. Hosting: this is a CLI. On Vercel, run it from a worker/queue or a separate Python service,
   not inside a short serverless request.

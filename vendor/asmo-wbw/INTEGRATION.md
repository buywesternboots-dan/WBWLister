# asmoWBW: integration guide for WBW Lister (BootLister)

asmoWBW v0.2 is a local, free, CPU-only Python tool. BootLister hands it one listing JSON
(see specs/bootlister-asmo-input-contract.md). It returns, per photo, an SEO filename, alt text,
caption/title, cleaned metadata (GPS stripped, XMP/IPTC written where possible), web JPEG + WebP,
and Open Graph fields, plus an undo journal. Output contract: specs/asmo-wbw-output-contract.md.

## Install
    python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
    .venv/bin/python -m pytest -q          # 41 tests should pass

## Call it from BootLister (the ASMO button)
    .venv/bin/python -m asmo_wbw run --in listing.json --out-dir out/ --store out/.asmo-wbw
    cat listing.json | .venv/bin/python -m asmo_wbw run --out-dir out/
    # add --fetch only for an operator-triggered run that downloads photo URLs
Result is JSON on stdout. Images land in out/<listing_id>/.
Undo: .venv/bin/python -m asmo_wbw undo <op-id-or-path> --store out/.asmo-wbw

## What BootLister should send
- Build the JSON with listingInput(item, seller, media?) as in the input contract.
- Always include title, description, items.verified / items.guessed, and photos in display order.
- Send style_sample and/or maker_directory so exact maker / maker+style matching works
  without asmoWBW loading the catalog or calling any website.
- Optionally media[] with path/base64 bytes so no download is needed.

## Hard rules (enforced in code, keep them)
- Exact maker and exact maker + full style-number matches only; leading zeros kept.
- Guessed fields used only when also verified or stated in title/description. Nothing invented.
- Listing title/description/price/size are read-only. LP private money columns are never read.
- Operator-triggered bulk runs only; no scheduler. Free tools only; no paid AI.
- Never calls westernbootworld.com or the eBay API.

## Open decisions (Dan's defaults unless he changes them)
1. Stored, non-guessed fields (made_in, sole, measurements) are treated as given, like listingFacts.
2. og:image is a local path; BootLister should pass or rewrite to the public image base URL.
3. Hosting: this is a CLI. On Vercel, run it from a worker/queue or a separate Python service,
   not inside a short serverless request.

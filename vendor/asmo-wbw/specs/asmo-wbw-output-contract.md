# asmoWBW output contract

**Product:** asmoWBW (`/workspace/asmo-wbw`)
**Input:** [BootLister listing JSON](bootlister-asmo-input-contract.md) (primary). A folder with `description.txt` plus photos remains a secondary CLI mode.
**Entry point:** `python -m asmo_wbw run [--in FILE] [--out-dir DIR] [--store DIR] [--fetch] [--og-base-url URL]`
JSON is read from `--in` or stdin and the result is written to stdout. Optimized files are written under `--out-dir/<listing_id>/`. Original photo bytes are stored in the journal under `--store` (default `--out-dir/<listing_id>/.asmo-wbw`) as backups only — original blobs are never overwritten. Listing text (title, description, price, size) is never rewritten.

The undo source of truth for BootLister is the `items.asmowbw` record (persist this result, including `facts_fp` and each image's `stored_url`). Send it back on the next run as `asmowbw_prior` or `asmowbw`. `--og-base-url` (or the listing field `og_base_url`) is an https base that makes every `og:image` an absolute URL.

`--fetch` is for operator-triggered runs only. There is no scheduler. Tests and default runs use attached `media[].path` / `media[].base64` / `media[].bytes` only. `westernbootworld.com` and eBay hosts are never fetched.

## Result object (one listing)

```ts
type AsmoWbwListingResult = {
  ok: boolean;
  tool: "asmoWBW";
  version: string;
  listing_id: number;
  seller: string;
  facts_fp: string;            // fingerprint of the usable facts (required for next-run reuse)
  reused_applied: boolean;     // true when a still-fresh prior asmoWBW result or opt_applied lens pass was reused
  reused_source: "asmowbw" | "opt_applied" | null;
  listing_slug: string;
  fields: Record<string, unknown>;  // usable facts only (guessed-without-text omitted)
  omitted: Array<{ field: string; reason: string }>;
  flags: {
    brand_exact: boolean;      // exact maker-directory hit
    style_status: "blank" | "none" | "matched" | "ambiguous";
    material_status: "none" | "applied" | "needs-human";
  };
  seo_title: string;
  seo_description: string;     // about 155 characters, listing words plus usable facts
  open_graph: {
    "og:title": string;
    "og:description": string;
    "og:type": "website";
    "og:site_name": "Western Boot World";
    "og:image"?: string;       // must be an absolute https URL when og_base_url is given; otherwise <listing_id>/<filename>
    "og:image:width"?: number;
    "og:image:height"?: number;
    "og:image:alt"?: string;
  };
  credit: string;              // "{display_name || seller} via westernbootworld.com"
  images: AsmoWbwImageResult[];
  confirm_queue: AsmoWbwImageResult[];
  n_images: number;
  n_confirm: number;
  store_dir: string;
  out_dir: string;
  notes: string[];
  errors: string[];
  listing_text_readonly: true;
  fetch_used: boolean;
};

type AsmoWbwImageResult = {
  n: number;                   // 1-based, display order
  stored_url: string;         // echo of the input photo URL; required so the next run can reuse this result
  source: string;              // attached-bytes | attached-base64 | local-path | fetched | url-not-fetched | ...
  view: "side" | "front" | "toe" | "sole" | "heel" | "back" | "detail" | "pair" | null;
  view_source: string | null;  // set only when local pixels were analyzed
  confirm_queue: boolean;      // low-confidence or non-studio view
  filename: string;            // lowercase, hyphenated, unique, max 80 chars before .jpg
  alt: string;
  caption: string;
  title: string;
  keywords: string[];
  jpeg: string;                // <listing_id>/<filename>
  webp: string | null;         // <listing_id>/<stem>.webp when pixels were available
  width: number | null;
  height: number | null;
  gps_stripped: boolean;       // true when GPS was present on the source and removed
  metadata: {
    title: string;
    description: string;
    keywords: string[];
    credit: string;
    copyright: "westernbootworld.com";
    gps: null;
  };
  open_graph: AsmoWbwListingResult["open_graph"];
  op_id: string | null;        // journal id for undo
};
```

A bulk payload (JSON array of listings) returns `{ ok, tool, version, n, results: AsmoWbwListingResult[] }`.

## Filename rule

`brand`, optional gender (`mens` / `womens` / `kids` only when usable), style number **as written** (leading zeros kept), color, material, type (`cowboy-boots` or `belt`), compact size+width (`10d`), then a unique suffix: a high-confidence view word when local pixels support it, otherwise the 1-based index. Descriptors drop first if the stem would exceed 80 characters before `.jpg`. Style number and size/width are pinned.

Guessed fields are not used unless they are also verified or the title/description already states that same value. Ambiguous maker or style-catalog matches are rejected (status `ambiguous`); the style is then taken only from labeled listing text or verified `id_text`.

## Metadata

Web JPEGs are re-encoded (max long edge 2000, quality 85) so GPS and other location EXIF are gone. An XMP packet (title, description, keywords, credit, copyright) and an IPTC APP13 block (same fields, where writable) are inserted. WebP is written at quality 82. Credit is `{seller} via westernbootworld.com`. Email, phone, login material, and private seller notes are never written into image metadata.

## Reuse

On a later operator run, BootLister should send the previous result as `asmowbw_prior` (or `asmowbw`). When that record's `facts_fp` matches the current facts fingerprint and each `images[i].stored_url` still equals `photos[i]` in order, asmoWBW reuses its filenames, alt, caption, and SEO (`seo_title`, `seo_description`) and reports `reused_applied: true` with `reused_source: "asmowbw"`. The same freshness rule applies to a still-fresh `opt_applied` lens pass (`media === "lens"`), which sets `reused_source: "opt_applied"`. A prior asmoWBW result is preferred when both are fresh. If the fingerprint or photo URLs no longer match, names are recomputed.

The output always includes `facts_fp` and per-image `stored_url` so this check can run the next time.

## Undo

The undo source of truth is the `items.asmowbw` record BootLister stores. Original photo blobs are never overwritten; derivatives are written only under `--out-dir`. `python -m asmo_wbw undo <op-id-or-path> --store DIR` restores exact original bytes from the journal backup (same contract as ASMO) and is not a write back to the source blob store.

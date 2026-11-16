# Prompt for the ASMO developer: BootLister boot data feed

You're building ASMO, a global tool that optimizes photos and media (filenames, alt text, captions, image metadata, web-sized versions, social share fields) for search. BootLister, Dan's western boot listing tool at bootlister.vercel.app, wants to use ASMO for boots. Build ASMO so it can take BootLister's boot data as an optional, category-specific input. BootLister calls ASMO; ASMO does not need to know BootLister's internals.

## What BootLister can hand ASMO, per listing
- One JSON object per listing (the full shape and an example are in the appendix).
- **Always:** listing id, seller, source platform and source listing id, source URL, status, category (boot or belt), photo URLs in display order (up to 30), title, description, ID text read off the tag, and brand, size, width, color, material, toe, heel, condition and similar fields. Each field is marked as verified or guessed.
- **Bonus, when present:** boot measurements, exact maker and exact maker plus full style-number reference matches, ID photos (tag, insole and box stamps with the text read off them), other marketplaces it's listed on, seller settings, the photo bytes (EXIF and dimensions), and computed WBW export and social fields.

## Rules ASMO must follow for the boot data
1. Use only exact maker matches and exact maker plus full style-number matches. No fuzzy, partial or ambiguous matches. Keep leading zeros in style numbers.
2. Don't name from guessed fields unless they're also verified or stated in the listing's own text. Never invent a missing value; leave it out.
3. Photos and media metadata may be replaced. Listing text (title, description, price, size) is read-only.
4. Vary the wording across listings so they don't all read the same.
5. Strip GPS data from photos.
6. Runs happen in bulk, only when the operator triggers them. No scheduled runs.
7. Free tools only, with no paid AI or API calls. No calls to westernbootworld.com and no live eBay API.

## What BootLister needs back, per photo
An SEO filename (lowercase, hyphenated, unique), alt text, a caption or title, cleaned metadata, a web-optimized JPEG plus WebP, and Open Graph fields, plus a way to undo or restore the originals.

## Target destination
Western Boot World (westernbootworld.com) listings, and anywhere those photos travel from WBW (Google Images, social shares).

---
# Appendix: BootLister data contract (field-level detail)
# ASMO Input Contract

**Product:** BootLister (repo `buywesternboots-dan/WBWLister`)
**Based on:** `main` at `e4fb700` (2026-11-16). Draft pipeline PRs #37/#38/#40 are not required for this contract; they add seller policy/opt-in columns only, not listing fields.
**Purpose:** Define every field ASMO may read when Dan/admin clicks **ASMO** and it names and optimizes listing photos/media. This is an input contract only. It does not change listing title, description, price, or size.

**Hard rules**

- Use only exact maker matches and exact maker + full style-number matches. No fuzzy, partial, or ambiguous catalog hits.
- Leading zeros in style numbers stay as written (`0123` stays `0123`).
- Guessed fields (`items.guessed`) are not used for naming unless the same field is also in `items.verified`, or the listing's own title/description already states that same value (same rule as `listingFacts` / `imageValues` in `lib/facts.js` and `lib/model.js`).
- List Perfectly private money columns are never read: `Notes`, `Cost of Goods`, `Sold Price`, `Shipping Cost`, `Other Costs`, `Sold Date`, `Profit` (`LP_PRIVATE` in `lib/lp.js`).
- ASMO does not call westernbootworld.com or the live eBay API. It only reads data already stored on the BootLister item, the seller row, bundled reference snapshots, and the photo bytes themselves.

---

## 1. Core data ASMO can always expect per listing

These are real columns or always-materialized fields on an `items` row (`lib/wbw.js`: `FIELDS`, `create table items`, later `alter table` columns). ASMO always reads this set. Values may be null or empty; a missing value is omitted from the name, never invented.

### Identity and source

| Field | Type | Notes |
|---|---|---|
| `id` | integer (serial PK) | BootLister listing id. Always present after insert. |
| `seller` | text | WBW seller slug (`sellers.name`). Always present. Lowercased. |
| `source` | text, nullable | Import origin. Known values: `listperfectly`, `facebook`, `depop`, `ebay`, `poshmark`, or a shop hostname (Shopify/generic). |
| `source_id` | text, nullable | Per-source listing key. Unique with `(seller, source, source_id)`. See source mapping in §3. There is no separate `sku` column. |
| `source_url` | text, nullable | Canonical source page URL when the importer had one. Marketplace exports leave this blank in the WBW CSV (`MARKET` sources in `lib/export.js`). |
| `status` | text | `review`, `published`, `pending`, `sold`, `removed`, `archived`. |
| `boot` | text | Category: `boot`, `belt`, `unsure`, or other. Used only for the noun (`cowboy boots` / `belt`); never guessed. |
| `boot_score` | real, nullable | Classifier score. Not used in filenames. |

### Photos (required input, may be an empty array on a bad/partial row)

| Field | Type | Notes |
|---|---|---|
| `photos` | `text[]` | Stored photo URLs, in display order, max 30 (`MAX_PHOTOS`). A URL is either a Vercel Blob URL (`https://*.blob.vercel-storage.com/...`) or the original source URL when Blob put failed or was skipped. Index is 1-based in names (`n`). |
| `src_photos` | text, nullable | List Perfectly: original source photo URLs joined by newlines, used to avoid re-downloading unchanged galleries. Other sources usually leave this null. |

### Listing copy and IDs (editable listing fields; ASMO may read, not rewrite)

From `FIELDS` in `lib/wbw.js`. All text unless noted.

| Field | Type | Notes |
|---|---|---|
| `title` | text, nullable | Live listing title. |
| `description` | text, nullable | Live listing description. May include an appended maker note. |
| `id_text` | text, nullable | Exported as **Model / date codes**. Style/model/lot/SKU tokens the seller or a photo scan stored here. Used for naming only when verified, or when `listingModel()` can read a labeled model/style/lot/SKU from title/description (or from `opt_original`). |
| `price` | numeric, nullable | Source price. Not used in filenames. |
| `wbw_price` | numeric, nullable | Asking price on WBW. Not used in filenames. |
| `brand` | text, nullable | Maker name as stored. Canonicalized only after an **exact** directory match (`exactMaker`). |
| `sized_for` | text, nullable | `Men`, `Women`, or `Kids`. Used only if verified or the listing text states gender. |
| `size` | text, nullable | Shoe size, as written. Leading zeros are not a style number. |
| `size_estimated` | text, nullable | `Yes` when size is estimated. |
| `width` | text, nullable | Exact stored width (`A`, `B`, `C`, `D`, `E`, `EE`, `N`, `AA`, `AAA`, …). Filenames and alt text keep the exact width. The WBW CSV Width column may display `AAA` as `A`; ASMO does not. |
| `material_type` | text, nullable | |
| `material` | text, nullable | Hide / material. Applied from a catalog card only on an exact material name match. |
| `material_cut` | text, nullable | |
| `made_in` | text, nullable | |
| `condition` | text, nullable | Used only if verified or the listing text states the same condition. |
| `color` | text, nullable | |
| `keywords` | text, nullable | Free-text keywords already on the item. |
| `sole_length` | text, nullable | Inches, as stored. |
| `sole_width` | text, nullable | |
| `heel_height` | text, nullable | |
| `shaft_circ` | text, nullable | |
| `shaft_height` | text, nullable | |
| `sole` | text, nullable | |
| `heel` | text, nullable | |
| `toe` | text, nullable | |

### Reliability flags (always present as arrays; often empty)

| Field | Type | Notes |
|---|---|---|
| `guessed` | `text[]` default `{}` | Fields `enrich()` inferred from free text. Not used in names unless also `verified` or restated in listing text. |
| `verified` | `text[]` default `{}` | Fields the seller or admin confirmed. Always usable. |
| `opt_error` | text, nullable | Last optimization error, if any. |

### Source snapshot and existing photo-SEO (JSONB; may be null on older rows)

| Field | Type | Notes |
|---|---|---|
| `opt_original` | jsonb, nullable | Import snapshot from `importOriginal()`: `title`, `description`, `price`, `brand`, `size`, `width`, `material`, `photos`, `captured_at`, optional `src_hash`, optional nested `first` (first-import snapshot). ASMO reads both live fields and this snapshot so a later edit does not hide the source wording. |
| `opt_proposal` | jsonb, nullable | Last Prepare draft. Includes `images[]` (`n`, `file`, `alt`, `stored_url`, `source_renamed`, `pixels`), `facts_fp`, `style_sample`, `portable.seo_title`, `portable.seo_description`, `maker_note`, `used`, `omitted`. |
| `opt_applied` | jsonb, nullable | Last applied images-SEO pass (`media: "lens"`, `scope: "images-seo"`). `images[]` plus `facts_fp`, `seo_title`, `seo_description`. Reuse these names when the facts fingerprint still matches; otherwise recompute. |

### Seller row always joined for naming credit / context

Looked up by `items.seller = sellers.name`. Core public fields ASMO can expect on the seller record (values may be null): `name`, `display_name`, `location`, `website`, `brand_context`. Login hashes and invite tokens are never read.

---

## 2. Bonus / optional data (parse and use when present)

None of these are guaranteed. When present and reliable, ASMO should use them for richer, more specific names, alt text, captions, keywords, and social fields. When absent, skip them. Do not invent a substitute.

### IDs and marketplace leftovers

| Data | Where it lives today | How to use |
|---|---|---|
| List Perfectly `SKU` | **Not stored as its own column.** It may appear inside `source_id` when LP `Date` is missing or shared by two rows (`lpSourceId` in `lib/lp.js`: `Date`, or `Date + SKU + main-image filename`, or `SKU + filename`, or `SKU`). | Parse a SKU token out of `source_id` only when it is clearly the LP SKU (not a Date). Prefer a labeled `SKU:` / `Style:` / `Model:` token from title, description, or `id_text`. |
| `markets` | text, nullable | LP marketplace columns that had a value, joined with `", "` (eBay, Etsy, Poshmark, …). Useful as a keyword, not a filename stem. |
| `source_condition` | text, nullable | Raw condition string from the source, when kept separately from `condition`. |
| `posted` | jsonb, nullable | Cross-post records. Not a naming input. |
| `missing_group_price` | boolean default false | Museum (Dan Hoffenberg) LP rows where Seller Notes did not yield one group price. Not a naming input. |

### List Perfectly Seller Notes

`lib/lp.js` treats `Notes` as a **private** column (`LP_PRIVATE`). `Seller Notes` / `Notes` / `Comments` / `Comment` are read only to parse a museum **group price**. The note text itself is **not stored** on the item (`Notes text is not returned`).

If a future import or an admin-supplied payload includes a non-private notes field (for example a dedicated `seller_notes` string that is not one of `LP_PRIVATE`), ASMO should parse it for labeled model/style/SKU/color/measurement facts. It must still ignore private money columns and must not write those notes onto the public listing description.

### Measurements

`sole_length`, `sole_width`, `heel_height`, `shaft_circ`, `shaft_height` are core columns but are often empty. When present and not merely guessed, they may go into alt text, IPTC/XMP description or keywords, and captions. They should not dominate the filename (length cap still applies).

### Exact maker / style reference matches

| Data | Where | Use only when |
|---|---|---|
| Bundled maker directory | sent as `maker_directory?: { name: string }[]` (from `lib/wbw-ref.js` `bundledDirectory`) | Name-only rows. Use when exactly one maker name matches the listing brand. |
| Style snapshot | sent as the per-listing `style_sample` match object from `matchStyleSample()` | Status is `candidate` and `matches.length === 1` (exact maker + full style number). Ambiguous or blank → ignore. Style string is kept verbatim, including leading zeros. BootLister does not send the raw models.csv catalog. |
| `style_ref` | `items.style_ref` jsonb | Seller/admin accepted a catalog card (`acceptedStyleRef`). Shape includes `maker_name`, `style_number`, `record_title`, `record_url`, `source_url`, `other_card_text`, `accepted_at`. `other_card_text` is unverified; material is applied only on an exact material-name match (`exactMaterialName`). |
| `opt_proposal.style_sample` | jsonb | Same match object as above if Prepare has already run. |
| `boot_references` | separate table, keyed by seller + maker + model | Seller-entered note: `maker`, `model`, `status` (`confirmed` / `candidate`), `provenance`, `notes`. A confirmed model may inform naming only when that model already appears in the listing text or verified `id_text`. |

### Photo-scan IDs

| Field | Type | Notes |
|---|---|---|
| `id_photos` | jsonb, nullable | Array of `{ photo, kind, text }` from `scanPhotos()` in `lib/idcheck.js` (`kind` is `insole stamp`, `tag`, `label`, `box`, or `other`; `photo` is 1-based). Use `text` as a model/style candidate only when it passes `acceptToken()` (not a size, width, or price). This path is optional and may be absent; ASMO must not call paid vision APIs itself. |
| `id_checked_at` | timestamptz, nullable | When the scan ran. |

### Existing photo-SEO and lens pass

When `opt_applied.media === "lens"` and `opt_applied.facts_fp === factsFingerprint(item)` and each `images[i].stored_url` still matches `photos[i]`, reuse `file`, `alt`, `seo_title`, and `seo_description` as the starting point, then add web-optimized derivatives and metadata. If the fingerprint no longer matches, recompute names from current facts.

### Seller settings (optional)

From `sellers` (`SELLER_FIELDS` on main): `display_name`, `location`, `website`, `fb_profile`, `brand_context`, `photo_ok`, `import_ok`, `shop_links`, `ship_price`, `handle_days`, `return_days`, `defaults`, `terms`, `notes`, `sync`, `contact`, `email`, `phone`.

Use public shop context only (`display_name`, `location`, `website`, `brand_context`) for IPTC credit, copyright-adjacent credit (`{seller} via westernbootworld.com`, already used by `withXmp`), and Open Graph site/attribution fields. Do not put email, phone, login material, or private seller notes into public image metadata.

Draft PRs #37/#38/#40 (not on main) add seller columns `shipping_policy`, `payment_methods`, `return_policy`, `extra_text`, `video_opt`, `primary_source`. If those columns exist at runtime, they may be read for context but are not required. `extra_text` and `video_opt` default off and do not change ASMO photo work.

### Photo bytes: EXIF, IPTC, dimensions

**Not stored in the database today.** When ASMO downloads a photo (Blob or allowed source URL), it should parse, when present:

- Pixel width and height
- Existing EXIF/IPTC/XMP title, description, keywords, copyright, credit
- Orientation

Then it writes new SEO metadata and **strips GPS and other location EXIF**. Existing descriptive tags may inform keywords only if they do not contradict listing facts. Image dimension data can choose a sensible max dimension and fill Open Graph width/height.

### WBW export / social fields (computed, not stored as columns)

`exportRecord()` in `lib/export.js` already derives: `alts`, `seo_title`, `seo_description`, `category` (`Boots` / `Belts` from `boot`), `brand_context`, `brand_link`, `seller_context`, `website_url`, `source_id`. ASMO may reuse these for captions and Open Graph (`og:title`, `og:description`, `og:image`, alt) on the optimized media. It must not add sell-a-pair CSV columns.

### Source platform IDs already covered above

- Facebook: `source_id` is the Marketplace item id (`^\d{5,20}$`), `source_url` is `https://www.facebook.com/marketplace/item/{id}/`.
- Depop: `source_id` is the product slug, `source_url` is `https://www.depop.com/products/{slug}/`.
- eBay (already imported only): `source_id` is `legacyItemId` or `itemId`. ASMO does not call eBay.
- Poshmark: `source_id` is the listing id.
- Shopify/generic: `source` is the shop host, `source_id` is the product slug.

---

## 3. Exact format ASMO reads

ASMO does not read a CSV directly in the button path. It reads **one normalized JSON object per listing**, built from the `items` row + joined `sellers` row + optional photo-byte sidecar. Import CSVs and extension payloads are mapped into `items` first by the existing importers; the mapping is below so a test or a future batch file can produce the same shape.

### Type definition

```ts
type AsmowbwListingInput = {
  // --- core (always present as keys; values may be null or empty) ---
  id: number;
  seller: string;                  // sellers.name
  source: string | null;           // listperfectly | facebook | depop | ebay | poshmark | shop-host
  source_id: string | null;
  source_url: string | null;
  status: string;                  // review | published | pending | sold | removed | archived
  boot: string;                    // boot | belt | unsure | ...
  boot_score: number | null;
  photos: string[];                // stored URLs, display order, max 30
  src_photos: string | null;       // newline-joined original URLs (LP)
  title: string | null;
  description: string | null;
  id_text: string | null;          // Model / date codes
  price: number | string | null;
  wbw_price: number | string | null;
  brand: string | null;
  sized_for: string | null;        // Men | Women | Kids
  size: string | null;
  size_estimated: string | null;
  width: string | null;            // exact stored width
  material_type: string | null;
  material: string | null;
  material_cut: string | null;
  made_in: string | null;
  condition: string | null;
  color: string | null;
  keywords: string | null;
  sole_length: string | null;
  sole_width: string | null;
  heel_height: string | null;
  shaft_circ: string | null;
  shaft_height: string | null;
  sole: string | null;
  heel: string | null;
  toe: string | null;
  guessed: string[];
  verified: string[];
  opt_error: string | null;
  opt_original: {
    title: string;
    description: string;
    price: number | string | null;
    brand: string | null;
    size: string | null;
    width: string | null;
    material: string | null;
    photos: string[];
    captured_at: string | null;
    src_hash?: string;
    first?: object;                // first-import snapshot, same keys
  } | null;
  opt_proposal: object | null;
  opt_applied: {
    media?: string;                // "lens" for the existing images-SEO pass
    scope?: string;                // "images-seo"
    facts_fp?: string;
    seo_title?: string;
    seo_description?: string;
    images?: Array<{
      n: number;
      file: string;
      alt: string;
      stored_url: string;
      source_renamed: boolean;
      pixels: string;
    }>;
    [k: string]: unknown;
  } | null;

  seller_profile: {
    name: string;
    display_name: string | null;
    location: string | null;
    website: string | null;
    brand_context: string | null;
  };

  // --- bonus (omit key or use null when not present) ---
  markets?: string | null;
  source_condition?: string | null;
  missing_group_price?: boolean;
  style_ref?: {
    maker_name: string;
    style_number: string | null;   // string, leading zeros preserved
    record_title?: string;
    record_url?: string;
    source_url?: string;
    other_card_text?: string | null;
    status?: string;
    accepted_at?: string | null;
  } | null;
  style_sample?: {
    status: "none" | "candidate" | "ambiguous";
    matches: Array<{
      maker_name: string;
      style_number: string;
      record_title?: string;
      record_url?: string;
      other_card_text?: string | null;
    }>;
    maker?: string | null;
    styles?: string[];
    note?: string;
  } | null;
  boot_references?: Array<{
    maker: string;
    model: string;
    status: string;                // confirmed | candidate
    provenance: string;
    notes?: string;
  }>;
  id_photos?: Array<{
    photo: number;                 // 1-based index into photos
    kind: string;                  // insole stamp | tag | label | box | other
    text: string;
  }> | null;
  id_checked_at?: string | null;
  seller_notes?: string | null;    // only if explicitly supplied; LP Notes are not stored today
  sku?: string | null;             // only if explicitly supplied or safely parsed from source_id
  maker_directory?: { name: string }[];  // exact maker names only; BootLister sends [{ name }] from the bundled snapshot

  // Photo bytes are attached at run time, not stored in Postgres.
  media?: Array<{
    n: number;                     // 1-based
    stored_url: string;
    bytes?: Uint8Array | null;     // present when the run could fetch the file
    content_type?: string | null;
    width?: number | null;
    height?: number | null;
    exif?: {
      title?: string | null;
      description?: string | null;
      keywords?: string[] | null;
      copyright?: string | null;
      credit?: string | null;
      orientation?: number | null;
      gps_present?: boolean;       // if true, strip GPS on output
    } | null;
  }>;
};
```

### Example (one listing, bonus fields present)

```json
{
  "id": 1842,
  "seller": "danhoffenberg",
  "source": "listperfectly",
  "source_id": "2024-11-02 13:04:00 0123 main-0123.jpg",
  "source_url": null,
  "status": "review",
  "boot": "boot",
  "boot_score": 0.99,
  "photos": [
    "https://abc.public.blob.vercel-storage.com/photos/aa11.jpg",
    "https://abc.public.blob.vercel-storage.com/photos/aa12.jpg"
  ],
  "src_photos": "https://listperfectly.example/main-0123.jpg\nhttps://listperfectly.example/side-0123.jpg",
  "title": "Lucchese 1883 boots, style 0123, size 10 D",
  "description": "Style #: 0123\nBlack cherry goat Lucchese cowboy boots, size 10 D.",
  "id_text": "0123",
  "price": "250",
  "wbw_price": "250",
  "brand": "Lucchese",
  "sized_for": "Men",
  "size": "10",
  "size_estimated": null,
  "width": "D",
  "material_type": "Leather",
  "material": "Goat",
  "material_cut": null,
  "made_in": "USA",
  "condition": "Broken In",
  "color": "Black Cherry",
  "keywords": "Lucchese, 1883, goat",
  "sole_length": "12",
  "sole_width": "4",
  "heel_height": "1.5",
  "shaft_circ": "15",
  "shaft_height": "12",
  "sole": "Leather",
  "heel": "Walking heel",
  "toe": "R toe",
  "guessed": ["material_type"],
  "verified": ["brand", "id_text", "size", "width", "color", "material"],
  "opt_error": null,
  "opt_original": {
    "title": "Lucchese 1883 boots, style 0123, size 10 D",
    "description": "Style #: 0123\nBlack cherry goat Lucchese cowboy boots, size 10 D.",
    "price": "250",
    "brand": "Lucchese",
    "size": "10",
    "width": "D",
    "material": "Goat",
    "photos": [
      "https://abc.public.blob.vercel-storage.com/photos/aa11.jpg",
      "https://abc.public.blob.vercel-storage.com/photos/aa12.jpg"
    ],
    "captured_at": "2026-11-16T15:00:00.000Z"
  },
  "opt_proposal": null,
  "opt_applied": {
    "media": "lens",
    "scope": "images-seo",
    "facts_fp": "a1b2c3d4",
    "seo_title": "Lucchese Men's 0123 Black Cherry Goat cowboy boots size 10 D width",
    "seo_description": "Lucchese 0123 size 10D Black Cherry. Style #: 0123 Black cherry goat Lucchese cowboy boots, size 10 D.",
    "images": [
      {
        "n": 1,
        "file": "lucchese-mens-0123-black-cherry-goat-cowboy-boots-10d-1.jpg",
        "alt": "Lucchese Men's 0123 Black Cherry Goat cowboy boots size 10 D width - photo 1 of 2",
        "stored_url": "https://abc.public.blob.vercel-storage.com/photos/aa11.jpg",
        "source_renamed": false,
        "pixels": "unchanged"
      },
      {
        "n": 2,
        "file": "lucchese-mens-0123-black-cherry-goat-cowboy-boots-10d-2.jpg",
        "alt": "Lucchese Men's 0123 Black Cherry Goat cowboy boots size 10 D width - photo 2 of 2",
        "stored_url": "https://abc.public.blob.vercel-storage.com/photos/aa12.jpg",
        "source_renamed": false,
        "pixels": "unchanged"
      }
    ]
  },
  "seller_profile": {
    "name": "danhoffenberg",
    "display_name": "Dan Hoffenberg",
    "location": "Texas",
    "website": null,
    "brand_context": null
  },
  "markets": "eBay, Poshmark",
  "sku": "0123",
  "style_ref": {
    "maker_name": "Lucchese",
    "style_number": "0123",
    "record_title": "1883 Goat Boot 0123",
    "record_url": "https://catalog.example/record/0123",
    "other_card_text": "Goat",
    "status": "candidate",
    "accepted_at": "2026-11-16T15:05:00.000Z"
  },
  "id_photos": [
    { "photo": 2, "kind": "insole stamp", "text": "0123" }
  ],
  "id_checked_at": "2026-11-16T14:50:00.000Z",
  "media": [
    {
      "n": 1,
      "stored_url": "https://abc.public.blob.vercel-storage.com/photos/aa11.jpg",
      "content_type": "image/jpeg",
      "width": 2400,
      "height": 3200,
      "exif": { "gps_present": false, "orientation": 1 }
    },
    {
      "n": 2,
      "stored_url": "https://abc.public.blob.vercel-storage.com/photos/aa12.jpg",
      "content_type": "image/jpeg",
      "width": 2400,
      "height": 3200,
      "exif": { "gps_present": true, "orientation": 1 }
    }
  ]
}
```

In this example, naming must keep style `0123` (leading zero preserved), use exact brand `Lucchese`, and describe photo 2 with slightly different alt/caption wording so the two files do not read identically. GPS on photo 2 is stripped on output. `material_type` is in `guessed` and not verified, so it is not used as a naming fact unless the listing text already says it.

### How import sources map into this shape

All importers funnel into `createItem` / LP merge, then `enrich()` fills structured fields and `guessed`. `importOriginal()` snapshots source title, description, price, brand, size, width, material, and stored photo URLs into `opt_original`. Photo URLs are copied to Vercel Blob when possible; otherwise the source URL stays in `photos`.

#### List Perfectly CSV (`lib/lp.js`)

Required headers: `Title`, `SKU`, `Price`. Mapped:

| LP column | BootLister field |
|---|---|
| `Title` | `title` |
| `Description` | `description` |
| `Price` (or museum group price parsed from Seller Notes) | `price` / `wbw_price` |
| `Brand` | `brand` |
| `Color` | `color` |
| `Size` | `size` |
| `Material` | `material` |
| `Main Image` + `Image Gallery` (newline-separated https URLs) | `photos` (max 30), also `src_photos` |
| `Date` (+ `SKU` + main-image filename when Date is shared or missing) | `source_id` |
| `SKU` | **not stored**; may be embedded in `source_id` |
| `SOLD` / `Quantity` | status (`sold` when `SOLD=sold` or quantity `0`) |
| Marketplace flag columns (`eBay`, `Etsy`, …) | `markets` |
| `Seller Notes` / `Notes` / `Comments` / `Comment` | museum group price only; **text not stored** |
| `Notes`, `Cost of Goods`, `Sold Price`, `Shipping Cost`, `Other Costs`, `Sold Date`, `Profit` | **never read into an item** |

`source` is always `listperfectly`. `source_url` is typically null.

#### Facebook Marketplace (Chrome extension, `extension/import-page.mjs`)

Payload keys already match the item: `source: "facebook"`, `source_id` (numeric Marketplace id), `source_url`, `title`, `description`, `photos[]`, and optional `condition`, `brand`, `size`, `color`, `material`, `sized_for`, `price`.

#### Depop (Chrome extension)

`source: "depop"`, `source_id` = product slug, `source_url` = `https://www.depop.com/products/{slug}/`, `title` (first line of the description, not Depop's generated heading), `description`, `price`, `brand`, `size`, `sized_for`, `condition`, `photos`. `color` and `material` are sent as null and may later be filled by `enrich()`.

#### eBay (already stored items only)

`lib/ebay.js` maps Browse API fields into `source: "ebay"`, `source_id` (`legacyItemId` ?? `itemId`), `source_url`, `title`, `price`, `description`, `brand`, `size`, `width`, `sized_for`, `condition`, `color`, `material`, `toe`, `heel`, `sole`, `material_cut`, `keywords`, measurements, `made_in`, `photos`. Item specifics count as given (not guessed). ASMO never calls the eBay API.

#### Poshmark (`lib/sites.js`)

`source: "poshmark"`, `source_id` = listing id, `source_url`, `title`, `price`, `description`, `brand`, `size`, `color`, `sized_for`, `condition`, `photos`. A source `category` string is used during enrich/classify and is not a core naming column (`items` has no `category` column; export `category` is derived from `boot`).

#### Shopify / generic product pages (`lib/sites.js`)

`source` = shop hostname, `source_id` = product slug, `source_url`, `title`, `price`, `description`, `brand` (Shopify vendor, omitted when it is just the store name), `photos`.

### Builder

The runtime helper (to be implemented as `listingInput(item, seller, media?)`) copies these keys off a `select * from items` row, joins `seller_profile`, and optionally attaches `media[]`. Tests can pass the JSON example above directly. CSV files are not a second input format for the button; they must go through the existing import mapping first.

---

## Out of scope for this contract

- Output filenames, alt text, XMP/IPTC, WebP/JPEG derivatives, Open Graph fields, progress UI, undo, and storage of optimized files (those are the ASMO output contract, implemented in code).
- Changing live `title`, `description`, `price`, or `size`.
- Automatic or scheduled runs.
- Western Boot World writes, and live eBay calls.

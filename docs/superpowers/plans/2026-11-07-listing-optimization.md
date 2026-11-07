# Listing optimization implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a seller preview, edit, and apply a factual listing rewrite, then export only that approved copy through the existing Western Boot World sell-a-pair columns.

**Architecture:** Pure functions in `lib/optimize.js`, `lib/references.js`, and `lib/export.js` decide wording, reference matches, and CSV cells. Postgres stores an original snapshot, a draft proposal, and an applied copy on the item. The inventory screen shows original against proposed and never publishes by itself. BootLister stays `noindex`. Public product schema, canonical URLs, breadcrumbs, and sitemaps stay on the destination site.

**Tech Stack:** Next.js 16, existing Neon items table, existing `/img/{id}/{n}/{file}` photo route, node:test.

## Global Constraints

- No merge, deploy, publish, spend, paid inference, new hosted services, API keys, or eBay calls.
- Do not request westernbootworld.com, including public reads of `/library/makers` and `/lookup`.
- Do not invent maker, model, material, measurements, ratings, or provenance.
- Preserve imported title, description, price, and photo URLs. Optimization must not overwrite them until Apply.
- Exact widths stay in titles, descriptions, alt text, and filenames. `AA` / `AAA` / `AAAA` display and export as `A` only in the site width control and the CSV Width column. `N` stays `N`.
- No synonym spinning. Structure varies by a stable hash, not by a random or thesaurus pass.
- Do not change pixels or image quality. Do not rename source or Blob objects.
- Do not add CSV columns. The sell-a-pair file has no meta-description column.
- Root layout keeps `BugReporter` and `robots: { index: false, follow: false }`. `X-Robots-Tag: noindex, nofollow` and `public/robots.txt` stay as they are.
- Seller sessions can optimize only their own items. No new admin-only gate.

## Approved workflow

1. A listing is already imported. Its photos are existing URLs (Blob or source). Its fields are whatever `enrich` stored, with guesses flagged.
2. **Prepare** builds a draft from reliable fields and any seller-entered reference notes. The live row is not changed.
3. The draft has a cleaned title and description, descriptive BootLister copy filenames and alt text, and a short SEO description kept beside the listing.
4. If a confirmed note names a maker and model, and the imported title or description already contains that model, the draft may say so and cite the note’s provenance. Anything else is a candidate and stays out of the wording.
5. The seller compares original and proposed, may edit the proposed title and description, and saves a draft or applies it.
6. **Apply** copies the draft title and description onto the item, keeps the original snapshot, and records the applied image names. A seller apply clears approval, same as any other seller edit. Export still requires that approval.
7. **Export** writes the live title and description. It never writes an unapplied proposal. Width uses `displayWidth`. Photo links use the existing `/img` route.

## What this repo can and cannot know

Maker names and hide names already live in `lib/vocab.js`. There is no maker-library table and no model catalog. `lib/brandinfo.js` would fetch a brand page only when `WBW_BRAND_URL` is set. Optimization must not call it.

Dan’s reference intent is the destination maker library (`/library/makers`) and boot lookup (`/lookup`). Those pages are not connected. The product tells the seller that, and offers a notes form instead. A note stores maker, model, `confirmed` or `candidate`, provenance, and optional notes. It is not a lookup result.

## Reliable facts

A filled field is used in new sentences only when it is not in `guessed`, or it is in `verified`.

Extra limits, because some defaults are stored without a guess flag:

- `sized_for` is used when it is verified, or the preserved title/description says men, women, or kids.
- `condition` is used when it is verified, or the preserved text states the same condition (new / custom made / worn, broken in, used, pre-owned).
- Product noun is `cowboy boots` only when `boot === 'boot'`, and `belt` only when `boot === 'belt'`.
- Model text is used only from a confirmed reference whose model already appears in the preserved title or description, or in `id_text` when `id_text` is verified. Width letters are not models.

Missing facts are omitted. The omitted list is shown in the preview. Seller notes are the preserved description, with tags and control characters removed, not a paraphrase.

## Variation

`structureVariant(source_id or id)` is FNV-1a mod 3. The same listing always gets the same order of fact sentences and the same title shape. Different ids can place the seller notes before or after the facts, and can order the fact groups differently. Words are not swapped for synonyms.

## Photos

`copyNames` builds a slug from reliable fields, then appends the photo number and the item id after truncation so two photos and two items cannot share a filename. Alt text uses the same reliable fields and the exact width. The CSV Photos cell is still `{origin}/img/{id}/{n}/{file}`, served by the current route. `stored_url` is unchanged. `source_renamed` is false. No Blob `put` is added on this path.

## Export contract

Columns stay exactly:

`Photos`, `Listing title`, `Asking price`, `Brand`, `Sized for`, `Size`, `Size estimated`, `Condition`, `Width`, `Material type`, `Material / hide`, `Material specifics (cut)`, `Where made`, `Color`, `Keywords`, `Sole length`, `Sole width`, `Heel height`, `Shaft circumference`, `Shaft height`, `Sole`, `Heel`, `Toe`, `Description`, `WBW Seller Name`, `Source price`, `Model / date codes`, `Category`, `Seller Website Link`, `Image Alt Text`, `Brand Context`, `Brand Page Link`, `Seller Context`, `Source ID`.

Supported optimized output: Listing title, Description, Photos (descriptive copy URL), Image Alt Text.

Prepared but not exported: short SEO description. Destination-only and not generated here: Product schema, canonical URL, breadcrumbs, sitemap.

When `opt_applied` matches the live title and description, Photos and Image Alt Text use the applied names. Otherwise they use today’s `photoUrl` / `altText` on the live item. `opt_proposal` is never exported.

## Storage

`items.opt_original` is written when the listing is imported (`importOriginal` of the source payload and stored photo URLs). A later import does not replace it. Prepare uses that snapshot for seller notes. If an older row has none, Prepare saves the text it sees and does not invent an earlier copy.

`items.opt_proposal` and `items.opt_applied` are jsonb. Photo URL arrays are not rewritten. `boot_references` is one note per seller + maker + model (`boot_references_seller_idx`, unique `boot_references_maker_model`). A duplicate note is rejected. Posts are capped at 100000 bytes and 50 rows. Maker, model, provenance, and notes have length caps.

Schema changes run inside `init()` on the first request (`create table if not exists` / `add column if not exists`). There is no separate migration runner. A failed boot clears the cached promise and the next request tries again.

## Review rules

- Approved photo names are used only when `opt_applied.facts_fp` still matches the current facts (brand, size, width, and the other naming inputs) and every photo URL is still in the same position. Otherwise export builds names from the current item. Listing title and description in the CSV are always the live fields.
- A draft stores `facts_fp`. Apply and edit refuse the draft when those facts no longer match.
- A real reimport (`src_hash` change), including a description-only change, refreshes the current source snapshot, keeps the first import on `opt_original.first`, and clears the proposal and applied copy. The same hash does not write. `updateItems` does not rewrite the source snapshot. List Perfectly updates use the same plan.
- Apply clears approval for every role and moves a published row back to review. It does not change `changed_at`. `approveItems` is what publishes. `getFeedItems` reads `status = 'published'` only.
- Alt text, filenames, and XMP use the same factual fields. The photo route finds the file by id and index, so an older filename still resolves.
- A confirmed model note may add `Model <id>.` when that id is already in the import. The note's provenance stays on the screen and out of the public wording.

## Maker directory snapshot

`data/wbw-reference/` is an untrusted read-only pull from 2026-11-07: 258 directory rows and 8 excerpts. `search_blurb` and sample text are not listing facts. A name match can only supply the directory's spelling. Location and history are not applied to a pair. Model lookup is unavailable. The screen says so.

## Tasks

### Task 1: Failing tests

**Files:** `test/optimize.test.mjs`

Cover factual preservation, missing and guessed values, HTML stripping, CSV formula escaping, stable variation, filename collisions, original snapshot, unapplied proposal left out of CSV, Width `A` versus listing `AAA`, `N` left as `N`, confirmed versus candidate references, and the noindex / bug-button source guards.

- [x] **Step 1:** Add `test/optimize.test.mjs`.
- [x] **Step 2:** Run `node --import ./test/register.mjs --test test/optimize.test.mjs` and confirm it fails because the modules are missing.

### Task 2: Pure optimization, references, and export

**Files:** `lib/references.js`, `lib/optimize.js`, `lib/export.js`

- [x] **Step 1:** Implement the exports the tests import. No `fetch`, no `@google/genai`, no `brandinfo`.
- [x] **Step 2:** Re-run the optimize tests and expect pass.

### Task 3: Persist and review

**Files:** `lib/wbw.js`, `lib/items-api.js`, `app/api/items/route.js`, `app/api/references/route.js`, `components/optimize-panel.js`, `app/screen.js`, `test/fields.test.mjs`

- [x] **Step 1:** Add columns, reference rows, and propose / edit / apply functions that do not change `photos`.
- [x] **Step 2:** Sellers call those actions on their own ids. Apply for a seller clears approval.
- [x] **Step 3:** Inventory screen shows the panel and downloads CSV via `toCsv`.
- [x] **Step 4:** `npm test` and `npm run build`.

### Task 4: Browser check

- [x] Open the seller inventory with API responses stubbed. Prepare a draft, see original versus proposed, apply, and confirm the bug button is still on the page. Do not approve a real publish or write production data.

## Self-review

- Spec coverage: import path is unchanged; wording, names, references, review, and export each have a task. Destination SEO is explicitly out of the file.
- Placeholders: none left for the implementer of this session.
- Names: `optimize`, `editProposal`, `applyOptimization`, `exportRecord`, `toCsv`, `matchReferences`, `referenceFromFields` are the names tests and callers share.

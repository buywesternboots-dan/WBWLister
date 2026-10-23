# WBWlister — seller interface for westernbootworld.com (WBW)

## Working rules
- Minimize lines of code; simple, clean, accurate, fully functional.
- Don't report changes — only problems or questions.
- Outline before building when asked; don't build until told.
- Fix problems and make judgment calls without asking; ask only when truly necessary.
- Tell me when a session is getting too long and give a copy-ready summary.

## Context
- This repo is an MVP for testing; production will run on another machine, GitHub and Vercel (not the user's). Keep it portable: config via env vars, nothing tied to these accounts.
- WBW: custom marketplace for cowboy/western boots, built by another developer. I have full backend access, but we're building against a mock WBW for now.
- Stack: Next.js on Vercel. No marketplace APIs; data comes from customer-facing pages.
- Goal: sellers import listings (Facebook Marketplace first; eBay, Poshmark, Depop later), review, edit, manage inventory, publish on WBW.
- Facebook blocks server access, so collection runs in my browser via a Chrome extension. I import sellers' Marketplace profiles while logged into my own FB (with seller permission). FB photo links expire, so photos are copied at import. Bulk import is human-paced (3–6 s per listing).

## Folders
- Repo root: Next.js app (no web/ subfolder).
  - lib/wbw.js: mock WBW layer (Neon Postgres). Photos: lib/storage.js (Cloudflare R2). Replace lib/wbw.js only to connect to real WBW. Table auto-creates.
  - app/api/items/route.js: GET list by status, POST create, PATCH bulk actions. Bearer = selected seller name (required; no demo default). Logins (proxy.js + lib/session.js, signed cookie; env APP_PASSWORD): team = team password (full tool; extension sends x-app-password); seller = seller name + password set in Seller settings (hashed in sellers.login_hash) → locked to their own items (x-session-seller), no seller admin/move/delete. GET /api/me says which. Sellers: sellers table via app/api/sellers — "+ Add seller" / Seller settings form: details, import & sync (website, FB profile, sync preference — auto-sync not built yet), listing style (notes; terms "shorthand = meaning" used only to read listings; defaults "field = value" when listing is silent) — applied by enrichFor(); setup required before Import/Sync; page header dropdown, one seller at a time.
  - lib/wbw.js FIELDS = WBW listing fields; enrich() fills them from listing text; values inferred from free text are listed in items.guessed and shown yellow until the seller saves (= verified). CSV columns in app/page.js LABELS/CSV (WBW Seller Name first).
  - app/page.js: inventory page (tabs Newly imported / Exported / Pending sold / Sold / Removed / Archived — Sync: listings gone from the source → Pending sold (seller "Mark sold"/"Still for sale"; auto Sold after 30 days); source-changed listings → back to Newly imported with "Changed at source" (items.changed_at, cleared on save); Removed → Archived after 30 days; groups Boots / Belts / Not sure / Other (items.boot + items.boot_score from classify() in lib/wbw.js; Boots/Belts only when ≥97% sure); group header quick filters Ready / To verify / Missing <field>; search with brand-family & material synonyms; sort most-likely-boot or newest; bulk lower price, Export CSV for WBW import (columns in CSV const; production will connect directly to WBW instead), remove, restore, Move to seller, Delete (item leaves the tool; photos stay in R2 or on existing Blob URLs); tap to edit). Each item keeps source_url (seller-website product page → 'Seller Website Link' for WBW to link back; FB listing link for reference).
  - Env: DATABASE_URL, APP_PASSWORD, EBAY_CLIENT_ID, EBAY_CLIENT_SECRET. Photos, in order: R2 (all five required) R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_PUBLIC_BASE_URL (public r2.dev or custom-domain origin, no trailing slash); else Vercel Blob when BLOB_READ_WRITE_TOKEN is set; else the source photo URL is kept. Optional R2_ENDPOINT (S3 API host; default `https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com`; EU/US/FedRAMP buckets need the jurisdiction host). Existing public Blob URLs still load. Team POST /api/migrate-photos (admin session or x-app-password; rejected when APP_PASSWORD is unset) copies those Blob URLs onto R2. Do not run it until the bucket is ready.
- lib/vocab.js: shared brands (with families, e.g. Rios), materials (aliases, longest wins: HBL = Caiman Lizard), edit-form suggestions (CHOICES; free text always allowed), search.
- Import rules: each failed item is retried twice before counting as failed; every photo is copied (max 30) to R2, or to Vercel Blob when R2 is unset and BLOB_READ_WRITE_TOKEN is set, or that item fails; if neither store is configured, the source photo URL is kept and the import still succeeds; a URL already on Vercel Blob (`*.public.blob.vercel-storage.com`) or the R2 public origin is not uploaded again; identical bytes share one object (`photos/<sha256>.<ext>`); downloads are http(s) only, skip private/loopback/link-local addresses, cap at 15 MB and 4 at a time; gender defaults Men; width not required and never defaulted: blank when not in the listing, shown red as a heads-up (ALERT in app/page.js); condition New only if explicit, else Broken In.
- lib/ebay.js: eBay via the official Browse API (client-credentials token; seller search in category 11450, details 20 at a time; item specifics → fields). Seller link must be the username (ebay.com/usr/<name>). Untested until API keys are added.
- lib/sites.js + app/api/import: Poshmark closets (server-side; the closet feed carries full listing details, 48 per request, so a closet is a handful of requests — keep it that way for daily syncs; link poshmark.com/closet/<user> goes in the seller's Website field) and website stores (Wix/Shopify…) imported server-side from sitemap + schema.org Product data; "Import from website" box on the inventory page (uses the selected seller's website; Shopify collection links import just that collection). Import = new only; Sync = re-read all, refresh source-changed items (items.src_hash fingerprint of source data, so seller edits are not seen as changes), gone/sold → Pending sold.
- Depop (Cloudflare blocks servers): extension opens the shop once and reads Depop's own listing feed (webapi.depop.com shops/{id}/products, page context) — readDepopShop()/importDepop() in extension/background.js; photos linked (permanent). Seller's Depop link goes in the fb_profile field.
- Inventory page Import/Sync works for every seller: website links run server-side; Facebook/Depop links are handed to the extension via extension/bridge.js (content script on the app's pages; progress posted back to the page).
- lib/http.js: shared route helpers (handle, sellerOf).
- Extension download: scripts/zip-extension.mjs packs extension/ into public/wbw-importer.zip at build; "Chrome extension" link in the page header (with install steps when needed). bridge.js sets the popup's server address on first visit.
- extension/: Chrome extension (MV3). background.js: page readers (readListing, collectIds, readDepopShop) + one shared importAll loop; one import at a time; messages { type: 'link', link, sync } or { type: 'listing', tabId }. Popup (server URL, password, seller dropdown [fills their saved FB/Depop link], profile link, "Import all from this profile", "Sync with this profile" [re-reads all; source-changed items refreshed; unlisted → Removed], "Add this listing"), right-click "Add to WBW". FB reader uses og meta tags + text labels; untested against real pages.

## Status
- Live on Vercel with Neon. New photos go to Cloudflare R2 once the R2 env vars are set; until then, BLOB_READ_WRITE_TOKEN still copies them to Vercel Blob. Listings already on Blob keep those URLs until an admin POSTs /api/migrate-photos (repeat until left is 0). Build in the cloud: push and let Vercel build (don't build locally).
- Extension untested; FB reader will need tuning from a real listing.

## Not built yet
- AI photo check for unsure items (pending my approval).
- Photo-first "Add listing" form.
- Real WBW auth and backend connection.

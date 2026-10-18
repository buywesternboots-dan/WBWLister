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
  - lib/wbw.js: mock WBW layer (Neon Postgres + Vercel Blob). Replace only this file to connect to real WBW. Table auto-creates.
  - app/api/items/route.js: GET list by status, POST create, PATCH bulk actions. Bearer = selected seller name (required; no demo default). Internal tool: proxy.js password-protects everything (env APP_PASSWORD; /login page sets cookie; extension sends x-app-password). Sellers: sellers table via app/api/sellers — "+ Add seller" / Seller settings form: details, import & sync (website, FB profile, sync preference — auto-sync not built yet), listing style (notes; terms "shorthand = meaning" used only to read listings; defaults "field = value" when listing is silent) — applied by enrichFor(); setup required before Import/Sync; page header dropdown, one seller at a time.
  - lib/wbw.js FIELDS = WBW listing fields; enrich() fills them from listing text; values inferred from free text are listed in items.guessed and shown yellow until the seller saves (= verified). CSV columns in app/page.js LABELS/CSV (WBW Seller Name first).
  - app/page.js: inventory page (tabs Newly imported / Exported / Removed / Archived [auto after 30 days in Removed]; groups Boots / Belts / Not sure / Other (items.boot + items.boot_score from classify() in lib/wbw.js; Boots/Belts only when ≥97% sure); group header quick filters Ready / To verify / Missing <field>; search with brand-family & material synonyms; sort most-likely-boot or newest; bulk lower price, Export CSV for WBW import (columns in CSV const; production will connect directly to WBW instead), remove, restore, Move to seller, Delete (permanent, incl. Blob photos); tap to edit). Each item keeps source_url (seller-website product page → 'Seller Website Link' for WBW to link back; FB listing link for reference).
  - Env: DATABASE_URL, BLOB_READ_WRITE_TOKEN, APP_PASSWORD.
- lib/vocab.js: shared brands (with families, e.g. Rios), materials (aliases, longest wins: HBL = Caiman Lizard), edit-form suggestions (CHOICES; free text always allowed), search.
- Import rules: each failed item is retried twice before counting as failed; every photo must import (max 30) or it fails; gender defaults Men; width not required and never defaulted: blank when not in the listing, shown red as a heads-up (ALERT in app/page.js); condition New only if explicit, else Broken In.
- lib/sites.js + app/api/import: website stores (Wix/Shopify…) imported server-side from sitemap + schema.org Product data; "Import from website" box on the inventory page (uses the selected seller's website; Shopify collection links import just that collection). Import = new only; Sync = re-read all, refresh source-changed items (items.src_hash fingerprint of source data, so seller edits are not seen as changes), remove gone/sold.
- Depop (Cloudflare blocks servers): extension opens the shop once and reads Depop's own listing feed (webapi.depop.com shops/{id}/products, page context) — readDepopShop()/importDepop() in extension/background.js; photos linked (permanent). Seller's Depop link goes in the fb_profile field.
- Inventory page Import/Sync works for every seller: website links run server-side; Facebook/Depop links are handed to the extension via extension/bridge.js (content script on the app's pages; progress posted back to the page).
- extension/: Chrome extension (MV3). Popup (server URL, password, seller dropdown [fills their saved FB/Depop link], profile link, "Import all from this profile", "Sync with this profile" [re-reads all; source-changed items refreshed; unlisted → Removed], "Add this listing"), right-click "Add to WBW". FB reader uses og meta tags + text labels; untested against real pages.

## Status
- Web app builds (next build passes); not yet run against a real database.
- Extension untested; FB reader will need tuning from a real listing.

## Not built yet
- AI photo check for unsure items (pending my approval).
- Photo-first "Add listing" form.
- Real WBW auth and backend connection.

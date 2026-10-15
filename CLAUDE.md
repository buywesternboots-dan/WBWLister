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
  - app/api/items/route.js: GET list by status, POST create, PATCH bulk actions. Mock auth: Bearer seller name, default "demo".
  - lib/wbw.js FIELDS = WBW listing fields; enrich() fills them from listing text; values inferred from free text are listed in items.guessed and shown yellow until the seller saves (= verified). CSV columns in app/page.js LABELS/CSV (WBW Seller Name first).
  - app/page.js: inventory page (tabs Newly imported / Exported / Removed / Archived [auto after 30 days in Removed]; groups Boots / Belts / Not sure / Other (items.boot + items.boot_score from classify() in lib/wbw.js; Boots/Belts only when ≥97% sure); group header quick filters Ready / To verify / Missing <field>; search with brand-family & material synonyms; sort most-likely-boot or newest; bulk lower price, Export CSV for WBW import (columns in CSV const; production will connect directly to WBW instead), remove, restore; tap to edit).
  - Env: DATABASE_URL, BLOB_READ_WRITE_TOKEN.
- lib/vocab.js: shared brands (with families, e.g. Rios), materials (aliases, longest wins: HBL = Caiman Lizard), edit-form suggestions (CHOICES; free text always allowed), search.
- Import rules: every photo must import (max 30) or it fails; gender defaults Men; missing width defaults to M and counts as missing; condition New only if explicit, else Broken In.
- lib/sites.js + app/api/import: website stores (Wix/Shopify…) imported server-side from sitemap + schema.org Product data; "Import from website" box on the inventory page (saved stores in SITES dropdown in app/page.js, or type any; Shopify collection links import just that collection). Import = new only; Sync = re-read all, refresh source-changed items (items.src_hash fingerprint of source data, so seller edits are not seen as changes), remove gone/sold.
- extension/: Chrome extension (MV3). Popup (server URL, seller, profile link, "Import all from this profile", "Sync with this profile" [re-reads all; source-changed items refreshed; unlisted → Removed], "Add this listing"), right-click "Add to WBW". FB reader uses og meta tags + text labels; untested against real pages.

## Status
- Web app builds (next build passes); not yet run against a real database.
- Extension untested; FB reader will need tuning from a real listing.

## Not built yet
- AI photo check for unsure items (pending my approval).
- Photo-first "Add listing" form.
- Real WBW auth and backend connection.

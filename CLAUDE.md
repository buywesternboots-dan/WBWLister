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
  - app/api/items/route.js: GET list by status, POST create, PATCH bulk actions. Bearer = selected seller name (required; no demo default). Logins (proxy.js + lib/session.js + lib/auth.js): the sign-in page asks for an email (always the username) and a PIN or password. No 2FA and no complexity rules; the PIN is stored as a salted SHA-256 (team_logins for the admin, sellers.login_hash for a seller) and is never the thing in the cookie. APP_PASSWORD only signs the session. The admin login is created at startup when both TEAM_EMAIL and TEAM_PIN are set (hashed into team_logins; leave them unset and no admin exists; changing TEAM_PIN rewrites that hash). Seller login is the Email on the seller plus the PIN typed in Seller settings. Same sign-in form, then two screens (lib/home.js): an admin goes to / with every tool (sellers, import, review, export, sync, settings); a seller goes to /seller with only their own items (import, review, export, sync — no seller admin, move, or delete). proxy.js sends a session that opens the other screen back to its own. Sellers stay locked to their own items (x-session-seller). Admin-only API actions (delete, move, seller settings, id check, photo backfill) are rejected for a seller session. The extension POSTs /api/login and sends that session token as x-auth. GET /api/me says which (admin or seller). Sellers: sellers table via app/api/sellers — "+ Add seller" / Seller settings form: details, import & sync (website, FB profile, sync preference — auto-sync not built yet), listing style (notes; terms "shorthand = meaning" used only to read listings; defaults "field = value" when listing is silent) — applied by enrichFor(); setup required before Import/Sync; page header dropdown, one seller at a time.
  - lib/wbw.js FIELDS = WBW listing fields; enrich() fills them from listing text; values inferred from free text are listed in items.guessed and shown yellow until the seller saves (= verified). CSV columns in app/page.js LABELS/CSV (WBW Seller Name first).
  - app/page.js: inventory page (tabs Newly imported / Exported / Pending sold / Sold / Removed / Archived — Sync: listings gone from the source → Pending sold (seller "Mark sold"/"Still for sale"; auto Sold after 30 days); source-changed listings → back to Newly imported with "Changed at source" (items.changed_at, cleared on save); Removed → Archived after 30 days; groups Boots / Belts / Not sure / Other (items.boot + items.boot_score from classify() in lib/wbw.js; Boots/Belts only when ≥97% sure); group header quick filters Ready / To verify / Missing <field>; search with brand-family & material synonyms; sort most-likely-boot or newest; bulk lower price, Export CSV for WBW import (columns in CSV const; production will connect directly to WBW instead), remove, restore, Move to seller, Delete (permanent, incl. Blob photos); tap to edit). Each item keeps source_url (seller-website product page → 'Seller Website Link' for WBW to link back; FB listing link for reference).
  - Env: DATABASE_URL, BLOB_READ_WRITE_TOKEN, APP_PASSWORD (session signing secret, not the typed PIN), TEAM_EMAIL, TEAM_PIN (optional; both required to create the shared team login, stored hashed), EBAY_CLIENT_ID, EBAY_CLIENT_SECRET.
- lib/vocab.js: shared brands (with families, e.g. Rios), materials (aliases, longest wins: HBL = Caiman Lizard), edit-form suggestions (CHOICES; free text always allowed), search.
- Import rules: each failed item is retried twice before counting as failed; every photo must import (max 30) or it fails; gender defaults Men; width not required and never defaulted: blank when not in the listing, shown red as a heads-up (ALERT in app/page.js); condition New only if explicit, else Broken In.
- lib/ebay.js: eBay via the official Browse API (client-credentials token; seller search in category 11450, details 20 at a time; item specifics → fields). Seller link must be the username (ebay.com/usr/<name>). Untested until API keys are added.
- lib/sites.js + app/api/import: Poshmark closets (server-side; the closet feed carries full listing details, 48 per request, so a closet is a handful of requests — keep it that way for daily syncs; link poshmark.com/closet/<user> goes in the seller's Website field) and website stores (Wix/Shopify…) imported server-side from sitemap + schema.org Product data; "Import from website" box on the inventory page (uses the selected seller's website; Shopify collection links import just that collection). Import = new only; Sync = re-read all, refresh source-changed items (items.src_hash fingerprint of source data, so seller edits are not seen as changes), gone/sold → Pending sold.
- Depop (Cloudflare blocks servers): extension opens the shop once and reads Depop's own listing feed (webapi.depop.com shops/{id}/products, page context) — readDepopShop()/importDepop() in extension/background.js; photos linked (permanent). Seller's Depop link goes in the fb_profile field.
- Inventory page Import/Sync works for every seller: website links run server-side; Facebook/Depop links are handed to the extension via extension/bridge.js (content script on the app's pages; progress posted back to the page).
- lib/http.js: shared route helpers (handle, sellerOf).
- Extension download: scripts/zip-extension.mjs packs extension/ into public/wbw-importer.zip at build; "Chrome extension" link in the page header (with install steps when needed). bridge.js sets the popup's server address on first visit.
- extension/: Chrome extension (MV3). background.js: page readers (readListing, collectIds, readDepopShop) + one shared importAll loop; one import at a time; messages { type: 'link', link, sync } or { type: 'listing', tabId }. Popup (server URL, email, PIN or password, seller dropdown [fills their saved FB/Depop link], profile link, "Import all from this profile", "Sync with this profile" [re-reads all; source-changed items refreshed; unlisted → Removed], "Add this listing"), right-click "Add to WBW". An old saved app password is ignored; sign in once with the email and PIN. FB reader uses og meta tags + text labels; untested against real pages.

## Status
- Live on Vercel with Neon + Blob. Build in the cloud: push and let Vercel build (don't build locally).
- Extension untested; FB reader will need tuning from a real listing.

## Not built yet
- AI photo check for unsure items (pending my approval).
- Photo-first "Add listing" form.
- Real WBW auth and backend connection.

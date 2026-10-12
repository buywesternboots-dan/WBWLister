# WBWlister — seller interface for westernbootworld.com (WBW)

## Working rules
- Minimize lines of code; simple, clean, accurate, fully functional.
- Don't report changes — only problems or questions.
- Outline before building when asked; don't build until told.
- Fix problems and make judgment calls without asking; ask only when truly necessary.
- Tell me when a session is getting too long and give a copy-ready summary.

## Context
- WBW: custom marketplace for cowboy/western boots, built by another developer. I have full backend access, but we're building against a mock WBW for now.
- Stack: Next.js on Vercel. No marketplace APIs; data comes from customer-facing pages.
- Goal: sellers import listings (Facebook Marketplace first; eBay, Poshmark, Depop later), review, edit, manage inventory, publish on WBW.
- Facebook blocks server access, so collection runs in my browser via a Chrome extension. I import sellers' Marketplace profiles while logged into my own FB (with seller permission). FB photo links expire, so photos are copied at import. Bulk import is human-paced (3–6 s per listing).

## Folders
- Repo root: Next.js app (no web/ subfolder).
  - lib/wbw.js: mock WBW layer (Neon Postgres + Vercel Blob). Replace only this file to connect to real WBW. Table auto-creates.
  - app/api/items/route.js: GET list by status, POST create, PATCH bulk actions. Mock auth: Bearer seller name, default "demo".
  - app/page.js: inventory page (tabs Newly imported / Exported / Removed; groups Boots / Unsure / Not boots; bulk lower price, Export CSV for WBW import (columns in CSV const), remove, restore; tap to edit).
  - Env: DATABASE_URL, BLOB_READ_WRITE_TOKEN.
- extension/: Chrome extension (MV3). Popup (server URL, seller, "Import all from this profile", "Add this listing"), right-click "Add to WBW". FB reader uses og meta tags + text labels; untested against real pages.

## Status
- Web app builds (next build passes); not yet run against a real database.
- Extension untested; FB reader will need tuning from a real listing.

## Not built yet
- AI photo check for unsure items (pending my approval).
- Photo-first "Add listing" form.
- Real WBW auth and backend connection.

# WBW reference pull (read-only) — 2026-11-07 15:35 ET
Sources: https://www.westernbootworld.com/library/makers, /lookup, 8 maker detail pages. robots.txt: "User-agent: * Allow: /" (obeyed). GET only, ~2.5 s spacing, 12 requests total, no login/forms/APIs.
Files:
- makers.csv: 258 rows (91 manufacturers, 167 bootmakers). Fields: section,name,location,search_blurb (the page's own data-maker-search text),url,source_url. Location may be blank or "Location not documented".
- maker_samples.json: 8 detail pages (abilene, acme-boots, lucchese, tony-lama, dan-post, frye, charlie-dunn, earl-beck): title, section headings, 1500-char text excerpt. Pages are narrative (History, Why collectors care, Known for, Identification and markings, Sources); tabs Profile/Boots/History/Identification/Sources. No structured model/style-number fields found in static HTML (no dt/dd tables); "Boots" tab content likely JS-loaded.
- lookup_notes.md: /lookup is JS-only (Supabase) — blocker.
NOT a complete export. Maker directory is complete only as of the static page at fetch time; no models/style numbers captured.

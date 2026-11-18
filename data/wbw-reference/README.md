# WBW reference pull (read-only) — 2026-11-07 15:35 ET
Sources: https://www.westernbootworld.com/library/makers, /lookup, 8 maker detail pages. robots.txt: "User-agent: * Allow: /" (obeyed). GET only, ~2.5 s spacing, 12 requests total, no login/forms/APIs.
Files:
- makers.csv: 258 rows (91 manufacturers, 167 bootmakers). Fields: section,name,location,search_blurb (the page's own data-maker-search text),url,source_url. Location may be blank or "Location not documented".
- maker_samples.json: 8 detail pages (abilene, acme-boots, lucchese, tony-lama, dan-post, frye, charlie-dunn, earl-beck): title, section headings, 1500-char text excerpt. Pages are narrative (History, Why collectors care, Known for, Identification and markings, Sources); tabs Profile/Boots/History/Identification/Sources. No structured model/style-number fields found in static HTML (no dt/dd tables); "Boots" tab content likely JS-loaded.
- lookup_notes.md: /lookup is JS-only (Supabase) — blocker.
The maker directory above is the 2026-11-07 static page. models_sample.normalized.json is the earlier 100-card excerpt and is not what import uses.

## Catalog used at import — 2026-11-08
- models.csv: 12,487 unique records across 87 makers. Every maker's row count equals the site's shown total. Read-only render of the public catalog pages (Edge headless, GET only, no login). Columns: maker_slug, record_title, style_number, other_card_text, maker_total_records_shown, record_url, source_url.
- sha256: d6e8c7a642712ee27d28b394c10062b6ccb762d188f9c385c77afebc44537e45
- 1,262 rows have a blank style_number and never match. A match is the exact maker plus the full style number. Leading zeros stay. Conflicting cards for one maker and style are not used.
- Nothing is fetched from westernbootworld.com at runtime.

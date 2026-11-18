# /lookup notes (fetched 2026-11-07 15:35 ET)
- GET https://www.westernbootworld.com/lookup -> HTTP 200, 214 KB, but the server returns the generic site app shell (title "Western Boot World", canonical "/"), not a server-rendered lookup page.
- Lookup UI is rendered client-side by JS (route.js, taxonomy.js, supabase-config.public.js, vendor/supabase-js). Data comes from a Supabase backend.
- Visible static inputs in the shell (marketplace/home, not lookup-specific): search box #boot-search (placeholder "Lucchese, caiman, 10.5D, black cherry"), quick filters size, width, brand (datalist market-brand-options), condition, show, max price, sort.
- Site tagline: "Look up any boot by maker and style number, and ask people who know the story." Links seen: "Lookup corrections", lookup/review.
- BLOCKER: result fields/layout for public boot matches are JS-only + Supabase API. Per rules (no private/internal API probing, no form submits) not fetched. Result field schema NOT verified. Options: Dan OKs a headless-browser read of the rendered page, or WBW owner provides an export/documented API.

# WBW model sample validation

Validated locally on November 7, 2026 (ET). No network, browser, API, user-machine access, repository edits, or integration performed. PR #9 is already live; this sample remains unintegrated.

## Coverage and fidelity
- 100 data rows, 7 CSV columns; 20 cards each from page 1 of five catalogs. All 100 rows agree exactly with local card headings, explicit Style text, other paragraph text, record links, source paths, and displayed catalog totals.
- Abilene: 20/93 (21.51%); Dan Post: 20/804 (2.49%); Frye: 20/144 (13.89%); Lucchese: 20/947 (2.11%); Tony Lama: 20/1,070 (1.87%). Combined: 100/3,058 displayed records (3.27%), not the entire WBW database. Page-one sample is not representative or a complete export.
- Record and source URLs have the expected HTTPS www.westernbootworld.com paths; 100 distinct UUID-shaped record links. No duplicate rows, record URLs, or nonempty maker+style keys; no cross-maker style collisions in this sample. No record URL was fetched or its content verified.
- 98 explicit styles; 2 null styles: Frye “1940's FRYE Boot Company Vintage” and Tony Lama ““Firewalker” Red Lizard Inlay”. These headings are not parsed into dates, model names, or styles.
- 33 styles begin with zero. Keep all identifier/text columns as strings; only catalog totals are integers. Preserve case, punctuation, internal spaces, and leading zeros (e.g. 0030, 03152, 0085C2, 0507R, 0155427). Compound strings “88012 DL821” and “1047 12928507” remain intact; do not split into inferred styles/SKUs. Preserve 4540-M, 1331PX, and 1350ZZ unchanged.

## Supported facts and limits
- Cards support maker catalog membership, literal heading, explicit Style value when present, optional literal card text, and record link only. Maker display names are the catalog headings, not inferred identities.
- Nine cards contain additional text: Rhino (2), Cow (3), Quill Ostrich (1), Elephant (1), Caiman (1), Lizard (1). The remaining 91 have no such text. Stored as other_card_text, not verified skin/material facts. Absence means unknown, not a material classification.
- No verified model names, manufacture years/countries, authenticity, legal/exotic status, or applicability to a seller’s particular boots. A title mentioning vintage/1940s or lizard is only a quoted heading. No image/skin identification performed.
- lookup_rendered.md describes /lookup as a marketplace/app-shell render, not confirmed style results. Its notes do not establish a lookup API or matching behavior. Catalog controls mention search/filter/sort, but none were exercised; ordering is not evidence of completeness.

## Conservative candidate matching
- Resolve maker explicitly to one of these exact catalog identities, then compare a seller-confirmed style string exactly. At most trim surrounding whitespace. Never coerce numbers, drop zeros, strip suffixes/hyphens, tokenize compound styles, fuzzy-match, or use skin/title alone as a style key.
- An exact maker+style hit yields a sourced candidate requiring seller review, not confirmed identification or automatic enrichment/publication. Missing styles are ineligible. Conflicts or multiple future hits must remain ambiguous; no hit means outside/absent from this partial sample, not nonexistent.
- Optional card text may be displayed as a reference claim with provenance; do not write it as a seller boot’s material without independent confirmation. Full record pages were not opened, so corroborating details remain unavailable.

## Output
- models_sample.normalized.json: 100 faithful records, null for absent style/extra text, string identifiers, integer totals, explicit partial_sample flags, integration=false, and per-record source URL/local HTML SHA-256/card position/CSV line/raw card text. No inferred model or skin fields.
- Original CSV and HTML unchanged. Source capture is reported as November 7, 2026 (ET); no precise capture time independently verified.

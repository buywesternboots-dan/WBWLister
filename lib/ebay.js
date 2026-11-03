// eBay, through eBay's official Browse API (server-side, no scraping). Needs a free eBay Developers Program app:
// env EBAY_CLIENT_ID (App ID) and EBAY_CLIENT_SECRET (Cert ID). Until they're set, imports say so.
const API = 'https://api.ebay.com';
const HEADERS = { 'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US' };
const CATEGORY = 11450; // Clothing, Shoes & Accessories — eBay requires a category (or keywords) to list a seller's items

// App token (client credentials), cached until shortly before it expires.
let token;
async function auth() {
  const { EBAY_CLIENT_ID: id, EBAY_CLIENT_SECRET: secret } = process.env;
  if (!id || !secret) throw new Error('eBay import needs eBay API keys — add EBAY_CLIENT_ID and EBAY_CLIENT_SECRET in Vercel (Settings → Environment Variables).');
  if (token?.expires > Date.now()) return token.value;
  const r = await fetch(`${API}/identity/v1/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}` },
    body: 'grant_type=client_credentials&scope=https%3A%2F%2Fapi.ebay.com%2Foauth%2Fapi_scope',
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`eBay sign-in failed: ${j.error_description ?? r.status}`);
  token = { value: j.access_token, expires: Date.now() + (j.expires_in - 60) * 1000 };
  return token.value;
}
async function call(path) {
  const r = await fetch(`${API}${path}`, { headers: { ...HEADERS, Authorization: `Bearer ${await auth()}` } });
  const j = await r.json();
  if (!r.ok) throw new Error(`eBay: ${j.errors?.[0]?.message ?? r.status}`);
  return j;
}

// Seller username from a link: ebay.com/usr/<name>, ebay.com/sch/<name>/m.html, or …?_ssn=<name>.
export function ebaySeller(link) {
  const u = new URL(link.includes('://') ? link : `https://${link}`);
  if (!/(^|\.)ebay\.com$/.test(u.hostname)) return null;
  const name = u.searchParams.get('_ssn') ?? u.pathname.match(/^\/(?:usr|sch)\/([^/]+)/)?.[1];
  if (!name) throw new Error('Use the seller\'s username link (ebay.com/usr/<username>) — store links (ebay.com/str/…) don\'t say the username.');
  return decodeURIComponent(name);
}

// One eBay item (Browse API item) → item fields. Item specifics are the seller's own structured fields, so they count as given.
function ebayItem(i) {
  const a = Object.fromEntries((i.localizedAspects ?? []).map(x => [x.name, x.value]));
  const dept = a.Department ?? i.gender ?? '';
  const upper = a['Upper Material'];
  return {
    source: 'ebay', source_id: i.legacyItemId ?? i.itemId, source_url: i.itemWebUrl?.split('?')[0],
    title: i.title, price: i.price?.value ?? null,
    description: (i.description ?? i.shortDescription ?? '').replace(/<br\s*\/?>|<\/(p|div|li)>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\n\s*\n+/g, '\n').trim(),
    brand: a.Brand ?? i.brand ?? null,
    size: a['US Shoe Size'] ?? a.Size ?? i.size ?? null,
    width: a['Shoe Width'] ?? null,
    sized_for: /women/i.test(dept) ? 'Women' : /kid|boy|girl|youth|child/i.test(dept) ? 'Kids' : /men|unisex/i.test(dept) ? 'Men' : null,
    condition: /^new/i.test(i.condition ?? '') ? 'New' : 'Used',
    color: a.Color ?? i.color ?? null,
    material: upper && !/^leather$/i.test(upper) ? upper : null, // plain "Leather" — let the title name the exotic
    toe: a['Toe Shape'] ?? null, heel: a['Heel Style'] ?? a['Heel Type'] ?? null, sole: a['Outsole Material'] ?? null,
    material_cut: a['Material Cut'] ?? null, keywords: a.Features ?? a.Keywords ?? null,
    sole_length: a['Sole Length'] ?? a['Insole Length'] ?? null, sole_width: a['Sole Width'] ?? null,
    heel_height: a['Heel Height'] ?? null, shaft_circ: a['Shaft Circumference'] ?? a['Calf Circumference'] ?? null, shaft_height: a['Shaft Height'] ?? a['Boot Height'] ?? null,
    made_in: a['Country/Region of Manufacture'] ?? a['Country of Origin'] ?? null,
    category: [a.Style, a.Type, a.Theme, i.categoryPath].filter(Boolean).join(' '),
    photos: [i.image, ...(i.additionalImages ?? [])].filter(Boolean).map(p => p.imageUrl),
  };
}

// All of a seller's listings with full details: search pages of 200, then details 20 at a time.
export async function ebayListings(seller) {
  const ids = [];
  for (let offset = 0; ; offset += 200) {
    const j = await call(`/buy/browse/v1/item_summary/search?category_ids=${CATEGORY}&filter=sellers:%7B${encodeURIComponent(seller)}%7D&limit=200&offset=${offset}`);
    ids.push(...(j.itemSummaries ?? []).map(s => s.itemId));
    if (!j.next || !j.itemSummaries?.length) break;
  }
  const items = [];
  for (let i = 0; i < ids.length; i += 20)
    items.push(...((await call(`/buy/browse/v1/item/?item_ids=${ids.slice(i, i + 20).map(encodeURIComponent).join(',')}`)).items ?? []).map(ebayItem));
  return items;
}

// One listing by its page link (retrying a failed one).
export async function ebayListing(url) {
  const id = url.match(/\/itm\/(?:[^/]+\/)?(\d+)/)?.[1];
  return ebayItem(await call(`/buy/browse/v1/item/get_item_by_legacy_id?legacy_item_id=${id}`));
}

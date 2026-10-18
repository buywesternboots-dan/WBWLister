const ITEM = /facebook\.com\/marketplace\/item\/(\d+)/;
const wait = ms => new Promise(r => setTimeout(r, ms));
// Runs fn; on failure tries twice more (after 2 s, then 4 s) before giving up.
const retry = async (fn, n = 1) => { try { return await fn(); } catch (e) { if (n >= 3) throw e; await wait(n * 2000); return retry(fn, n + 1); } };
const badge = t => chrome.action.setBadgeText({ text: String(t) });
// Progress bar state (shown in the popup); status() only logs problems and milestones.
const progress = p => chrome.storage.local.set({ progress: p });
const status = async t => {
  const { log = [] } = await chrome.storage.local.get('log');
  return chrome.storage.local.set({ log: [`${new Date().toLocaleTimeString()} ${t}`, ...log].slice(0, 15) });
};

// Runs inside a Facebook listing page.
function readListing() {
  const meta = p => document.querySelector(`meta[property="${p}"]`)?.content?.trim() || '';
  const main = document.querySelector('[role="main"]') || document.body;
  const lines = main.innerText.split('\n').map(s => s.trim()).filter(Boolean);
  const at = label => lines.findIndex(l => l.toLowerCase() === label);
  const after = label => { const i = at(label); return i >= 0 ? lines[i + 1] : ''; };
  // Details: label/value pairs (Boot Style, Men's Shoe Size, Brand…) after the condition value, then the description,
  // up to the location / seller section.
  const c = at('condition'), stop = /^(see less|seller information|location is approximate|.+, [A-Z]{2})$/i;
  const LABEL = /^(boot style|style|(men|women|kid)s?['’]?s? shoe size|shoe size|size|brand|color|colou?r|material|width)$/i;
  const attrs = {};
  let j = c + 2;
  while (c >= 0 && LABEL.test(lines[j] || '')) {
    const l = lines[j].toLowerCase();
    if (/^(men|women|kid)/.test(l)) attrs.sized_for = l.startsWith('women') ? 'Women' : l.startsWith('men') ? 'Men' : 'Kids';
    attrs[l.replace(/^.*shoe size$/, 'size').replace('colour', 'color')] = lines[j + 1]; j += 2;
  }
  const desc = c < 0 ? [] : lines.slice(j, lines.findIndex((l, i) => i >= j && stop.test(l)) >>> 0);
  // Photos: this listing's gallery only (skip other listings' links), one per image file, largest copy.
  const best = {};
  for (const i of main.querySelectorAll('img')) {
    if (!i.src.includes('scontent') || i.naturalWidth < 200 || i.closest('a[href*="/marketplace/item/"]')) continue;
    const f = new URL(i.src).pathname.split('/').pop();
    if (!best[f] || i.naturalWidth > best[f].w) best[f] = { w: i.naturalWidth, src: i.src };
  }
  const title = meta('og:title') || document.title.replace(/^.*Marketplace\s*[-–]\s*/, '').replace(/\s*\|\s*Facebook$/, '');
  const description = meta('og:description') || desc.join('\n');
  return {
    source: 'facebook',
    source_id: location.href.match(/item\/(\d+)/)?.[1],
    source_url: `https://www.facebook.com/marketplace/item/${location.href.match(/item\/(\d+)/)?.[1]}/`,
    title,
    price: (lines.find(l => /^\$[\d,]+(\.\d\d)?$/.test(l)) || '').replace(/[$,]/g, '') || null,
    description,
    condition: after('condition'),
    brand: attrs.brand || null,
    sized_for: attrs.sized_for || null,
    color: attrs.color || null,
    material: attrs.material || null,
    // Size with width from the title (e.g. 10.5EE) beats FB's size field, which has no width.
    size: title.match(/\b(\d{1,2}(?:\.5)?) ?(EEE|EE|[A-EW])\b/)?.slice(1).join('') || attrs.size || after('size')
      || description.match(/\bsize:?[ \t]*(\d{1,2}(\.5)?[ \t]?(EEE|EE|[A-EW])?)\b/i)?.[1] || '',
    photos: Object.values(best).map(b => b.src).slice(0, 30).concat(Object.keys(best).length ? [] : meta('og:image') || []),
  };
}

// Runs inside a Marketplace profile page. The profile opens as a dialog over the general feed, so read and scroll only the dialog.
async function collectIds() {
  const links = () => [...(document.querySelector('[role="dialog"]') || document).querySelectorAll('a[href*="/marketplace/item/"]')];
  const ids = () => [...new Set(links().map(a => a.href.match(/item\/(\d+)/)?.[1]).filter(Boolean))];
  for (let n = 0, same = 0, k = 0; same < 3 && k++ < 40;) {
    const last = links().at(-1);
    last ? last.scrollIntoView({ block: 'end' }) : scrollTo(0, document.body.scrollHeight);
    await new Promise(r => setTimeout(r, 1500));
    const c = ids().length; same = c === n ? same + 1 : 0; n = c;
  }
  return ids();
}

const run = async (tabId, func, world = 'ISOLATED') => (await chrome.scripting.executeScript({ target: { tabId }, func, world }))[0].result;

// Runs inside a Depop shop page (page context, so Depop's own listing feed answers): every listing for sale → item fields.
async function readDepopShop() {
  const id = performance.getEntriesByType('resource').map(e => e.name.match(/\/shops\/(\d+)\/products/)?.[1]).find(Boolean);
  if (!id) throw new Error('Could not find the shop on this page — is it a Depop shop link?');
  const all = [];
  for (let after = ''; ;) {
    const j = await (await fetch(`https://webapi.depop.com/presentation/api/v1/shops/${id}/products/?limit=24${after ? `&after=${after}` : ''}`)).json();
    all.push(...j.objects);
    if (!j.page_info?.has_more) break;
    after = j.page_info.last;
    await new Promise(r => setTimeout(r, 500));
  }
  const cap = s => s && s[0].toUpperCase() + s.slice(1);
  return all.filter(o => o.status === 'STATUS_ONSALE').map(o => {
    const a = o.attributes ?? {}, pr = o.pricing ?? {}, desc = o.description ?? '';
    return {
      source: 'depop', source_id: o.slug, source_url: `https://www.depop.com/products/${o.slug}/`,
      title: desc.split('\n')[0].trim().slice(0, 120), // Depop listings have no title; the first line serves as one
      description: desc,
      price: pr[pr.final_price_key]?.price_breakdown?.price?.amount ?? pr.display_price?.headline_price?.amount ?? null,
      brand: a.brand === 'unbranded' ? 'Unbranded' : o.brand_name && o.brand_name !== 'Other' ? o.brand_name : null,
      size: o.sizes?.[0]?.name ?? null,
      sized_for: a.is_kids ? 'Kids' : a.gender === 'female' ? 'Women' : a.gender === 'male' ? 'Men' : null,
      condition: a.condition === 'brand_new' ? 'New' : 'Used',
      color: cap(a.colour?.[0]) ?? null,
      category: [o.category_name, a.product_type, ...(a.style ?? [])].filter(Boolean).join(' '), // helps tell boots/belts apart
      photos: (o.pictures ?? []).map(p => Object.values(p.formats).sort((x, y) => y.width - x.width)[0].url),
    };
  });
}

// Imports started from the WBW Lister page use that page's server and selected seller instead of the popup's.
let job = null;
async function api(method, body, q = '') {
  const saved = await chrome.storage.sync.get(['server', 'seller', 'password']);
  const { server, seller, password } = { ...saved, ...job };
  if (!server) throw new Error('Set the WBW server URL in the extension popup.');
  const r = await fetch(`${server.replace(/\/$/, '')}/api/items${q}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${seller || ''}`, 'x-app-password': password || '' },
    body: body && JSON.stringify(body),
    credentials: 'include', // the page's login cookie, when started from the page
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error);
  return j;
}
const send = item => api('POST', item);

const loaded = tabId => Promise.race([wait(20000), new Promise(res => chrome.tabs.onUpdated.addListener(function l(id, info) {
  if (id === tabId && info.status === 'complete') { chrome.tabs.onUpdated.removeListener(l); res(); }
}))]);

async function importUrl(url) {
  const tab = await chrome.tabs.create({ url, active: false });
  await loaded(tab.id);
  await wait(2500);
  try {
    return await send(await run(tab.id, readListing));
  }
  finally { chrome.tabs.remove(tab.id); }
}

// Opens the seller's Marketplace profile and imports every listing in it (non-boots land in Unsure).
// Import: new listings only. Sync: re-reads every listing (the server refreshes changed ones, ignores unchanged)
// and moves items no longer listed to Removed.
// Depop: one visit to the shop reads every listing from Depop's feed (no per-listing page visits needed).
async function importDepop(shop, sync) {
  const known = new Set(await api('GET', null, '?source=depop')); // first: fails if the seller has no details yet
  if (sync) known.clear();
  const tab = await chrome.tabs.create({ url: `https://www.depop.com/${shop}/` });
  await loaded(tab.id);
  await wait(4000);
  status('Reading the Depop shop…');
  let items;
  try { items = await run(tab.id, readDepopShop, 'MAIN'); } finally { chrome.tabs.remove(tab.id); }
  status(`Found ${items.length} listings for sale`);
  const todo = items.filter(i => !known.has(i.source_id)), n = { added: 0, updated: 0, failed: 0, removed: 0 };
  for (const [i, item] of todo.entries()) {
    badge(todo.length - i);
    progress({ done: i, total: todo.length, label: `${sync ? 'Syncing' : 'Importing'} — ${n.added} added, ${n.updated} updated, ${n.failed} failed` });
    try { const r = await retry(() => send(item)); if (r.item?.updated) n.updated++; else if (r.item) n.added++; }
    catch (e) { n.failed++; status(`"${item.title.slice(0, 40)}" failed: ${e.message}`); }
  }
  if (sync) n.removed = (await api('PATCH', { action: 'sync', source: 'depop', ids: items.map(i => i.source_id) })).removed;
  badge('');
  return n;
}

async function importProfile(sellerId, sync) {
  const known = new Set(await api('GET', null, '?source=facebook')); // first: fails if the seller has no details yet
  if (sync) known.clear();
  const tab = await chrome.tabs.create({ url: `https://www.facebook.com/marketplace/profile/${sellerId}/` });
  await loaded(tab.id);
  await wait(3000);
  status('Scanning profile for listings…');
  const ids = await run(tab.id, collectIds);
  status(`Found ${ids.length} listings on the profile`);
  if (!ids.length) throw new Error('No listings found on this profile.');
  const todo = ids.filter(id => !known.has(id));
  const n = { added: 0, updated: 0, failed: 0, removed: 0 };
  for (let i = 0; i < todo.length; i++) {
    badge(todo.length - i);
    progress({ done: i, total: todo.length, label: `${sync ? 'Syncing' : 'Importing'} — ${n.added} added, ${n.updated} updated, ${n.failed} failed` });
    try {
      const r = await retry(() => importUrl(`https://www.facebook.com/marketplace/item/${todo[i]}/`));
      if (r.item?.updated) n.updated++; else if (r.item) n.added++;
    } catch (e) { n.failed++; status(`Listing ${todo[i]} failed: ${e.message}`); }
    await wait(3000 + Math.random() * 3000);
  }
  if (sync) n.removed = (await api('PATCH', { action: 'sync', source: 'facebook', ids })).removed;
  badge('');
  return n;
}

const addCurrent = async tabId => retry(async () => send(await run(tabId, readListing)));

// From the page: { type: 'link', link, sync, seller, server } — a Facebook profile or Depop shop link.
const fromLink = (link, sync) => {
  const fb = link.match(/marketplace\/profile\/(\d+)/)?.[1], shop = link.match(/depop\.com\/(?!products\/)([\w.-]+)/)?.[1];
  if (fb) return importProfile(fb, sync);
  if (shop) return importDepop(shop, sync);
  throw new Error('Not a Facebook Marketplace profile or Depop shop link.');
};

chrome.runtime.onMessage.addListener((m, _, reply) => {
  job = m.server ? { server: m.server, seller: m.seller } : null;
  (async () => m.type === 'link' ? fromLink(m.link, m.sync) : m.type === 'profile' ? importProfile(m.sellerId, m.sync) : m.type === 'depop' ? importDepop(m.shop, m.sync) : addCurrent(m.tabId))()
    .then(r => { if (m.type !== 'listing') progress(null), status(`Done: ${r.added} added, ${r.updated} updated, ${r.removed} removed, ${r.failed} failed.`); reply({ r }); },
      e => { badge('!'); progress(null); status(`Error: ${e.message}`); reply({ error: e.message }); })
    .finally(() => { job = null; });
  return true;
});

chrome.runtime.onInstalled.addListener(() => chrome.contextMenus.create({
  id: 'wbw', title: 'Add to WBW', contexts: ['link', 'page'], documentUrlPatterns: ['https://*.facebook.com/*'],
}));

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const link = ITEM.test(info.linkUrl || '') ? info.linkUrl : null;
  try {
    if (!link && !ITEM.test(tab.url)) throw new Error();
    await (link ? importUrl(link) : addCurrent(tab.id));
    badge('✓');
  } catch { badge('!'); }
  setTimeout(() => badge(''), 3000);
});

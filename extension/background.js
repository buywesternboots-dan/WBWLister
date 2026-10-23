const ITEM = /facebook\.com\/marketplace\/item\/(\d+)/;
const wait = ms => new Promise(r => setTimeout(r, ms));
// Runs fn; on failure tries twice more (after 2 s, then 4 s) before giving up.
const retry = async (fn, n = 1) => { try { return await fn(); } catch (e) { if (n >= 3) throw e; await wait(n * 2000); return retry(fn, n + 1); } };
const done = n => `Done: ${n.added} new, ${n.updated} changed, ${n.removed} gone (now Pending sold), ${n.failed} failed.`;
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
    size: attrs.size || after('size') || null, // the server reads size/width from the title and description too
    photos: Object.values(best).map(b => b.src).concat(Object.keys(best).length ? [] : meta('og:image') || []),
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

// ---- talking to the BootLister server ----
// Jobs started from the BootLister page use that page's server and seller; jobs from the popup use the popup's saved settings.
let job = null;
async function api(method, body, q = '') {
  const { server, seller, token } = { ...(await chrome.storage.sync.get(['server', 'seller', 'token'])), ...job };
  if (!server) throw new Error('Set the BootLister address in the extension popup.');
  const r = await fetch(`${server.replace(/\/$/, '')}/api/items${q}`, {
    method, credentials: 'include', // the page's login cookie, when started from the page
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${seller || ''}`, 'x-auth': token || '' },
    body: body && JSON.stringify(body),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error);
  return j;
}
const send = item => api('POST', item);

// ---- tabs ----
const run = async (tabId, func, world = 'ISOLATED') => (await chrome.scripting.executeScript({ target: { tabId }, func, world }))[0].result;
// Resolves when the tab finishes loading (or after 20 s, whichever is first).
const loaded = tabId => new Promise(res => {
  const done = () => { chrome.tabs.onUpdated.removeListener(l); clearTimeout(t); res(); };
  const l = (id, info) => id === tabId && info.status === 'complete' && done();
  const t = setTimeout(done, 20000);
  chrome.tabs.onUpdated.addListener(l);
});
// Opens url in a tab, waits for it to settle, runs fn(tabId), always closes the tab.
async function inTab(url, settle, fn, active = true) {
  const tab = await chrome.tabs.create({ url, active });
  try { await loaded(tab.id); await wait(settle); return await fn(tab.id); }
  finally { chrome.tabs.remove(tab.id).catch(() => {}); }
}
const importListing = url => inTab(url, 2500, async id => send(await run(id, readListing)), false);

// ---- imports ----
// Shared loop: importOne(entry) for each entry, retrying twice, with progress in the popup/page. Sync then moves
// listings that are gone to Removed.
async function importAll({ source, ids, todo, sync, importOne, pause = 0, name = e => e }) {
  const n = { added: 0, updated: 0, failed: 0, removed: 0 };
  for (const [i, entry] of todo.entries()) {
    badge(todo.length - i);
    progress({ done: i, total: todo.length, label: `${sync ? 'Syncing' : 'Importing'} — ${n.added} added, ${n.updated} updated, ${n.failed} failed` });
    try { const r = await retry(() => importOne(entry)); if (r.item?.updated) n.updated++; else if (r.item) n.added++; }
    catch (e) { n.failed++; status(`${name(entry)} failed: ${e.message}`); }
    if (pause) await wait(pause + Math.random() * pause); // Facebook: human pace
  }
  if (sync) n.removed = (await api('PATCH', { action: 'sync', source, ids })).removed;
  return n;
}

// Facebook: scan the profile for listing ids, then open each listing (human-paced). Import = new only; Sync = re-read all.
async function importFacebook(profileId, sync) {
  const known = new Set(await api('GET', null, '?source=facebook')); // first: fails if the seller isn't set up
  status('Scanning the Facebook profile for listings…');
  const ids = await inTab(`https://www.facebook.com/marketplace/profile/${profileId}/`, 3000, id => run(id, collectIds));
  status(`Found ${ids.length} listings on the profile`);
  if (!ids.length) throw new Error('No listings found on this profile.');
  return importAll({ source: 'facebook', ids, sync, todo: sync ? ids : ids.filter(id => !known.has(id)), pause: 3000,
    importOne: id => importListing(`https://www.facebook.com/marketplace/item/${id}/`), name: id => `Listing ${id}` });
}

// Depop: one visit to the shop reads every listing from Depop's own feed — no per-listing visits.
async function importDepop(shop, sync) {
  const known = new Set(await api('GET', null, '?source=depop')); // first: fails if the seller isn't set up
  status('Reading the Depop shop…');
  const items = await inTab(`https://www.depop.com/${shop}/`, 4000, id => run(id, readDepopShop, 'MAIN'));
  status(`Found ${items.length} listings for sale`);
  return importAll({ source: 'depop', ids: items.map(i => i.source_id), sync, todo: sync ? items : items.filter(i => !known.has(i.source_id)),
    importOne: send, name: i => `"${i.title.slice(0, 40)}"` });
}

// A Facebook Marketplace profile or Depop shop link → the right importer.
function importLink(link, sync) {
  const fb = link?.match(/marketplace\/profile\/(\d+)/)?.[1], shop = link?.match(/depop\.com\/(?!products\/)([\w.-]+)/)?.[1];
  if (fb) return importFacebook(fb, sync);
  if (shop) return importDepop(shop, sync);
  throw new Error('That isn\'t a Facebook Marketplace profile or Depop shop link.');
}
const addCurrent = tabId => retry(async () => send(await run(tabId, readListing)));

// Messages: { type: 'link', link, sync } (popup or page) or { type: 'listing', tabId } (popup: add the open listing).
// Page messages also carry { server, seller }. One import at a time.
let busy = false;
chrome.runtime.onMessage.addListener((m, _, reply) => {
  if (busy && m.type === 'link') return reply({ error: 'An import is already running — wait for it to finish.' });
  busy = m.type === 'link';
  job = m.server ? { server: m.server, seller: m.seller } : null;
  (async () => m.type === 'link' ? importLink(m.link, m.sync) : addCurrent(m.tabId))()
    .then(r => { if (m.type === 'link') status(done(r)); reply({ r }); },
      e => { badge('!'); status(`Error: ${e.message}`); reply({ error: e.message }); })
    .finally(() => { busy = false; job = null; progress(null); badge(''); });
  return true;
});

// Right-click "Add to BootLister" on a Facebook listing (or a link to one).
chrome.runtime.onInstalled.addListener(() => chrome.contextMenus.create({
  id: 'bootlister', title: 'Add to BootLister', contexts: ['link', 'page'], documentUrlPatterns: ['https://*.facebook.com/*'],
}));
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const link = ITEM.test(info.linkUrl || '') ? info.linkUrl : null;
  try {
    if (!link && !ITEM.test(tab.url)) throw new Error();
    await (link ? importListing(link) : addCurrent(tab.id));
    badge('✓');
  } catch { badge('!'); }
  setTimeout(() => badge(''), 3000);
});

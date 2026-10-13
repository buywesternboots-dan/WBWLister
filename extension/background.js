const ITEM = /facebook\.com\/marketplace\/item\/(\d+)/;
const wait = ms => new Promise(r => setTimeout(r, ms));
const badge = t => chrome.action.setBadgeText({ text: String(t) });
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
  while (c >= 0 && LABEL.test(lines[j] || '')) { attrs[lines[j].toLowerCase().replace(/^.*shoe size$/, 'size')] = lines[j + 1]; j += 2; }
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
    seller_ids: [...new Set([...document.querySelectorAll('a[href*="/marketplace/profile/"]')].map(a => a.href.match(/profile\/(\d+)/)?.[1]).filter(Boolean))],
    title,
    price: (lines.find(l => /^\$[\d,]+(\.\d\d)?$/.test(l)) || '').replace(/[$,]/g, '') || null,
    description,
    condition: after('condition'),
    brand: attrs.brand || null,
    // Size with width from the title (e.g. 10.5EE) beats FB's size field, which has no width.
    size: title.match(/\b(\d{1,2}(?:\.5)?) ?(EEE|EE|[A-EW])\b/)?.slice(1).join('') || attrs.size || after('size')
      || description.match(/\bsize:?[ \t]*(\d{1,2}(\.5)?[ \t]?(EEE|EE|[A-EW])?)\b/i)?.[1] || '',
    photos: Object.values(best).map(b => b.src).slice(0, 20).concat(Object.keys(best).length ? [] : meta('og:image') || []),
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

const run = async (tabId, func) => (await chrome.scripting.executeScript({ target: { tabId }, func }))[0].result;

async function api(method, body, q = '') {
  const { server, seller } = await chrome.storage.sync.get(['server', 'seller']);
  if (!server) throw new Error('Set the WBW server URL in the extension popup.');
  const r = await fetch(`${server.replace(/\/$/, '')}/api/items${q}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${seller || 'demo'}` },
    body: body && JSON.stringify(body),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error);
  return j;
}
const send = item => api('POST', item);

const loaded = tabId => Promise.race([wait(20000), new Promise(res => chrome.tabs.onUpdated.addListener(function l(id, info) {
  if (id === tabId && info.status === 'complete') { chrome.tabs.onUpdated.removeListener(l); res(); }
}))]);

async function importUrl(url, sellerId, overwrite) {
  const tab = await chrome.tabs.create({ url, active: false });
  await loaded(tab.id);
  await wait(2500);
  try {
    const item = await run(tab.id, readListing);
    if (sellerId && item.seller_ids.length && !item.seller_ids.includes(sellerId)) return { other: true, sellers: item.seller_ids };
    return await send({ ...item, overwrite });
  }
  finally { chrome.tabs.remove(tab.id); }
}

// Opens the seller's Marketplace profile and imports their listings (profile pages also show other sellers'; those are skipped).
// sync: also moves items no longer listed to Removed. overwrite: re-reads known listings and updates changed ones.
async function importProfile(sellerId, sync, overwrite) {
  const tab = await chrome.tabs.create({ url: `https://www.facebook.com/marketplace/profile/${sellerId}/` });
  await loaded(tab.id);
  await wait(3000);
  status('Scanning profile for listings…');
  const ids = await run(tab.id, collectIds);
  status(`Found ${ids.length} listings on the profile`);
  if (!ids.length) throw new Error('No listings found on this profile.');
  const known = new Set(overwrite ? [] : await api('GET', null, '?source=facebook'));
  const todo = ids.filter(id => !known.has(id));
  const n = { added: 0, updated: 0, failed: 0, removed: 0 };
  for (let i = 0, others = 0; i < todo.length; i++) {
    badge(todo.length - i);
    status(`Listing ${i + 1} of ${todo.length} (${ids.length - todo.length} already imported) — ${n.added} added, ${n.updated} updated, ${n.failed} failed`);
    try {
      const r = await importUrl(`https://www.facebook.com/marketplace/item/${todo[i]}/`, sellerId, overwrite);
      if (r.other) { status(`Skipped ${todo[i]}: seller links on page ${r.sellers.join(', ') || 'none'}, expected ${sellerId}`); if (++others >= 3) break; continue; }
      others = 0;
      if (r.item?.updated) n.updated++; else if (r.item) n.added++;
    } catch (e) { n.failed++; status(`Listing ${todo[i]} failed: ${e.message}`); }
    await wait(3000 + Math.random() * 3000);
  }
  if (sync) n.removed = (await api('PATCH', { action: 'sync', source: 'facebook', ids })).removed;
  badge('');
  return n;
}

const addCurrent = async tabId => send(await run(tabId, readListing));

chrome.runtime.onMessage.addListener((m, _, reply) => {
  (m.type === 'profile' ? importProfile(m.sellerId, m.sync, m.overwrite) : addCurrent(m.tabId))
    .then(r => { if (m.type === 'profile') status(`Done: ${r.added} added, ${r.updated} updated, ${r.removed} removed, ${r.failed} failed.`); reply({ r }); },
      e => { badge('!'); status(`Error: ${e.message}`); reply({ error: e.message }); });
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

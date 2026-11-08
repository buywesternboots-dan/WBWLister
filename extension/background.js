import { acceptScan, collectIds, explainPageFailure, readDepopShop, validateFacebookListing, NO_FACEBOOK_LISTINGS } from './import-page.mjs';
import { createImportLock, planSync, sameOrigin, withDeadline } from './import-job.mjs';

const ITEM = /facebook\.com\/marketplace\/item\/(\d+)/;
const siteOf = url => /facebook\.com/i.test(url || '') ? 'Facebook' : /depop\.com/i.test(url || '') ? 'Depop' : 'The page';
const wait = ms => new Promise(r => setTimeout(r, ms));
// Runs fn; on failure tries twice more (after 2 s, then 4 s) before giving up.
const retry = async (fn, n = 1) => { try { return await fn(); } catch (e) { if (n >= 3) throw e; await wait(n * 2000); return retry(fn, n + 1); } };
const done = n => `Done: ${n.added} new, ${n.updated} changed, ${n.removed} gone (now Pending sold), ${n.failed} failed.${n.skipped ? ` ${n.skipped}` : ''}`;
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

// ---- talking to the BootLister server ----
// Seller, server, and token are copied when a job starts. Later popup edits do not change this job.
const lock = createImportLock();
async function snapshot(message) {
  const saved = await chrome.storage.sync.get(['server', 'seller', 'token']);
  const server = String(message?.server || saved.server || '').replace(/\/$/, '');
  const seller = String(message?.seller || saved.seller || '').trim().toLowerCase();
  const token = saved.token && sameOrigin(saved.server, server) ? saved.token : '';
  return { server, seller, token, tokenServer: server };
}
async function api(method, body, q = '') {
  const { server, headers } = lock.auth();
  const r = await fetch(`${server}/api/items${q}`, {
    method, credentials: 'include', // the page's login cookie, when started from the page
    headers, body: body && JSON.stringify(body),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error);
  return j;
}
const send = item => api('POST', item);

// ---- tabs ----
// Listener goes on before the tab exists so a redirect during creation is still recorded.
function armNavError() {
  const errors = new Map();
  const onErr = d => { if (d.frameId === 0 && d.error) errors.set(d.tabId, d.error); };
  try { chrome.webNavigation.onErrorOccurred.addListener(onErr); } catch { /* permission missing */ }
  return {
    read: id => errors.get(id) || '',
    stop() { try { chrome.webNavigation.onErrorOccurred.removeListener(onErr); } catch { /* listener already gone */ } },
  };
}
// The deadline covers the executeScript promise itself. A null result is not a listing list.
async function runCall(tabId, func, world, args, budgetMs, site) {
  const pending = chrome.scripting.executeScript({ target: { tabId }, world, func, args });
  const frames = await withDeadline(pending, budgetMs, `${site} didn't finish reading the page before the time limit. Nothing was imported.`);
  return frames?.[0]?.result;
}
// Resolves when the tab finishes loading (or after 20 s, whichever is first).
const loaded = tabId => new Promise(res => {
  const done = () => { chrome.tabs.onUpdated.removeListener(l); clearTimeout(t); res(); };
  const l = (id, info) => id === tabId && info.status === 'complete' && done();
  const t = setTimeout(done, 20000);
  chrome.tabs.onUpdated.addListener(l);
});
// Opens url in a tab, waits for it to settle, runs fn(tabId, site). Leaves the tab open when the site didn't load.
async function inTab(url, settle, fn, active = true) {
  const nav = armNavError();
  const site = siteOf(url);
  let tab, close = true;
  try {
    tab = await chrome.tabs.create({ url, active });
    await loaded(tab.id);
    const info = await chrome.tabs.get(tab.id);
    const blocked = explainPageFailure({ site, tabUrl: info.url || '', title: info.title || '', netError: nav.read(tab.id), pageUrl: url });
    if (blocked) { close = false; throw new Error(blocked); }
    await wait(settle);
    return await fn(tab.id, site);
  } catch (e) {
    const blocked = explainPageFailure({ site, message: e.message || '', netError: tab ? nav.read(tab.id) : '', pageUrl: url });
    if (blocked) { close = false; throw new Error(blocked); }
    if (/didn't return a result|timed out|not the requested|Nothing was imported/i.test(e.message || '')) close = false;
    throw e;
  } finally {
    nav.stop();
    if (close && tab) chrome.tabs.remove(tab.id).catch(() => {});
  }
}
const importListing = url => inTab(url, 2500, async (id, site) => {
  const raw = await runCall(id, readListing, 'ISOLATED', [], 15000, site);
  const item = validateFacebookListing(raw);
  if (!item) throw new Error('This Facebook listing did not match the open item page. Nothing was imported.');
  return send(item);
}, false);

// ---- imports ----
// Shared loop: importOne(entry) for each entry, retrying twice, with progress in the popup/page. Sync then moves
// listings that are gone to Removed.
async function importAll({ source, ids, todo, sync, complete, importOne, pause = 0, name = e => e }) {
  const n = { added: 0, updated: 0, failed: 0, removed: 0 };
  for (const [i, entry] of todo.entries()) {
    badge(todo.length - i);
    progress({ done: i, total: todo.length, label: `${sync ? 'Syncing' : 'Importing'} — ${n.added} added, ${n.updated} updated, ${n.failed} failed` });
    try { const r = await retry(() => importOne(entry)); if (r.item?.updated) n.updated++; else if (r.item) n.added++; }
    catch (e) { n.failed++; status(`${name(entry)} failed: ${e.message}`); }
    if (pause) await wait(pause + Math.random() * pause); // Facebook: human pace
  }
  const plan = planSync(!!sync, complete, ids);
  if (plan.sync) n.removed = (await api('PATCH', { action: 'sync', source, ids: plan.ids })).removed;
  if (plan.skipped) n.skipped = plan.skipped;
  return n;
}

// Facebook: scan the profile for listing ids, then open each listing (human-paced). Import = new only; Sync = re-read all.
async function importFacebook(profileId, sync) {
  const known = new Set(await api('GET', null, '?source=facebook')); // first: fails if the seller isn't set up
  status('Scanning the Facebook profile for listings…');
  const raw = await inTab(`https://www.facebook.com/marketplace/profile/${profileId}/`, 3000,
    (id, site) => runCall(id, collectIds, 'ISOLATED', [profileId, Date.now() + 20000, 1500], 25000, site));
  const scan = acceptScan(raw, 'Facebook');
  status(`Found ${scan.items.length} listings on the profile`);
  if (!scan.items.length) throw new Error(NO_FACEBOOK_LISTINGS);
  if (scan.reason) status(scan.reason);
  return importAll({ source: 'facebook', ids: scan.items, sync, complete: scan.complete, todo: sync ? scan.items : scan.items.filter(id => !known.has(id)), pause: 3000,
    importOne: id => importListing(`https://www.facebook.com/marketplace/item/${id}/`), name: id => `Listing ${id}` });
}

// Depop: one visit to the shop reads every listing from Depop's own feed — no per-listing visits.
async function importDepop(shop, sync) {
  const known = new Set(await api('GET', null, '?source=depop')); // first: fails if the seller isn't set up
  status('Reading the Depop shop…');
  const raw = await inTab(`https://www.depop.com/${shop}/`, 4000,
    (id, site) => runCall(id, readDepopShop, 'MAIN', [shop, Date.now() + 18000], 22000, site));
  const scan = acceptScan(raw, 'Depop');
  status(`Found ${scan.items.length} listings for sale`);
  if (scan.reason) status(scan.reason);
  return importAll({ source: 'depop', ids: scan.items.map(i => i.source_id), sync, complete: scan.complete,
    todo: sync ? scan.items : scan.items.filter(i => !known.has(i.source_id)),
    importOne: send, name: i => `"${(i.title || '').slice(0, 40)}"` });
}

// A Facebook Marketplace profile or Depop shop link → the right importer.
function importLink(link, sync) {
  const fb = link?.match(/marketplace\/profile\/(\d+)/)?.[1], shop = link?.match(/depop\.com\/(?!products\/)([\w.-]+)/)?.[1];
  if (fb) return importFacebook(fb, sync);
  if (shop) return importDepop(shop, sync);
  throw new Error('That isn\'t a Facebook Marketplace profile or Depop shop link.');
}
const addCurrent = tabId => retry(async () => {
  const raw = await runCall(tabId, readListing, 'ISOLATED', [], 15000, 'Facebook');
  const item = validateFacebookListing(raw);
  if (!item) throw new Error('This Facebook listing did not match the open item page. Nothing was imported.');
  return send(item);
});

// Every entry point (page, popup, right-click) takes the same lock and the same frozen seller.
async function runEntry(message) {
  const begun = lock.begin(await snapshot(message || {}));
  if (begun.error) return { error: begun.error };
  try {
    if (message?.type === 'link') {
      const r = await importLink(message.link, message.sync);
      await status(done(r));
      return { r };
    }
    if (message?.type === 'listing' || message?.type === 'context') {
      const link = message.type === 'context' && ITEM.test(message.link || '') ? message.link : '';
      if (message.type === 'context' && !link && !ITEM.test(message.url || '')) throw new Error('Open a Marketplace listing first.');
      return { r: await (link ? importListing(link) : addCurrent(message.tabId)) };
    }
    throw new Error('Unknown request.');
  } catch (e) {
    await status(`Error: ${e.message || e}`);
    return { error: e.message || String(e) };
  } finally {
    lock.end(begun.job.id);
    progress(null);
    badge('');
  }
}

chrome.runtime.onMessage.addListener((m, _, reply) => {
  runEntry(m).then(r => { if (r.error) badge('!'); reply(r.error ? { error: r.error } : { r: r.r }); });
  return true;
});

// Right-click "Add to BootLister" on a Facebook listing (or a link to one).
chrome.runtime.onInstalled.addListener(() => chrome.contextMenus.create({
  id: 'bootlister', title: 'Add to BootLister', contexts: ['link', 'page'], documentUrlPatterns: ['https://*.facebook.com/*'],
}));
chrome.contextMenus.onClicked.addListener((info, tab) => {
  runEntry({ type: 'context', link: info.linkUrl, url: tab?.url, tabId: tab?.id }).then(r => {
    badge(r.error ? '!' : '✓');
    setTimeout(() => badge(''), 3000);
  });
});

import { acceptScan, collectIds, depopFetchJson, explainPageFailure, readDepopHook, readDepopProduct, readDepopShop, readDepopSources, rejectEmptyDepopShop, NO_FACEBOOK_LISTINGS } from './import-page.mjs';
import { bootScanSummary, rejectToStore, westernBootDecision } from './boot-gate.mjs';
import { aggregateTotal, collectDepopPages, debugDump, depopAggregatesUrl, DEPOP_PAGE_PAUSE_MS, hookPageUrls, judgeDomRead, pickShopId } from './depop-feed.mjs';
import { API_TIMEOUT_MS, actorForJob, allowedBootlisterOrigin, BOOTLISTER_ORIGINS, CANDIDATE_CAP, cookieReadUrl, createImportLock, depopBootFilters, gateWrite, importLimit, jobSummary, planFilteredShop, planKnownSkips, planSync, presenceIds, REJECT_BATCH, retryInjection, scanWindowOpen, scriptArgs, sessionFromCookie, shopAfterFilterError, shopReadArgs, SHOP_MODE_FULL, SHOP_READ_MS, SIGNED_OUT, validateItemEnvelope, withDeadline } from './import-job.mjs';

const ITEM = /facebook\.com\/marketplace\/item\/(\d+)/;
const siteOf = url => /facebook\.com/i.test(url || '') ? 'Facebook' : /depop\.com/i.test(url || '') ? 'Depop' : 'The page';
const wait = ms => new Promise(r => setTimeout(r, ms));
// Runs fn; on failure tries twice more (after 2 s, then 4 s) before giving up.
const retry = async (fn, n = 1) => { try { return await fn(); } catch (e) { if (n >= 3) throw e; await wait(n * 2000); return retry(fn, n + 1); } };
const done = n => n?.summary || jobSummary(n);
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
// The site session is the HttpOnly auth cookie. It is read once per job and is not stored.
const LEGACY_KEYS = ['pin', 'token', 'email', 'password', 'server'];
chrome.storage.sync.remove(LEGACY_KEYS);
const lock = createImportLock();
async function readAuthCookie(origin) {
  const url = cookieReadUrl(origin);
  if (!url) return '';
  const cookie = await chrome.cookies.get({ url, name: 'auth' });
  return cookie?.value || '';
}
async function chooseOrigin(message) {
  if (message?.server) return allowedBootlisterOrigin(message.server);
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true }).catch(() => []);
  const fromTab = allowedBootlisterOrigin(tab?.url || '');
  if (fromTab) return fromTab;
  for (const origin of BOOTLISTER_ORIGINS) if (await readAuthCookie(origin)) return origin;
  return '';
}
function sessionHeaders(session) {
  const headers = {};
  headers['x-auth'] = session;
  return headers;
}
async function whoAmI(origin, token) {
  const r = await fetch(`${origin}/api/me`, { headers: sessionHeaders(token), signal: AbortSignal.timeout(API_TIMEOUT_MS) });
  if (r.status === 401) return null;
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.error || 'Could not read the BootLister session.');
  return body;
}
async function snapshot(message) {
  if (message?.server && !allowedBootlisterOrigin(message.server)) return { error: 'That address is not a BootLister site.' };
  const origin = await chooseOrigin(message);
  if (!origin) return { error: SIGNED_OUT, signIn: `${BOOTLISTER_ORIGINS[0]}/login` };
  const token = await readAuthCookie(origin);
  const gate = sessionFromCookie(origin, token);
  if (!gate.ok) return gate;
  const me = await whoAmI(origin, gate.token);
  if (!me) return { error: SIGNED_OUT, signIn: `${origin}/login` };
  const actor = actorForJob({ origin, token: gate.token, role: me.role, ownSeller: me.seller, requestedSeller: message?.seller });
  if (actor.error) return actor;
  return { ...actor, limit: importLimit(message?.limit) };
}
async function api(method, body, q = '', path = '/api/items') {
  const { server, headers } = lock.auth();
  if (lock.job?.id) headers['x-import-job'] = String(lock.job.id);
  if (lock.job?.limit) headers['x-import-limit'] = String(lock.job.limit);
  const r = await fetch(`${server}${path}${q}`, {
    method, credentials: 'include', // the page's login cookie, when started from the page
    headers, body: body && JSON.stringify(body), signal: AbortSignal.timeout(API_TIMEOUT_MS),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error);
  return j;
}
async function rememberRejects(rows) {
  for (let i = 0; i < rows.length; i += REJECT_BATCH) {
    const rejects = rows.slice(i, i + REJECT_BATCH);
    await api('POST', { source: 'depop', rejects }, '', '/api/import/rejects');
  }
}
const send = item => {
  const decision = westernBootDecision(item);
  if (!decision.eligible) throw new Error(`Not a cowboy or western boot (${decision.kind}). ${decision.reason} Nothing was posted.`);
  return api('POST', item);
};

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
  const once = async (attempt) => {
    if (attempt > 1) await wait(400);
    await loaded(tabId);
    const pending = chrome.scripting.executeScript({ target: { tabId }, world, func, args: scriptArgs(args) });
    const frames = await withDeadline(pending, budgetMs, `${site} didn't finish reading the page before the time limit. Nothing was imported.`);
    return frames?.[0]?.result;
  };
  return retryInjection(once);
}
// Resolves when the tab finishes loading (or after 20 s, whichever is first).
const loaded = tabId => new Promise(res => {
  let settled = false;
  const done = () => { if (settled) return; settled = true; chrome.tabs.onUpdated.removeListener(l); clearTimeout(t); res(); };
  const l = (id, info) => id === tabId && info.status === 'complete' && done();
  const t = setTimeout(done, 20000);
  chrome.tabs.onUpdated.addListener(l);
  chrome.tabs.get(tabId).then(info => { if (info?.status === 'complete') done(); }).catch(() => {});
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
  const expected = String(url || '').match(/\/item\/(\d+)/)?.[1] || '';
  const raw = await retry(() => runCall(id, readListing, 'ISOLATED', [], 15000, site));
  const item = validateItemEnvelope(raw, { source: 'facebook', expectedId: expected });
  if (!item) throw new Error(`This Facebook listing did not match the requested item ${expected || '(missing id)'}. Nothing was imported.`);
  return send(item);
}, false);

// ---- imports ----
// Shared loop: importOne(entry) for each entry, retrying twice, with progress in the popup/page. Sync then moves
// listings that are gone to Removed.
async function importAll({ source, ids, todo, sync, complete, importOne, pause = 0, name = e => e }) {
  const n = { added: 0, updated: 0, failed: 0, removed: 0 };
  let attempts = 0;
  for (const [i, entry] of todo.entries()) {
    const gate = gateWrite({ deadline: lock.job?.deadline, written: attempts, cap: lock.job?.limit });
    if (!gate.ok) { n.partial = true; n.skipped = gate.reason; break; }
    badge(todo.length - i);
    progress({ done: i, total: todo.length, label: `${sync ? 'Syncing' : 'Importing'} — ${n.added} added, ${n.updated} updated, ${n.failed} failed` });
    try {
      const r = await importOne(entry);
      if (r?.duplicate) n.duplicate = (n.duplicate || 0) + 1;
      else { attempts += 1; if (r.item?.updated) n.updated++; else if (r.item) n.added++; }
    }
    catch (e) { attempts += 1; n.failed++; status(`${name(entry)} failed: ${e.message}`); }
    if (pause) await wait(pause + Math.random() * pause); // Facebook: human pace
  }
  // Smoke cap and an unproven scroll both refuse removal, even if the page said the scan was finished.
  const plan = planSync(!!sync, complete, ids, true);
  if (plan.sync) n.removed = (await api('PATCH', { action: 'sync', source, ids: plan.ids })).removed;
  if (plan.skipped) n.skipped = plan.skipped;
  return n;
}

// Facebook: scan the profile for listing ids, then open each listing (human-paced). Import = new only; Sync = re-read all.
async function importFacebook(profileId, sync) {
  const known = new Set(await api('GET', null, '?source=facebook')); // first: fails if the seller isn't set up
  status('Scanning the Facebook profile for listings…');
  const cap = lock.job?.limit;
  const raw = await inTab(`https://www.facebook.com/marketplace/profile/${profileId}/`, 3000,
    (id, site) => runCall(id, collectIds, 'ISOLATED', [profileId, Date.now() + 20000, 1500, cap], 25000, site));
  const scan = acceptScan(raw, 'Facebook');
  const ids = scan.items.filter(id => /^\d{5,20}$/.test(String(id))).slice(0, cap);
  status(`Found ${scan.items.length} listings on the profile; this run writes at most ${cap}.`);
  if (!ids.length) throw new Error(NO_FACEBOOK_LISTINGS);
  if (scan.reason) status(scan.reason);
  return importAll({ source: 'facebook', ids, sync, complete: false, todo: sync ? ids : ids.filter(id => !known.has(id)), pause: 3000,
    importOne: id => importListing(`https://www.facebook.com/marketplace/item/${id}/`), name: id => `Listing ${id}` });
}

// Depop: the shop tab's own document. Isolated world, so page scripts cannot replace querySelectorAll.
// The result is a plain object. Zero candidates throw before any write and before "Done".
// withHook also returns what depop-hook.js saw the page fetch itself while the grid scrolled.
async function readShopGrid(shop, url, deadline, allowEmpty, visible, cap = CANDIDATE_CAP, withHook = false) {
  const args = shopReadArgs(shop, deadline, cap, allowEmpty);
  // A background tab never loads more than the first grid page. Visible is only the API fallback.
  return inTab(url, 250, async (id, site) => {
    const grid = await runCall(id, readDepopShop, 'ISOLATED', args, SHOP_READ_MS + 5000, site);
    if (!withHook) return grid;
    let hook = null;
    try { hook = await runCall(id, readDepopHook, 'MAIN', [], 10000, site); } catch { hook = null; }
    return grid && typeof grid === 'object' ? { ...grid, hook } : grid;
  }, visible === true);
}
// Visible-tab fallback. Expected counts come from the product-list attempt when it got them.
// Depop's own JSON pages (captured by depop-hook.js) win over DOM links; the DOM read is capped at twice the
// expected count, and a cap hit, overshoot, or short read is a failed read, not a partial import.
async function readFilteredReports(shop, deadline, visible, expectedBy = {}) {
  const reports = [];
  const fallback = [];
  let variantError = '';
  for (const variant of depopBootFilters(shop)) {
    if (deadline - Date.now() < 8000) break;
    const expected = Number(expectedBy[variant.id]) || 0;
    const cap = expected ? Math.min(CANDIDATE_CAP, expected * 2) : CANDIDATE_CAP;
    try {
      const raw = await readShopGrid(shop, variant.url, deadline, true, visible, cap, true);
      const data = raw?.ok === true ? acceptScan(raw, 'Depop') : null;
      const fromHook = hookPageUrls(raw?.hook?.pages, variant.gender);
      const domUrls = data?.productUrls || [];
      const useHook = fromHook.length > 0 && (fromHook.length >= domUrls.length || (expected && fromHook.length === expected));
      const urls = useHook ? fromHook : domUrls;
      const judged = judgeDomRead({ urls, expected, capHit: !useHook && data?.capHit === true });
      fallback.push({ label: variant.label, expected, dom: domUrls.length, hook: fromHook.length, used: useHook ? 'hook' : 'dom', ok: judged.ok, reason: judged.reason, hookPages: (raw?.hook?.pages || []).map(p => ({ url: p.url, status: p.status, count: (p.items || []).length })) });
      if (expected && !judged.ok) {
        reports.push({ ...variant, urls: [], chips: [], cardTexts: [], href: '', readError: `${variant.label} ${judged.reason}` });
        variantError = `${variant.label} visible read ${judged.reason}`;
        break;
      }
      reports.push({
        ...variant,
        urls,
        chips: data?.chips || [],
        cardTexts: data?.cardTexts || [],
        href: data?.pageUrl || '',
        partial: data?.partial === true && !useHook,
        limitHit: data?.limitHit === true && !useHook,
        capHit: data?.capHit === true && !useHook,
        resultCount: expected || Number(data?.resultCount) || 0,
      });
    } catch (e) {
      const step = shopAfterFilterError(e);
      variantError = step.reason;
      reports.push({ ...variant, urls: [], chips: [], cardTexts: [], href: '', readError: step.reason });
      if (variant.gender) break;
    }
  }
  return { reports, variantError, fallback };
}
// Debug dump for the popup's "Save Depop debug" button. Kept in local storage only.
async function saveDepopDebug(dump) {
  try { await chrome.storage.local.set({ depopDebug: { ...dump, version: chrome.runtime.getManifest().version, at: new Date().toISOString() } }); }
  catch { /* storage full or unavailable; the import still reports in the popup */ }
}
// Product list in the shop tab's own session. One URL string per request, so the arguments stay serializable.
async function readDepopProductList(shop) {
  return inTab(`https://www.depop.com/${shop}/`, 250, async (tabId, site) => {
    const cache = (await chrome.storage.local.get('depopShopIds').catch(() => ({})))?.depopShopIds || {};
    const sources = await runCall(tabId, readDepopSources, 'MAIN', [shop, 5000], 20000, site);
    const picked = pickShopId(sources || {}, shop, cache[shop]);
    const dump = { shop, shopId: picked.id, source: picked.source, sources: sources || {}, variants: [] };
    if (!picked.id) {
      await saveDepopDebug(debugDump(dump));
      return { ok: false, reason: 'shop id was not on the page', debug: dump };
    }
    if (cache[shop] !== picked.id) await chrome.storage.local.set({ depopShopIds: { ...cache, [shop]: picked.id } }).catch(() => {});
    const headers = sources?.hookHeaders || {};
    const fetchJson = url => runCall(tabId, depopFetchJson, 'MAIN', [url, headers], 20000, site);
    const reports = [];
    const expectedBy = {};
    let failure = '';
    for (const variant of depopBootFilters(shop)) {
      const agg = await fetchJson(depopAggregatesUrl(picked.id, variant.gender));
      if (agg?.status === 429 || agg?.status === 403) { failure = `HTTP ${agg.status}`; break; }
      const expected = aggregateTotal(agg?.status === 200 ? agg.body : null);
      if (expected) expectedBy[variant.id] = expected;
      const collected = await collectDepopPages({
        shopId: picked.id,
        gender: variant.gender,
        cap: CANDIDATE_CAP,
        expected,
        template: picked.template,
        pause: () => wait(DEPOP_PAGE_PAUSE_MS),
        fetchJson,
      });
      dump.variants.push({ label: variant.label, gender: variant.gender, expected, ...collected, aggregatesStatus: agg?.status || 0, aggregatesError: agg?.error || '' });
      if (!collected.ok) {
        const err = collected.log?.at?.(-1)?.error;
        failure = collected.status === 429 || collected.status === 403 ? `HTTP ${collected.status}` : `product list stopped (${collected.stop}${err ? `: ${err}` : ''})`;
        break;
      }
      if (expected && !collected.complete) { failure = `${variant.label} ${collected.ids.length}/${expected} ${collected.verdict}`; break; }
      const resultCount = expected || collected.urls.length;
      reports.push({
        ...variant,
        urls: collected.urls,
        chips: [],
        cardTexts: [],
        href: variant.url,
        partial: false,
        limitHit: false,
        capHit: collected.stop === 'cap',
        resultCount,
        pages: collected.pages,
      });
    }
    await saveDepopDebug(debugDump(dump));
    if (failure) return { ok: false, reason: failure, expectedBy, debug: dump };
    return { ok: true, reports, expectedBy, debug: dump };
  }, false);
}
async function importDepop(shop, sync, recheck, shopMode) {
  const cap = lock.job?.limit;
  const deadline = Date.now() + SHOP_READ_MS;
  let scan;
  let productUrls;
  let modeNote;
  if (shopMode === 'full') {
    status(`Reading the Depop shop (${SHOP_MODE_FULL})…`);
    scan = acceptScan(await readShopGrid(shop, `https://www.depop.com/${shop}/`, deadline, false), 'Depop');
    productUrls = rejectEmptyDepopShop(scan, shop);
    modeNote = `${SHOP_MODE_FULL}.`;
  } else {
    let reports = [];
    let variantError = '';
    let api = { ok: false, reason: 'product list was not read' };
    try {
      status('Reading Depop boots from the shop product list…');
      api = await readDepopProductList(shop);
    } catch (e) {
      api = { ok: false, reason: e?.message || 'product list failed' };
    }
    if (api?.ok && api.reports?.length) reports = api.reports;
    else {
      status(`Depop product list failed (${api?.reason || 'no list'}). Scrolling the filtered grids in a visible tab.`);
      const dom = await readFilteredReports(shop, deadline, true, api?.expectedBy || {});
      reports = dom.reports;
      variantError = dom.variantError;
      if (api?.debug) await saveDepopDebug(debugDump({ ...api.debug, fallback: dom.fallback }));
      if (variantError && Object.keys(api?.expectedBy || {}).length)
        throw new Error(`Depop boots list read was incomplete (${api?.reason || 'product list'}; ${variantError}). Nothing was imported. Use "Save Depop debug" in the popup and send the file.`);
    }
    const plan = planFilteredShop(reports);
    if (plan.short) throw new Error(`Depop boots list read was short (${plan.reason}). Nothing was imported. Use "Save Depop debug" in the popup and send the file.`);
    if (variantError || !plan.ok) {
      const reason = variantError || plan.reason;
      status(`Depop filter failed (${reason}). Reading the full shop.`);
      if (deadline - Date.now() < 8000) throw new Error(`Filter failed (${reason}). The full shop was not read because the time limit was too close. Nothing was imported.`);
      scan = acceptScan(await readShopGrid(shop, `https://www.depop.com/${shop}/`, deadline, false), 'Depop');
      productUrls = rejectEmptyDepopShop(scan, shop);
      modeNote = `Filter failed (${reason}). ${SHOP_MODE_FULL}.`;
    } else if (!plan.urls.length) {
      throw new Error(`${plan.note} No boots were listed in the filtered grids. Nothing was imported.`);
    } else {
      productUrls = plan.urls.slice(0, CANDIDATE_CAP);
      scan = { partial: reports.some(r => r.partial), limitHit: false, reason: '' };
      modeNote = plan.note;
    }
  }
  lock.extendDeadline(lock.job?.id, productUrls.length);
  if (scan.reason) status(scan.reason);
  status(modeNote);
  const candidates = productUrls.map(url => ({ id: url.match(/\/products\/([^/]+)\/?$/)?.[1] || '', url }));
  const known = recheck ? { known: [] } : await api('POST', { source: 'depop', candidates }, '', '/api/import/known');
  const planned = planKnownSkips(productUrls, known, { recheck: !!recheck });
  const todo = [];
  const remembered = [];
  const skipped = { 'non-footwear': 0, 'other-footwear': 0, uncertain: 0, unread: 0, already: planned.skipped.length, prior: planned.rejected.length };
  const notes = [scan.reason].filter(Boolean);
  let scanned = 0;
  let cursor = 0;
  for (; cursor < planned.open.length; cursor++) {
    if (todo.length >= importLimit(cap)) break;
    if (!scanWindowOpen(lock.job?.deadline)) { notes.push('Import stopped before another product page: the time limit was too close. Nothing further was read.'); break; }
    const productUrl = planned.open[cursor];
    const slug = productUrl.match(/\/products\/([^/]+)\/?$/)?.[1] || '';
    scanned += 1;
    try {
      const page = await inTab(productUrl, 2500, (id, site) => runCall(id, readDepopProduct, 'ISOLATED', [shop, Date.now() + 15000], 20000, site));
      const product = acceptScan(page, 'Depop');
      const item = validateItemEnvelope(product.items[0], { source: 'depop', expectedId: slug });
      if (!item) throw new Error(`Depop product ${slug} did not match the requested shop ${shop}. Nothing was written for it.`);
      const decision = westernBootDecision(item);
      if (!decision.eligible) {
        skipped[decision.kind] = (skipped[decision.kind] || 0) + 1;
        const reason = rejectToStore(decision);
        if (reason) remembered.push({ source_id: slug, source_url: productUrl, reason });
        notes.push(`${slug}: ${decision.reason}`);
        continue;
      }
      todo.push(item);
    } catch (e) { skipped.unread += 1; notes.push(`${slug || productUrl} not read: ${e.message}`); }
  }
  const unopened = planned.open.length - cursor;
  const partial = unopened > 0 || scan.partial === true;
  try { await rememberRejects(remembered); }
  catch (e) { notes.push(`Could not remember non-boots: ${e.message}`); }
  const summary = bootScanSummary({ scanned, candidates: productUrls.length, eligible: todo.length, unopened, skipped, writeCap: importLimit(cap), partial, limitHit: scan.limitHit === true });
  const present = presenceIds(planned.presentIds, todo.map(i => i.source_id));
  const scanLimit = scan.limitHit ? `Shop scroll hit its read limit before the grid settled (${productUrls.length} links queued). This may not be the whole shop.` : '';
  const counts = { added: 0, updated: 0, failed: skipped.unread, removed: 0, duplicate: skipped.already, prior: skipped.prior, opened: scanned, recheck: !!recheck, partial, scanLimit, modeNote, skipped: [summary, ...notes].filter(Boolean).join(' ') };
  if (!todo.length) {
    counts.summary = jobSummary(counts);
    return counts;
  }
  const result = await importAll({ source: 'depop', ids: present, sync, complete: false, todo,
    importOne: send, name: i => `"${(i.title || '').slice(0, 40)}"` });
  result.partial = partial || result.partial === true;
  result.recheck = !!recheck;
  result.duplicate = (result.duplicate || 0) + skipped.already;
  result.prior = skipped.prior;
  result.opened = scanned;
  result.scanLimit = scanLimit;
  result.modeNote = modeNote;
  result.skipped = [summary, result.skipped, ...notes].filter(Boolean).join(' ');
  result.failed = (result.failed || 0) + skipped.unread;
  result.summary = jobSummary(result);
  return result;
}

// A Facebook Marketplace profile or Depop shop link → the right importer.
async function importLink(link, sync, recheck, shopMode) {
  const fb = link?.match(/marketplace\/profile\/(\d+)/)?.[1], shop = link?.match(/depop\.com\/(?!products\/)([\w.-]+)/)?.[1];
  if (fb) return importFacebook(fb, sync);
  if (shop) {
    try { return await importDepop(shop, sync, recheck, shopMode); }
    catch (e) {
      const summary = jobSummary({ error: e.message || String(e) });
      return { added: 0, updated: 0, failed: 0, removed: 0, duplicate: 0, prior: 0, opened: 0, partial: true, summary, skipped: e.message || '' };
    }
  }
  throw new Error('That isn\'t a Facebook Marketplace profile or Depop shop link.');
}
const addCurrent = async (tabId, pageUrl) => {
  const expected = String(pageUrl || '').match(/\/item\/(\d+)/)?.[1] || '';
  if (!expected) throw new Error('The listing id could not be checked against the requested page. Nothing was imported.');
  const raw = await retry(() => runCall(tabId, readListing, 'ISOLATED', [], 15000, 'Facebook'));
  const item = validateItemEnvelope(raw, { source: 'facebook', expectedId: expected });
  if (!item) throw new Error(`This Facebook listing did not match the requested item ${expected}. Nothing was imported.`);
  return send(item);
};

// Every entry point (page, popup, right-click) takes the same lock and the same frozen seller.
async function runEntry(message) {
  if (message?.type === 'who') {
    if (message.server && !allowedBootlisterOrigin(message.server)) return { error: 'That address is not a BootLister site.' };
    const origin = await chooseOrigin(message);
    const token = origin ? await readAuthCookie(origin) : '';
    const gate = origin ? sessionFromCookie(origin, token) : { ok: false, error: SIGNED_OUT, signIn: `${BOOTLISTER_ORIGINS[0]}/login` };
    if (!gate.ok) return { error: gate.error, signIn: gate.signIn };
    const me = await whoAmI(origin, gate.token);
    if (!me) return { error: SIGNED_OUT, signIn: `${origin}/login` };
    let sellers = [];
    if (me.role === 'admin') {
      const r = await fetch(`${origin}/api/sellers`, { headers: sessionHeaders(gate.token), signal: AbortSignal.timeout(API_TIMEOUT_MS) });
      const body = await r.json().catch(() => ([]));
      if (!r.ok) return { error: body.error || 'Could not load sellers.' };
      sellers = Array.isArray(body) ? body : [];
    } else if (me.seller) sellers = [{ name: me.seller, display_name: me.seller }];
    return { ok: true, role: me.role, seller: me.seller || '', sellers, origin };
  }
  const snap = await snapshot(message || {});
  if (snap.error) return { error: snap.error, signIn: snap.signIn };
  const begun = lock.begin(snap);
  if (begun.error) return { error: begun.error };
  try {
    if (message?.type === 'link') {
      const r = await importLink(message.link, message.sync, message.recheck, message.shopMode);
      await status(done(r));
      return { r };
    }
    if (message?.type === 'listing' || message?.type === 'context') {
      const pageUrl = message.url || message.link || '';
      const link = message.type === 'context' && ITEM.test(message.link || '') ? message.link : '';
      if (message.type === 'context' && !link && !ITEM.test(pageUrl)) throw new Error('Open a Marketplace listing first.');
      if (message.type === 'listing' && !ITEM.test(pageUrl)) throw new Error('Open a Marketplace listing first.');
      return { r: await (link ? importListing(link) : addCurrent(message.tabId, pageUrl)) };
    }
    throw new Error('Unknown request.');
  } catch (e) {
    const line = jobSummary({ error: e.message || String(e) });
    await status(line);
    return { error: line };
  } finally {
    lock.end(begun.job.id);
    progress(null);
    badge('');
  }
}

chrome.runtime.onMessage.addListener((m, _, reply) => {
  runEntry(m).then(r => {
    if (r?.error) badge('!');
    // who is the session itself. Import results stay { r } or { error, signIn }.
    reply(m?.type === 'who' ? r : (r?.error ? { error: r.error, signIn: r.signIn } : { r: r?.r }));
  });
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

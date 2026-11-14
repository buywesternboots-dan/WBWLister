// Import orchestration that does not touch Chrome. The service worker freezes one job at a time.

// A shop import writes every eligible western boot unless the popup sets a smaller test limit.
// Nothing can raise the safety bound. The shop scan can look past the write limit so bags do not hide boots.
export const WRITE_CAP = 100;
export const CANDIDATE_CAP = 400;
export const SCAN_RESERVE_MS = 8000;
export const API_TIMEOUT_MS = 20000;
export const PAGE_BUDGET_MS = 12000;
// The shop grid is slow. Three minutes of 4s pauses stopped near 40 links.
// Eight minutes still leaves time in the 15-minute job to open new pages. The 400 link cap stays.
export const SHOP_READ_MS = 8 * 60 * 1000;
export const REJECT_BATCH = 100;
export const SHOP_MODE_BOOTS = 'Boots only (fast)';
export const SHOP_MODE_FULL = 'Full shop (slower, catches mis-categorized boots)';

// Depop's own shop filters. category, categories, subcategory, and sellerUsername are not used.
export function depopBootFilters(shop) {
  const path = `https://www.depop.com/${shop}/`;
  return [
    { id: 'female', label: 'Women', gender: 'female', url: `${path}?groups=footwear&gender=female&productTypes=boots` },
    { id: 'male', label: 'Men', gender: 'male', url: `${path}?groups=footwear&gender=male&productTypes=boots` },
    { id: 'boots', label: 'All boots', gender: '', url: `${path}?groups=footwear&productTypes=boots` },
  ];
}

const CARD_NON_FOOT = /\b(briefcases?|totes?|handbags?|purses?|backpacks?|wallets?|belts?|buckles?|hats?|shirts?|t-?shirts?|jackets?|dresses?|jeans|jewelry|necklaces?)\b/i;
const CARD_BOOT = /\b(boots?|booties|botas)\b/i;
const CARD_BOOT_MOD = /\bboots?[\s-]+(belts?|buckles?|bags?|hats?|bolos?)\b|\bboot(?:belts?|buckles?|bags?|hats?)\b/i;

// A lace-up or moto boot stays. A bag, or "boot" used for a buckle, means the boots filter did not stick.
export function cardIsNonFootwear(text) {
  const t = String(text || '');
  if (!t) return false;
  if (CARD_BOOT_MOD.test(t)) return true;
  if (CARD_BOOT.test(t)) return false;
  return CARD_NON_FOOT.test(t);
}

export function chipsShowBoots(chips, gender) {
  const text = (chips || []).join('\n');
  if (!/\bboots?\b/i.test(text)) return false;
  if (gender === 'female') return /\bwomen\b/i.test(text) || /\bfemale\b/i.test(text);
  if (gender === 'male') return /\bmen\b/i.test(text) || /\bmale\b/i.test(text);
  return /\bfootwear\b/i.test(text) || /\bboots?\b/i.test(text);
}

function paramsStuck(variant, href) {
  const url = String(href || '');
  if (!/[?&]groups=footwear\b/.test(url) || !/[?&]productTypes=boots\b/.test(url)) return false;
  if (variant.gender && !new RegExp(`[?&]gender=${variant.gender}\\b`).test(url)) return false;
  return true;
}

// Gender filters that do not stick fail the fast mode. The ungendered boots URL is skipped instead.
export function planFilteredShop(reports) {
  const keep = [];
  const notes = [];
  for (const report of reports || []) {
    const label = report.label || report.id || 'Filter';
    const badCard = (report.cardTexts || []).find(cardIsNonFootwear);
    if (badCard) {
      if (report.gender) return { ok: false, fallback: true, reason: `${label}: non-footwear on the filtered grid` };
      notes.push(`${label} skipped (non-footwear)`);
      continue;
    }
    // The live filter URL is enough. Missing chips only fail a gender grid when the params were dropped.
    if (paramsStuck(report, report.href)) {
      if (report.limitHit || report.capHit) notes.push(`${label} stopped early (${(report.urls || []).length} links)`);
      keep.push(report);
      continue;
    }
    if (!report.gender) { notes.push(`${label} skipped (no filter)`); continue; }
    const why = report.href ? 'filter params were dropped' : 'no chip';
    return { ok: false, fallback: true, reason: `${label}: ${why}` };
  }
  const women = keep.find(r => r.gender === 'female');
  const men = keep.find(r => r.gender === 'male');
  if (women && men && (women.urls || []).length && (women.urls || []).join('\n') === (men.urls || []).join('\n'))
    return { ok: false, fallback: true, reason: 'Women and Men returned the same count as each other, so the filter was not applied' };
  if (!keep.some(r => r.gender)) return { ok: false, fallback: true, reason: 'no filtered grid applied' };
  const seen = new Set();
  const urls = [];
  for (const report of keep) for (const url of report.urls || []) {
    if (!url || seen.has(url)) continue;
    seen.add(url);
    urls.push(url);
  }
  const counts = keep.map(r => {
    const got = (r.urls || []).length;
    const target = Number(r.resultCount) || 0;
    const pages = Number(r.pages) || 0;
    const pageNote = pages ? ` (${pages} ${pages === 1 ? 'page' : 'pages'})` : '';
    if (target > 0 && got < target) return `${r.label} ${got}/${target} short${pageNote}`;
    if (target > 0) return `${r.label} ${got}/${target}${pageNote}`;
    return `${r.label} ${got}${pageNote}`;
  }).join(', ');
  const extra = notes.length ? ` ${notes.join('. ')}.` : '';
  return { ok: true, urls, note: `${SHOP_MODE_BOOTS}. ${counts}.${extra}` };
}
export const JOB_DEADLINE_MAX_MS = 15 * 60 * 1000;

export function importLimit(value) {
  if (value == null || value === '') return WRITE_CAP;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) return WRITE_CAP;
  return Math.min(n, WRITE_CAP);
}

// After the shop count is known, the job may run long enough to open those pages, and no longer than the maximum.
export function scaledDeadline(started, count, now = Date.now()) {
  const n = Math.max(0, Math.min(CANDIDATE_CAP, Number(count) || 0));
  const span = Math.min(JOB_DEADLINE_MAX_MS, SHOP_READ_MS + 20000 + n * PAGE_BUDGET_MS);
  return Math.min(started + JOB_DEADLINE_MAX_MS, now + span);
}

// Checked in the worker immediately before a write. A past deadline or a full cap writes nothing.
export function gateWrite({ deadline, written, cap }) {
  const limit = importLimit(cap);
  if (!(typeof deadline === 'number' && deadline > Date.now()))
    return { ok: false, reason: 'Import stopped: the time limit for this run was reached. Nothing further was written, and sync did not remove listings.' };
  if ((written || 0) >= limit)
    return { ok: false, reason: `Import limit is ${limit} listing${limit === 1 ? '' : 's'} per run. Sync will not remove listings.` };
  return { ok: true };
}

// A product-page read needs time to finish. Near the job deadline, do not open another one.
export function scanWindowOpen(deadline, now = Date.now()) {
  return typeof deadline === 'number' && deadline - now > SCAN_RESERVE_MS;
}

export const BOOTLISTER_ORIGINS = Object.freeze([
  'https://bootlister.vercel.app',
  'https://wbw-lister.vercel.app',
]);
export const SIGNED_OUT = 'Sign in on BootLister in this browser, then try again. This extension does not have its own sign-in.';

export function allowedBootlisterOrigin(value) {
  try {
    const origin = new URL(value).origin;
    return BOOTLISTER_ORIGINS.includes(origin) ? origin : '';
  } catch { return ''; }
}

// Cookie reads stay on an allowed origin. A hostile page cannot point this at another site.
export function cookieReadUrl(origin) {
  const allowed = allowedBootlisterOrigin(origin);
  return allowed ? `${allowed}/` : '';
}

export function sessionFromCookie(origin, cookieValue) {
  const allowed = allowedBootlisterOrigin(origin);
  if (!allowed) return { ok: false, error: 'That address is not a BootLister site.' };
  const token = String(cookieValue || '').trim();
  if (!token) return { ok: false, error: SIGNED_OUT, signIn: `${allowed}/login` };
  return { ok: true, origin: allowed, token };
}

// Seller sessions stay on their own seller. The token string is copied for this job only.
export function actorForJob({ origin, token, role, ownSeller, requestedSeller }) {
  const server = allowedBootlisterOrigin(origin);
  if (!server) return { error: 'That address is not a BootLister site.' };
  const session = String(token || '').trim();
  if (!session) return { error: SIGNED_OUT, signIn: `${server}/login` };
  if (role === 'seller') {
    const seller = String(ownSeller || '').trim().toLowerCase();
    if (!seller) return { error: SIGNED_OUT, signIn: `${server}/login` };
    return { server, seller, token: session, tokenServer: server };
  }
  if (role === 'admin') {
    const seller = String(requestedSeller || '').trim().toLowerCase();
    if (!seller) return { error: 'Pick a seller first.' };
    return { server, seller, token: session, tokenServer: server };
  }
  return { error: SIGNED_OUT, signIn: `${server}/login` };
}

export function sameOrigin(saved, dest) {
  try { return !!saved && !!dest && new URL(saved).origin === new URL(dest).origin; }
  catch { return false; }
}

// The timer starts before `promise` settles. A script that never returns still hits `message`.
// Chrome drops the injection when Depop replaces the document mid-read.
export function injectionLost(error) {
  const message = String(error?.message || error || '');
  return /Frame with ID \d+ was removed|No frame|Receiving end does not exist/i.test(message);
}

// One retry. A different error is not tried again.
export async function retryInjection(run) {
  try { return await run(1); }
  catch (e) {
    if (!injectionLost(e)) throw e;
    return await run(2);
  }
}

// A filter read that still fails does not end the job. The full shop is next.
export function shopAfterFilterError(error) {
  return { fallback: true, reason: String(error?.message || error || 'filter read failed') };
}

// Counts stay on the line even when the job stops with an error.
export function jobSummary(n = {}) {
  const added = n.added || 0;
  const known = n.known ?? n.duplicate ?? 0;
  const prior = n.prior || 0;
  const opened = n.opened || 0;
  const failed = n.failed || 0;
  const mode = n.modeNote ? `${n.modeNote} ` : '';
  const word = n.error ? 'Stopped' : (n.partial ? 'Partial' : 'Done');
  let line = `${mode}${word}: ${added} new, ${known} already imported (skipped), ${prior} previously not boots (skipped), ${opened} opened, ${failed} failed.`;
  if (n.removed) line += ` ${n.removed} gone (now Pending sold).`;
  if (n.scanLimit) line += ` ${n.scanLimit}`;
  if (n.skipped) line += ` ${n.skipped}`;
  if (n.error) line += ` ${n.error}`;
  return line;
}

// Chrome JSON-clones executeScript args and rejects undefined.
export function scriptArgs(values) {
  const args = Array.isArray(values) ? values : [];
  const why = walk(args, 'args');
  if (why) throw new Error(`executeScript args are not serializable: ${why}`);
  return JSON.parse(JSON.stringify(args));
}
function walk(value, path) {
  if (value === undefined) return `${path} is undefined`;
  if (typeof value === 'function') return `${path} is a function`;
  if (typeof value === 'symbol') return `${path} is a symbol`;
  if (typeof value === 'bigint') return `${path} is a bigint`;
  if (value === null || typeof value !== 'object') return '';
  if (typeof Map !== 'undefined' && value instanceof Map) return `${path} is a Map`;
  if (typeof Set !== 'undefined' && value instanceof Set) return `${path} is a Set`;
  if (typeof Node !== 'undefined' && value instanceof Node) return `${path} is a DOM node`;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const found = walk(value[i], `${path}[${i}]`);
      if (found) return found;
    }
    return '';
  }
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return `${path} is not a plain object`;
  for (const key of Object.keys(value)) {
    const found = walk(value[key], `${path}.${key}`);
    if (found) return found;
  }
  return '';
}

export function shopReadArgs(shop, deadline, cap, allowEmpty) {
  return scriptArgs([String(shop || ''), Number(deadline) || 0, Number(cap) || 0, { allowEmpty: !!allowEmpty }]);
}

export function withDeadline(promise, ms, message) {
  let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), ms); });
  return Promise.race([
    Promise.resolve(promise).finally(() => clearTimeout(timer)),
    timeout,
  ]);
}

const depopId = url => {
  const m = String(url || '').match(/depop\.com\/products\/([^/?#]+)\/?$/i);
  return m ? decodeURIComponent(m[1]) : '';
};
const normUrl = url => {
  try {
    const u = new URL(String(url));
    return `${u.protocol}//${u.hostname.toLowerCase()}${u.pathname.replace(/\/+$/, '')}`;
  } catch { return ''; }
};

function indexRows(rows) {
  const stored = new Map();
  for (const row of rows || []) {
    const sourceId = String(row?.source_id || row?.id || '');
    if (!sourceId) continue;
    if (row?.id) stored.set(String(row.id), sourceId);
    const url = normUrl(row?.url || '');
    if (url) stored.set(url, sourceId);
  }
  return stored;
}

// Default: do not open a page already imported or already ruled out. Recheck opens every candidate.
// Rejected ids are not "present" listings, so a later sync cannot treat them as gone or kept.
export function planKnownSkips(productUrls, known, { recheck = false } = {}) {
  const urls = Array.isArray(productUrls) ? productUrls : [];
  if (recheck) return { open: urls.slice(), skipped: [], rejected: [], presentIds: [], recheck: true };
  const imported = indexRows(known?.known);
  const ruledOut = indexRows(known?.rejected);
  const open = [];
  const skipped = [];
  const rejected = [];
  const presentIds = [];
  for (const url of urls) {
    const id = depopId(url);
    const key = normUrl(url);
    const sourceId = imported.get(id) || imported.get(key);
    if (sourceId) { skipped.push(url); presentIds.push(sourceId); continue; }
    const rejectId = ruledOut.get(id) || ruledOut.get(key);
    if (rejectId) { rejected.push(url); continue; }
    open.push(url);
  }
  return { open, skipped, rejected, presentIds, recheck: false };
}

// Known listings stay in the seen set. A later sync must not treat a skipped page as gone.
export function presenceIds(knownIds, openedIds) {
  const out = [];
  const seen = new Set();
  for (const id of [...(knownIds || []), ...(openedIds || [])]) {
    const s = String(id || '');
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

export function absentIds(storedIds, seenIds) {
  const seen = new Set((seenIds || []).map(id => String(id)));
  return (storedIds || []).map(id => String(id)).filter(id => id && !seen.has(id));
}

// Sync removal deletes listings that were not in the scan. An uncertain scan must not do that.
export function planSync(syncRequested, complete, ids, capped = false) {
  if (!syncRequested) return { sync: false };
  // A smoke cap, an unproven Facebook scroll, or a missing page end all mean the absence list is not real.
  if (capped || complete !== true || !Array.isArray(ids))
    return { sync: false, skipped: 'Sync did not remove listings because the scan was incomplete. Nothing was marked sold.' };
  const seen = new Set();
  for (const id of ids) {
    if (seen.has(id)) return { sync: false, skipped: 'Sync did not remove listings because the scan had duplicate ids. Nothing was marked sold.' };
    seen.add(id);
  }
  return { sync: true, ids: [...seen] };
}

export function createImportLock() {
  let job = null;
  return {
    begin(request) {
      if (job) return { error: 'An import is already running — wait for it to finish.' };
      const server = String(request?.server || '').replace(/\/$/, '');
      const seller = String(request?.seller || '').trim().toLowerCase();
      if (!server) return { error: 'Set the BootLister address in the extension popup.' };
      if (!seller) return { error: 'Pick a seller first.' };
      const token = request?.token && sameOrigin(request.tokenServer || '', server) ? String(request.token) : '';
      const limit = importLimit(request?.limit);
      const started = Date.now();
      const maxDeadline = started + JOB_DEADLINE_MAX_MS;
      const requestedDeadline = Number(request?.deadline);
      const deadline = Number.isFinite(requestedDeadline) ? Math.min(requestedDeadline, maxDeadline) : maxDeadline;
      job = Object.freeze({ id: crypto.randomUUID(), server, seller, token, limit, deadline, started });
      return { job };
    },
    extendDeadline(id, count) {
      if (!job || job.id !== id) return;
      job = Object.freeze({ ...job, deadline: scaledDeadline(job.started, count) });
    },
    auth() {
      if (!job) throw new Error('No import is running.');
      const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${job.seller}` };
      if (job.token) headers['x-auth'] = job.token;
      return { server: job.server, seller: job.seller, headers };
    },
    end(id) { if (job && job.id === id) job = null; },
    get job() { return job; },
  };
}

const TEXT_LIMIT = { title: 300, description: 20000, brand: 80, size: 40, color: 80, material: 120, sized_for: 20, condition: 40, category: 200 };

// Worker-side check. A value shaped by the page is not trusted until it passes here.
export function validateItemEnvelope(item, { source, expectedId } = {}) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
  if (source !== 'facebook' && source !== 'depop') return null;
  if (item.source !== source) return null;
  const id = item.source_id;
  if (typeof id !== 'string' || !id || id.length > 200 || /\s/.test(id)) return null;
  if (expectedId && id !== expectedId) return null;
  const url = source === 'facebook'
    ? `https://www.facebook.com/marketplace/item/${id}/`
    : `https://www.depop.com/products/${id}/`;
  if (source === 'facebook' && !/^\d{5,20}$/.test(id)) return null;
  if (source === 'depop' && !/^[\w.-]+$/.test(id)) return null;
  if (item.source_url !== url) return null;
  if (typeof item.title !== 'string' || item.title.length < 1 || item.title.length > TEXT_LIMIT.title) return null;
  if (typeof item.description !== 'string' || item.description.length > TEXT_LIMIT.description) return null;
  if (!Array.isArray(item.photos) || item.photos.length < 1 || item.photos.length > 30) return null;
  if (!item.photos.every(p => typeof p === 'string' && p.length <= 2000 && /^https:\/\/\S+$/.test(p))) return null;
  for (const key of Object.keys(TEXT_LIMIT)) {
    if (key === 'title' || key === 'description') continue;
    const value = item[key];
    if (value == null || value === '') continue;
    if (typeof value !== 'string' && typeof value !== 'number') return null;
    if (String(value).length > TEXT_LIMIT[key]) return null;
  }
  if (!(item.price == null || item.price === '' || /^\d{1,8}(\.\d{1,2})?$/.test(String(item.price)))) return null;
  return item;
}

export function navListenerArmedBeforeTabCreate(source) {
  const start = source.indexOf('async function inTab');
  const end = source.indexOf('const importListing');
  if (start < 0 || end < start) return false;
  const body = source.slice(start, end);
  const listen = body.indexOf('armNavError(');
  const create = body.indexOf('chrome.tabs.create');
  return listen >= 0 && create > listen;
}

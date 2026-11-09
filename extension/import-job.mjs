// Import orchestration that does not touch Chrome. The service worker freezes one job at a time.

// Smoke runs stay tiny. A higher number in the popup cannot raise this.
export const SMOKE_CAP = 2;
export const API_TIMEOUT_MS = 20000;
export const JOB_TIMEOUT_MS = 120000;

export function smokeCap(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) return SMOKE_CAP;
  return Math.min(n, SMOKE_CAP);
}

// Checked in the worker immediately before a write. A past deadline or a full cap writes nothing.
export function gateWrite({ deadline, written, cap }) {
  const limit = smokeCap(cap);
  if (!(typeof deadline === 'number' && deadline > Date.now()))
    return { ok: false, reason: 'Import stopped: the time limit for this run was reached. Nothing further was written, and sync did not remove listings.' };
  if ((written || 0) >= limit)
    return { ok: false, reason: `Smoke test limit is ${limit} listing${limit === 1 ? '' : 's'} per run. Sync will not remove listings.` };
  return { ok: true };
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
export function withDeadline(promise, ms, message) {
  let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), ms); });
  return Promise.race([
    Promise.resolve(promise).finally(() => clearTimeout(timer)),
    timeout,
  ]);
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
      const limit = smokeCap(request?.limit);
      const maxDeadline = Date.now() + JOB_TIMEOUT_MS;
      const requestedDeadline = Number(request?.deadline);
      const deadline = Number.isFinite(requestedDeadline) ? Math.min(requestedDeadline, maxDeadline) : maxDeadline;
      job = Object.freeze({ id: crypto.randomUUID(), server, seller, token, limit, deadline });
      return { job };
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

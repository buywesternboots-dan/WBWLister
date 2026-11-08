// Import orchestration that does not touch Chrome. The service worker freezes one job at a time.

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
export function planSync(syncRequested, complete, ids) {
  if (!syncRequested) return { sync: false };
  if (complete !== true || !Array.isArray(ids))
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
  let seq = 0;
  return {
    begin(request) {
      if (job) return { error: 'An import is already running — wait for it to finish.' };
      const server = String(request?.server || '').replace(/\/$/, '');
      const seller = String(request?.seller || '').trim().toLowerCase();
      if (!server) return { error: 'Set the BootLister address in the extension popup.' };
      if (!seller) return { error: 'Pick a seller first.' };
      const token = request?.token && sameOrigin(request.tokenServer || '', server) ? String(request.token) : '';
      job = Object.freeze({ id: ++seq, server, seller, token });
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

export function navListenerArmedBeforeTabCreate(source) {
  const start = source.indexOf('async function inTab');
  const end = source.indexOf('const importListing');
  if (start < 0 || end < start) return false;
  const body = source.slice(start, end);
  const listen = body.indexOf('armNavError(');
  const create = body.indexOf('chrome.tabs.create');
  return listen >= 0 && create > listen;
}

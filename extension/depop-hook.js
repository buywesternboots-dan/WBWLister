// BootLister: runs in Depop's own page (MAIN world, document_start) and only records what the page itself asks
// webapi.depop.com for: shop product-list and aggregates URLs, the request init it used, and the ids/slugs/status
// plus page_info of each product-list page. Nothing is sent off the device; snapshots go to the extension's own
// content-script bridge through window.postMessage and are also readable at window.__bootlisterDepop.
// The wrapper returns Depop's original promise untouched and observes every rejection so it never adds errors.
(() => {
  if (window.__bootlisterDepop) return;
  const SHOP = /webapi\.depop\.com\/presentation\/api\/v1\/shops\/\d{3,}\/(products|aggregates)\//;
  const SOLD = /by-status\/sold/i;
  const store = { version: 2, urls: [], headers: {}, requests: [], pages: [], aggregates: [], errors: [], started: Date.now() };
  try { Object.defineProperty(window, '__bootlisterDepop', { value: store, configurable: false, enumerable: false, writable: false }); }
  catch { window.__bootlisterDepop = store; }
  const keepHeaders = h => {
    try {
      const out = {};
      const each = (k, v) => { const key = String(k).toLowerCase(); if (!/^(cookie|authorization|content-length|host)$/.test(key)) out[key] = String(v); };
      if (!h) return out;
      if (typeof h.forEach === 'function' && !Array.isArray(h)) h.forEach((v, k) => each(k, v));
      else if (Array.isArray(h)) for (const [k, v] of h) each(k, v);
      else for (const k of Object.keys(h)) each(k, h[k]);
      return out;
    } catch { return {}; }
  };
  const keepInit = (input, init) => {
    const pick = k => { try { return init?.[k] ?? input?.[k]; } catch { return undefined; } };
    const out = { method: String(pick('method') || 'GET').toUpperCase(), headers: keepHeaders(init?.headers || input?.headers) };
    for (const k of ['credentials', 'mode', 'cache', 'redirect', 'referrerPolicy']) {
      const v = pick(k);
      if (typeof v === 'string' && v) out[k] = v;
    }
    return out;
  };
  let timer = 0;
  const publish = () => {
    if (timer) return;
    timer = setTimeout(() => {
      timer = 0;
      try { window.postMessage({ bootlisterDepopSnapshot: true, snapshot: JSON.parse(JSON.stringify(store)) }, location.origin); }
      catch { /* never break the page */ }
    }, 0);
  };
  try { window.addEventListener('message', e => { if (e.source === window && e.origin === location.origin && e.data?.bootlisterDepopRequest) publish(); }); } catch { /* ignore */ }
  const note = (url, input, init) => {
    try {
      if (!SHOP.test(url) || SOLD.test(url)) return '';
      if (store.urls.length < 200 && !store.urls.includes(url)) store.urls.push(url);
      const kind = /\/aggregates\//.test(url) ? 'aggregates' : /\/products\/\?/.test(url) ? 'products' : '';
      if (kind === 'products') {
        const saved = keepInit(input, init);
        if (!Object.keys(store.headers).length) store.headers = saved.headers;
        if (store.requests.length < 100) store.requests.push({ url, init: saved, at: Date.now() });
      }
      return kind;
    } catch { return ''; }
  };
  const record = (kind, url, status, body) => {
    try {
      if (kind === 'aggregates') {
        if (store.aggregates.length < 50) store.aggregates.push({ url, status, at: Date.now(), total: body?.total ?? body?.count ?? null });
        publish();
        return;
      }
      const list = Array.isArray(body?.objects) ? body.objects : Array.isArray(body?.products) ? body.products : [];
      if (store.pages.length >= 100) return;
      store.pages.push({ url, status, at: Date.now(), page_info: body?.page_info || body?.meta || null,
        total: body?.total ?? body?.count ?? body?.meta?.total ?? body?.meta?.totalCount ?? null,
        items: list.slice(0, 200).map(p => ({ id: p?.id, slug: p?.slug, status: p?.status, user_id: p?.user_id ?? p?.userId })) });
      publish();
    } catch { /* never break the page */ }
  };
  const fail = (url, error) => {
    try { if (store.errors.length < 50) store.errors.push({ url, at: Date.now(), error: String(error?.message || error).slice(0, 160) }); } catch { /* ignore */ }
  };
  const origFetch = window.fetch;
  if (typeof origFetch === 'function') {
    window.fetch = function (input, init) {
      let url = '';
      try { url = typeof input === 'string' ? input : String(input?.url || input || ''); } catch { url = ''; }
      const kind = note(url, input, init);
      let p;
      try { p = origFetch.apply(this, arguments); }
      catch (e) { if (kind) fail(url, e); throw e; }
      try {
        // Depop's caller still gets p; these handlers only observe, including rejections.
        Promise.resolve(p).then(r => {
          if (!kind) return;
          try { Promise.resolve(r.clone().json()).then(b => record(kind, url, r.status, b), () => {}).catch(() => {}); } catch { /* clone failed */ }
        }, e => { if (kind) fail(url, e); }).catch(() => {});
      } catch { /* ignore */ }
      return p;
    };
  }
  const XHR = window.XMLHttpRequest;
  if (XHR?.prototype) {
    const open = XHR.prototype.open;
    XHR.prototype.open = function (method, url) {
      try {
        const u = String(url || '');
        const kind = note(u, null, { method });
        if (kind) this.addEventListener('load', () => { try { record(kind, u, this.status, JSON.parse(this.responseText)); } catch { /* ignore */ } });
      } catch { /* ignore */ }
      return open.apply(this, arguments);
    };
  }
})();

// BootLister: runs in Depop's own page (MAIN world, document_start) and only records what the page itself asks
// webapi.depop.com for: shop product-list and aggregates URLs, the headers it sent, and the ids/slugs in each
// product-list page. Nothing is sent anywhere; the extension reads window.__bootlisterDepop when it imports.
(() => {
  if (window.__bootlisterDepop) return;
  const SHOP = /webapi\.depop\.com\/presentation\/api\/v1\/shops\/\d{3,}\/(products|aggregates)\//;
  const SOLD = /by-status\/sold/i;
  const store = { urls: [], headers: {}, pages: [], started: Date.now() };
  Object.defineProperty(window, '__bootlisterDepop', { value: store, configurable: false, enumerable: false, writable: false });
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
  const note = (url, headers) => {
    if (!SHOP.test(url) || SOLD.test(url)) return false;
    if (store.urls.length < 200 && !store.urls.includes(url)) store.urls.push(url);
    if (/\/products\/\?/.test(url) && headers && !Object.keys(store.headers).length) store.headers = keepHeaders(headers);
    return /\/products\/\?/.test(url);
  };
  const record = (url, status, body) => {
    try {
      const list = Array.isArray(body?.objects) ? body.objects : Array.isArray(body?.products) ? body.products : [];
      if (store.pages.length >= 100) return;
      store.pages.push({ url, status, at: Date.now(), page_info: body?.page_info || body?.meta || null,
        items: list.slice(0, 200).map(p => ({ id: p?.id, slug: p?.slug, status: p?.status })) });
    } catch { /* never break the page */ }
  };
  const origFetch = window.fetch;
  if (typeof origFetch === 'function') {
    window.fetch = function (input, init) {
      const url = typeof input === 'string' ? input : String(input?.url || input || '');
      const watch = note(url, init?.headers || input?.headers);
      const p = origFetch.apply(this, arguments);
      if (watch) p.then(r => r.clone().json().then(b => record(url, r.status, b)).catch(() => {})).catch(() => {});
      return p;
    };
  }
  const XHR = window.XMLHttpRequest;
  if (XHR?.prototype) {
    const open = XHR.prototype.open;
    XHR.prototype.open = function (method, url) {
      try {
        const u = String(url || '');
        if (note(u, null)) this.addEventListener('load', () => { try { record(u, this.status, JSON.parse(this.responseText)); } catch { /* ignore */ } });
      } catch { /* ignore */ }
      return open.apply(this, arguments);
    };
  }
})();

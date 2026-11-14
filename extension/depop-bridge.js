// BootLister: isolated content script on depop.com. Keeps the latest snapshot that depop-hook.js (MAIN world)
// posted about Depop's own product-list responses, so the extension can read it without trusting page globals.
(() => {
  window.addEventListener('message', e => {
    try {
      if (e.source !== window || e.origin !== location.origin || !e.data?.bootlisterDepopSnapshot) return;
      const s = e.data.snapshot;
      if (!s || typeof s !== 'object' || !Array.isArray(s.pages)) return;
      window.__bootlisterDepopSnapshot = { pages: s.pages.slice(0, 100), aggregates: Array.isArray(s.aggregates) ? s.aggregates.slice(0, 50) : [],
        requests: Array.isArray(s.requests) ? s.requests.slice(0, 100) : [], errors: Array.isArray(s.errors) ? s.errors.slice(0, 50) : [], urls: Array.isArray(s.urls) ? s.urls.slice(0, 200) : [] };
    } catch { /* ignore */ }
  });
})();

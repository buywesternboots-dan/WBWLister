// Pure page-result handling for the extension. readDepopShop is injected into the shop page, so it
// cannot call anything defined outside its own body. The other exports run in the service worker.

export const NO_FACEBOOK_LISTINGS = 'No listings found on this profile. If Facebook showed a login or checkpoint instead of the listings, sign in to Facebook in this same Chrome profile and try again. Nothing was imported.';

export function pageScriptEmpty(site) {
  return `${site} didn't return a result from the page, so nothing was imported. The extension got an empty result instead of a listing list. Reload the extension at chrome://extensions and try again. If the opened tab is a login wall or an error page, the import can't continue until that page loads normally.`;
}

// The injected script writes JSON { ok, value } or { ok:false, error }. A null result used to throw
// "Cannot read properties of null (reading 'length')" and import nothing.
export function requirePagePayload(raw, site) {
  if (raw == null || raw === '') throw new Error(pageScriptEmpty(site));
  let data;
  try { data = JSON.parse(raw); }
  catch { throw new Error(`${site} returned a result the extension couldn't read. Nothing was imported.`); }
  if (!data || data.ok !== true) throw new Error(data?.error || pageScriptEmpty(site));
  if (!Array.isArray(data.value)) throw new Error(`${site} didn't return a listing list. Nothing was imported.`);
  return data.value;
}

// Chrome's "Frame with ID 0 is showing error page" means the tab is an error page, not a shop.
// Report the browser's own network error when we have it. Do not claim the import can get past it.
export function explainPageFailure({ site = 'The page', message = '', tabUrl = '', pageUrl = '', netError = '', title = '' } = {}) {
  if (/didn't load, so no listings were read/.test(message)) return '';
  const tooMany = /ERR_TOO_MANY_REDIRECTS/i.test(netError) || /ERR_TOO_MANY_REDIRECTS/i.test(message);
  const frame = /showing error page/i.test(message);
  const chromeError = /^chrome-error:/i.test(tabUrl);
  const titleError = /isn.?t working/i.test(title || '');
  const navFailed = /^net::ERR_/i.test(netError);
  if (!tooMany && !frame && !chromeError && !titleError && !navFailed) return '';
  let detail;
  if (tooMany) detail = 'Chrome reported ERR_TOO_MANY_REDIRECTS (the site redirected you too many times).';
  else if (navFailed) detail = `Chrome reported ${String(netError).replace(/^net::/, '')}.`;
  else detail = 'Chrome showed an error page instead of the site. A redirect loop looks like this when the site keeps bouncing the tab until Chrome gives up.';
  const link = pageUrl ? ` Open ${pageUrl} in this same Chrome profile and confirm it loads.` : ' Open the same link in this same Chrome profile and confirm it loads.';
  return `${site} didn't load, so no listings were read. ${detail}${link} BootLister can't bypass that redirect or checkpoint. This extension will not clear cookies. Nothing was imported.`;
}

// Runs inside a Depop shop page (page context, so Depop's own listing feed answers). Writes the result
// onto the DOM because the service worker cannot rely on an async injected function's return value.
export async function readDepopShop(key) {
  const finish = payload => {
    const el = document.createElement('script');
    el.type = 'application/json';
    el.id = key;
    el.textContent = JSON.stringify(payload);
    document.documentElement.appendChild(el);
  };
  try {
    const id = performance.getEntriesByType('resource').map(e => String(e.name).match(/\/shops\/(\d+)\/products/)?.[1]).find(Boolean);
    if (!id) throw new Error('Could not find the shop on this page — is it a Depop shop link?');
    const all = [];
    let after = '';
    const seen = new Set();
    let ended = false;
    for (let page = 0; page < 80; page++) {
      const url = `https://webapi.depop.com/presentation/api/v1/shops/${id}/products/?limit=24${after ? `&after=${encodeURIComponent(after)}` : ''}`;
      const r = await fetch(url);
      if (!r.ok) throw new Error(`Depop's shop feed answered HTTP ${r.status}. Nothing was imported.`);
      let j;
      try { j = await r.json(); }
      catch { throw new Error("Depop's shop feed wasn't a listing list. Nothing was imported."); }
      if (!j || !Array.isArray(j.objects)) throw new Error("Depop's shop feed had no listing list. Nothing was imported.");
      all.push(...j.objects);
      if (!j.page_info?.has_more) { ended = true; break; }
      const next = j.page_info.last;
      if (typeof next !== 'string' || !next || seen.has(next)) throw new Error("Depop's shop feed said there were more listings but didn't give a next page. Nothing further was read.");
      seen.add(next);
      after = next;
      await new Promise(res => setTimeout(res, 500));
    }
    if (!ended) throw new Error("Depop's shop feed kept paging without an end. Nothing further was read.");
    const cap = s => (typeof s === 'string' && s) ? s[0].toUpperCase() + s.slice(1) : null;
    const items = all.filter(o => o && o.status === 'STATUS_ONSALE').map(o => {
      const a = o.attributes ?? {}, pr = o.pricing ?? {}, desc = typeof o.description === 'string' ? o.description : '';
      const photos = [];
      for (const p of Array.isArray(o.pictures) ? o.pictures : []) {
        const formats = p?.formats && typeof p.formats === 'object' ? Object.values(p.formats).filter(f => f && f.url) : [];
        if (!formats.length) continue;
        formats.sort((x, y) => (Number(y.width) || 0) - (Number(x.width) || 0));
        photos.push(formats[0].url);
      }
      return {
        source: 'depop', source_id: o.slug, source_url: `https://www.depop.com/products/${o.slug}/`,
        title: desc.split('\n')[0].trim().slice(0, 120),
        description: desc,
        price: pr[pr.final_price_key]?.price_breakdown?.price?.amount ?? pr.display_price?.headline_price?.amount ?? null,
        brand: a.brand === 'unbranded' ? 'Unbranded' : o.brand_name && o.brand_name !== 'Other' ? o.brand_name : null,
        size: o.sizes?.[0]?.name ?? null,
        sized_for: a.is_kids ? 'Kids' : a.gender === 'female' ? 'Women' : a.gender === 'male' ? 'Men' : null,
        condition: a.condition === 'brand_new' ? 'New' : 'Used',
        color: cap(Array.isArray(a.colour) ? a.colour[0] : null),
        category: [o.category_name, a.product_type, ...(Array.isArray(a.style) ? a.style : [])].filter(Boolean).join(' '),
        photos,
      };
    });
    finish({ ok: true, value: items });
  } catch (e) {
    finish({ ok: false, error: e?.message || String(e) });
  }
}

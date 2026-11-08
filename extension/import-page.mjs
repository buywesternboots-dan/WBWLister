// Page readers and result checks. readDepopShop and collectIds are injected into the tab, so each
// one is self-contained. They return a result object. The page DOM is not a result channel: a node
// the page can write is not proof of what the extension read. A null script result is rejected
// before any .length read. This file does not claim why a script result was null.

export const NO_FACEBOOK_LISTINGS = 'No listings found on this profile. If Facebook showed a login or checkpoint instead of the listings, sign in to Facebook in this same Chrome profile and try again. Nothing was imported.';

export function pageScriptEmpty(site) {
  return `${site} didn't return a result from the page, so nothing was imported. The extension got an empty result instead of a listing list. Reload the extension at chrome://extensions and try again. If the opened tab is a login wall or an error page, the import can't continue until that page loads normally.`;
}

// raw is the executeScript return value. Null used to crash on .length. Missing `complete` is not a finished scan.
export function acceptScan(raw, site) {
  if (raw == null || raw === '') throw new Error(pageScriptEmpty(site));
  let data = raw;
  if (typeof raw === 'string') {
    try { data = JSON.parse(raw); }
    catch { throw new Error(`${site} returned a result the extension couldn't read. Nothing was imported.`); }
  }
  if (!data || typeof data !== 'object' || data.ok !== true) throw new Error(data?.error || pageScriptEmpty(site));
  if (!Array.isArray(data.value)) throw new Error(`${site} didn't return a listing list. Nothing was imported.`);
  return { items: data.value, complete: data.complete === true, reason: typeof data.reason === 'string' ? data.reason : '' };
}

export function validateFacebookListing(item) {
  if (!item || typeof item !== 'object') return null;
  if (!/^\d{5,20}$/.test(String(item.source_id || ''))) return null;
  const url = `https://www.facebook.com/marketplace/item/${item.source_id}/`;
  if (item.source !== 'facebook' || item.source_url !== url) return null;
  if (typeof item.title !== 'string' || item.title.length > 300) return null;
  if (typeof item.description !== 'string' || item.description.length > 20000) return null;
  if (!Array.isArray(item.photos) || item.photos.length < 1 || item.photos.length > 30) return null;
  if (!item.photos.every(p => typeof p === 'string' && p.length > 0 && p.length <= 2000 && /^https:\/\//.test(p))) return null;
  for (const k of ['condition', 'brand', 'size', 'color', 'material', 'sized_for', 'price']) {
    const v = item[k];
    if (v == null) continue;
    if (typeof v !== 'string' && typeof v !== 'number') return null;
    if (String(v).length > 20000) return null;
  }
  return item;
}

// Report Chrome's own network error when the navigation listener recorded one. Without that code,
// the exact error stays unknown. Naming it does not make Facebook or Depop load.
export function explainPageFailure({ site = 'The page', message = '', tabUrl = '', pageUrl = '', netError = '', title = '' } = {}) {
  if (/didn't load, so no listings were read/.test(message)) return '';
  const tooMany = /ERR_TOO_MANY_REDIRECTS/i.test(netError) || /ERR_TOO_MANY_REDIRECTS/i.test(message);
  const frame = /showing error page/i.test(message);
  const chromeError = /^chrome-error:/i.test(tabUrl);
  const titleError = /isn.?t working/i.test(title || '');
  const navFailed = /^net::ERR_/i.test(netError);
  if (!tooMany && !frame && !chromeError && !titleError && !navFailed) return '';
  let detail;
  if (tooMany) detail = 'Chrome reported ERR_TOO_MANY_REDIRECTS (the site redirected you too many times). Reporting that error does not fix access and does not make the page load.';
  else if (navFailed) detail = `Chrome reported ${String(netError).replace(/^net::/, '')}. Reporting that error does not fix access.`;
  else detail = 'Chrome showed an error page instead of the site. The exact network error is unknown. This does not fix Facebook or Depop access.';
  const link = pageUrl ? ` Open ${pageUrl} in this same Chrome profile and confirm it loads.` : ' Open the same link in this same Chrome profile and confirm it loads.';
  return `${site} didn't load, so no listings were read. ${detail}${link} BootLister can't bypass that redirect or checkpoint. This extension will not clear cookies. Nothing was imported.`;
}

// Runs in the Depop shop page. deadlineMs is an absolute time. Fetch is aborted when it passes.
// Helpers stay inside this function so the injected copy does not depend on the module.
export async function readDepopShop(shop, deadlineMs) {
  const fail = error => ({ ok: false, complete: false, error });
  const cap = s => (typeof s === 'string' && s) ? s[0].toUpperCase() + s.slice(1) : null;
  const depopItem = o => {
    const a = o.attributes && typeof o.attributes === 'object' ? o.attributes : {};
    const pr = o.pricing && typeof o.pricing === 'object' ? o.pricing : {};
    const desc = typeof o.description === 'string' ? o.description : '';
    if (desc.length > 20000 || typeof o.slug !== 'string' || o.slug.length > 200 || o.slug !== o.slug.trim()) return null;
    const pics = Array.isArray(o.pictures) ? o.pictures : [];
    if (pics.length > 30) return null;
    const photos = [];
    for (const p of pics) {
      const formats = p?.formats && typeof p.formats === 'object' ? Object.values(p.formats).filter(f => f && typeof f.url === 'string') : [];
      if (!formats.length) continue;
      formats.sort((x, y) => (Number(y.width) || 0) - (Number(x.width) || 0));
      const url = formats[0].url;
      if (!/^https:\/\/\S+$/.test(url) || url.length > 2000) return null;
      photos.push(url);
    }
    if (!photos.length) return null;
    const price = pr[pr.final_price_key]?.price_breakdown?.price?.amount ?? pr.display_price?.headline_price?.amount ?? null;
    if (!(price == null || (typeof price === 'string' && /^\d{1,8}(\.\d{1,2})?$/.test(price)))) return null;
    const size = o.sizes?.[0]?.name ?? null;
    if (!(size == null || (typeof size === 'string' && size.length <= 40))) return null;
    const brand = a.brand === 'unbranded' ? 'Unbranded' : (typeof o.brand_name === 'string' && o.brand_name && o.brand_name !== 'Other' ? o.brand_name : null);
    if (!(brand == null || brand.length <= 80)) return null;
    return {
      source: 'depop', source_id: o.slug, source_url: `https://www.depop.com/products/${o.slug}/`,
      title: desc.split('\n')[0].trim().slice(0, 120), description: desc, price, brand, size,
      sized_for: a.is_kids ? 'Kids' : a.gender === 'female' ? 'Women' : a.gender === 'male' ? 'Men' : null,
      condition: a.condition === 'brand_new' ? 'New' : 'Used',
      color: cap(Array.isArray(a.colour) ? a.colour[0] : null),
      category: [o.category_name, a.product_type, ...(Array.isArray(a.style) ? a.style : [])].filter(x => typeof x === 'string').join(' ').slice(0, 200),
      photos,
    };
  };
  try {
    if (!/^[\w.-]+$/.test(shop || '') || shop === 'products') return fail('That is not a Depop shop link. Nothing was imported.');
    const host = String(location.hostname || '').replace(/^www\./, '');
    const path = String(location.pathname || '');
    if (host !== 'depop.com' || (path !== `/${shop}` && path !== `/${shop}/`))
      return fail(`This tab is not the requested Depop shop ${shop}. Nothing was imported.`);
    const ids = [];
    for (const e of performance.getEntriesByType('resource')) {
      const id = String(e.name).match(/\/shops\/(\d+)\/products/)?.[1];
      if (id && !ids.includes(id)) ids.push(id);
    }
    if (ids.length !== 1) return fail(ids.length ? 'More than one Depop shop id was on this page. Nothing was imported.' : 'Could not find the shop on this page — is it a Depop shop link?');
    if (!(deadlineMs > Date.now())) return fail('Depop shop read timed out before the feed was requested. Nothing was imported.');
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), Math.max(0, deadlineMs - Date.now()));
    const owned = slug => slug === shop || String(slug || '').startsWith(`${shop}-`);
    const all = [];
    let after = '';
    const cursors = new Set();
    let explicitEnd = false;
    let incomplete = false;
    let reason = '';
    const note = why => { incomplete = true; if (!reason) reason = why; };
    try {
      for (let page = 0; page < 80; page++) {
        if (ctrl.signal.aborted || Date.now() >= deadlineMs) return fail('Depop shop read timed out. Nothing was imported.');
        const url = `https://webapi.depop.com/presentation/api/v1/shops/${ids[0]}/products/?limit=24${after ? `&after=${encodeURIComponent(after)}` : ''}`;
        let r;
        try { r = await fetch(url, { signal: ctrl.signal }); }
        catch (e) {
          if (e?.name === 'AbortError' || ctrl.signal.aborted) return fail('Depop shop read timed out. Nothing was imported.');
          return fail("Depop's shop feed could not be read. Nothing was imported.");
        }
        if (!r.ok) return fail(`Depop's shop feed answered HTTP ${r.status}. Nothing was imported.`);
        let j;
        try { j = await r.json(); }
        catch { return fail("Depop's shop feed wasn't a listing list. Nothing was imported."); }
        if (!j || !Array.isArray(j.objects)) return fail("Depop's shop feed had no listing list. Nothing was imported.");
        for (const o of j.objects) {
          if (!o || o.status !== 'STATUS_ONSALE') continue;
          if (!owned(o.slug)) return fail(`A Depop listing did not belong to the requested shop ${shop}. Nothing was imported.`);
          all.push(o);
        }
        const info = j.page_info;
        if (!info || typeof info.has_more !== 'boolean') {
          note("Depop's shop feed did not say whether more listings exist. Sync will not remove listings.");
          break;
        }
        if (!info.has_more) { explicitEnd = true; break; }
        const next = info.last;
        if (typeof next !== 'string' || !next || next.length > 500 || cursors.has(next))
          return fail("Depop's shop feed said there were more listings but didn't give a next page. Nothing was imported.");
        cursors.add(next);
        after = next;
        await new Promise(res => setTimeout(res, 500));
      }
      if (!explicitEnd) note("Depop's shop feed did not say whether more listings exist. Sync will not remove listings.");
    } finally { clearTimeout(timer); }
    const seen = new Set();
    const value = [];
    for (const o of all) {
      if (seen.has(o.slug)) { note('Depop returned duplicate listing ids. Sync will not remove listings.'); continue; }
      seen.add(o.slug);
      const item = depopItem(o);
      if (!item) { note('A Depop listing failed validation. Sync will not remove listings.'); continue; }
      if (value.length >= 400) { note('Depop returned more listings than this import will store. Sync will not remove listings.'); break; }
      value.push(item);
    }
    if (!value.length) note('Depop returned no listings that matched the requested shop. Sync will not remove listings.');
    return { ok: true, value, complete: explicitEnd && !incomplete && value.length > 0, ...(reason ? { reason } : {}) };
  } catch (e) {
    return fail(e?.message || 'Depop shop read failed. Nothing was imported.');
  }
}

// Runs in the Facebook profile tab. Only the profile dialog is read. No dialog means no scan.
export async function collectIds(profileId, deadlineMs, stepMs = 1500) {
  const fail = error => ({ ok: false, complete: false, error });
  if (!/^\d{5,20}$/.test(String(profileId || ''))) return fail('That is not a Facebook Marketplace profile. Nothing was imported.');
  const path = String(location.pathname || '');
  if (!path.includes(`/marketplace/profile/${profileId}`)) return fail('This tab is not the requested Facebook profile. Nothing was imported.');
  const dialog = document.querySelector('[role="dialog"]');
  if (!dialog || typeof dialog.querySelectorAll !== 'function')
    return fail('Facebook did not show this profile dialog, so the general Marketplace feed was not scanned. Nothing was imported.');
  const links = () => [...dialog.querySelectorAll('a[href*="/marketplace/item/"]')];
  const ids = () => [...new Set(links().map(a => String(a.href || '').match(/\/item\/(\d{5,20})/)?.[1]).filter(Boolean))];
  if (!links().length) return { ok: true, value: [], complete: false, reason: 'Facebook did not show listings in this profile dialog. Sync will not remove listings.' };
  let stoppedEarly = false;
  let k = 0;
  for (let n = 0, same = 0; same < 3 && k < 40;) {
    if (!(deadlineMs > Date.now())) { stoppedEarly = true; break; }
    const last = links().at(-1);
    if (last && typeof last.scrollIntoView === 'function') last.scrollIntoView({ block: 'end' });
    await new Promise(r => setTimeout(r, stepMs));
    const c = ids().length;
    same = c === n ? same + 1 : 0;
    n = c;
    k += 1;
    if (k >= 40 && same < 3) stoppedEarly = true;
  }
  const value = ids();
  return { ok: true, value, complete: !stoppedEarly && value.length > 0 };
}

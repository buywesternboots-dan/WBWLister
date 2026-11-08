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
  const productUrls = Array.isArray(data.productUrls) ? data.productUrls.filter(u => typeof u === 'string') : [];
  return { items: data.value, productUrls, complete: data.complete === true, reason: typeof data.reason === 'string' ? data.reason : '' };
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

// A Depop profile link is exactly one path segment on depop.com.
// Observed seller link: https://www.depop.com/nuclear_nostalgia/?brandIds=1667&productId=988597946
// The product slug nuclear_postalgia-... is a different string and is not this handle.
export function depopSellerHandle(href) {
  let u;
  try { u = new URL(href, 'https://www.depop.com'); }
  catch { return ''; }
  if (u.hostname.replace(/^www\./, '') !== 'depop.com') return '';
  const parts = u.pathname.split('/').filter(Boolean);
  if (parts.length !== 1 || parts[0] === 'products' || !/^[\w.-]+$/.test(parts[0])) return '';
  return parts[0];
}

// Runs in the Depop shop page. Product links are collected only. The slug is not the account,
// and this does not call Depop's product feed.
export async function readDepopShop(shop, deadlineMs, cap = 2) {
  const fail = error => ({ ok: false, complete: false, error });
  const limit = Number.isInteger(cap) && cap >= 1 ? Math.min(cap, 2) : 2;
  try {
    if (!/^[\w.-]+$/.test(shop || '') || shop === 'products') return fail('That is not a Depop shop link. Nothing was imported.');
    const host = String(location.hostname || '').replace(/^www\./, '');
    const path = String(location.pathname || '');
    if (host !== 'depop.com' || (path !== `/${shop}` && path !== `/${shop}/`))
      return fail(`This tab is not the requested Depop shop ${shop}. Nothing was imported.`);
    if (!(deadlineMs > Date.now())) return fail('Depop shop read timed out before the page was read. Nothing was imported.');
    const productUrls = [];
    const seen = new Set();
    for (const a of document.querySelectorAll('a[href*="/products/"]')) {
      let slug = '';
      try {
        const u = new URL(a.href, location.href);
        if (u.hostname.replace(/^www\./, '') !== 'depop.com') continue;
        slug = u.pathname.match(/^\/products\/([^/]+)\/?$/)?.[1] || '';
      } catch { continue; }
      if (!slug || seen.has(slug)) continue;
      seen.add(slug);
      productUrls.push(`https://www.depop.com/products/${slug}/`);
      if (productUrls.length >= limit) break;
    }
    return {
      ok: true, complete: false, value: [], productUrls,
      reason: `The shop page is ${shop}. A product slug is not that account, so nothing on this page was written. A product is kept only when its page shows a seller link to ${shop}. Sync will not remove listings.`,
    };
  } catch (e) {
    return fail(e?.message || 'Depop shop read failed. Nothing was imported.');
  }
}

// Runs on one Depop product page. The seller link must be the requested shop.
// The product slug is the listing id only.
export async function readDepopProduct(shop, deadlineMs) {
  const fail = error => ({ ok: false, complete: false, error });
  const sellerHandle = href => {
    let u;
    try { u = new URL(href, location.href); }
    catch { return ''; }
    if (u.hostname.replace(/^www\./, '') !== 'depop.com') return '';
    const parts = u.pathname.split('/').filter(Boolean);
    if (parts.length !== 1 || parts[0] === 'products' || !/^[\w.-]+$/.test(parts[0])) return '';
    return parts[0];
  };
  try {
    if (!(deadlineMs > Date.now())) return fail('Depop product read timed out. Nothing was imported.');
    if (String(location.hostname || '').replace(/^www\./, '') !== 'depop.com')
      return fail('This tab is not a Depop product page. Nothing was imported.');
    const slug = String(location.pathname || '').match(/^\/products\/([^/]+)\/?$/)?.[1] || '';
    if (!slug) return fail('This tab is not a Depop product page. Nothing was imported.');
    let sellerHref = '';
    for (const a of document.querySelectorAll('a[href]')) {
      if (sellerHandle(a.href) === shop) { sellerHref = a.href; break; }
    }
    if (!sellerHref)
      return fail(`This Depop product does not show a seller link to ${shop}. Account binding is unresolved. Nothing was imported.`);
    // The seller link is the account. The slug is only the listing id.
    // Heading, description, and gallery were visible as text on the observed page, but their elements were not identified.
    return fail(`Seller link matches ${shop}. Product slug ${slug} is only the listing id, not the account. The heading, description, and gallery elements were not identified, so nothing was written.`);
  } catch (e) {
    return fail(e?.message || 'Depop product read failed. Nothing was imported.');
  }
}

export async function collectIds(profileId, deadlineMs, stepMs = 1500, cap = 2) {
  const fail = error => ({ ok: false, complete: false, error });
  if (!/^\d{5,20}$/.test(String(profileId || ''))) return fail('That is not a Facebook Marketplace profile. Nothing was imported.');
  const path = String(location.pathname || '');
  if (!path.includes(`/marketplace/profile/${profileId}`)) return fail('This tab is not the requested Facebook profile. Nothing was imported.');
  const dialog = document.querySelector('[role="dialog"]');
  if (!dialog || typeof dialog.querySelectorAll !== 'function')
    return fail('Facebook did not show this profile dialog, so the general Marketplace feed was not scanned. Nothing was imported.');
  const links = () => [...dialog.querySelectorAll('a[href*="/marketplace/item/"]')];
  const ids = () => [...new Set(links().map(a => String(a.href || '').match(/\/item\/(\d{5,20})/)?.[1]).filter(Boolean))];
  const limit = Number.isInteger(cap) && cap >= 1 ? Math.min(cap, 2) : 2;
  const unproven = 'Facebook scrolling stopped, but that does not prove every listing was seen. Sync will not remove listings.';
  if (!links().length) return { ok: true, value: [], complete: false, reason: 'Facebook did not show listings in this profile dialog. Sync will not remove listings.' };
  if (ids().length >= limit) return { ok: true, value: ids().slice(0, limit), complete: false, reason: unproven };
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
  const value = ids().slice(0, limit);
  return { ok: true, value, complete: false, reason: unproven };
}

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
  const strings = key => Array.isArray(data[key]) ? data[key].filter(s => typeof s === 'string') : [];
  return {
    items: data.value, productUrls, complete: data.complete === true, partial: data.partial === true,
    reason: typeof data.reason === 'string' ? data.reason : '',
    chips: strings('chips'), cardTexts: strings('cardTexts'), pageUrl: typeof data.pageUrl === 'string' ? data.pageUrl : '',
    limitHit: data.limitHit === true, capHit: data.capHit === true,
    resultCount: Number(data.resultCount) > 0 ? Number(data.resultCount) : 0,
    short: data.short === true,
  };
}

// The number Depop shows for a filtered grid, such as "49 results". Prices, followers, and sold counts are not it.
export function parseDepopResultCount(text) {
  const t = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!t || t.length > 80 || /\$\s*\d/.test(t) || /\bsold\b/i.test(t) || /\bfollowers?\b/i.test(t)) return 0;
  const num = '(\\d{1,3}(?:[,. ]\\d{3})+|\\d{1,5})';
  const m = t.match(new RegExp('\\b' + num + '\\s+results?\\b', 'i'))
    || t.match(new RegExp('\\bresults?\\s*[:\\-]?\\s*' + num + '\\b', 'i'))
    || t.match(new RegExp('\\b' + num + '\\s+items?\\b', 'i'))
    || t.match(new RegExp('\\bshowing\\s+' + num + '\\b', 'i'));
  const n = m ? Number(String(m[1]).replace(/[,. ]/g, '')) : 0;
  return n > 0 && n <= 10000 ? n : 0;
}

// Depop shop grids arrive 24 at a time. An exact page is not proof the grid is finished.
export function quietScrollsNeeded(count, settle = 5) {
  const base = Number.isInteger(settle) && settle >= 1 ? settle : 5;
  const n = Number(count) || 0;
  return n > 0 && n % 24 === 0 ? base + 2 : base;
}

// An accepted scan with no product links is not a finished import. Callers must not report "0 new".
export function rejectEmptyDepopShop(scan, shop) {
  const urls = (scan?.productUrls || []).filter(u => typeof u === 'string' && /^https:\/\/www\.depop\.com\/products\/[^/]+\/$/.test(u)).slice(0, 400);
  if (urls.length) return urls;
  const why = typeof scan?.reason === 'string' && scan.reason ? scan.reason : `Depop shop ${shop} produced no candidate listings.`;
  throw new Error(/Nothing was imported/.test(why) ? why : `${why} Nothing was imported.`);
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

// Runs in the Depop shop tab. Listing anchors are counted in the light DOM and in open shadow
// roots. The scan cap is how many links to queue, not how many to write. Zero candidates is an
// incomplete read, not an empty import. No Depop feed API.
export async function readDepopShop(shop, deadlineMs, cap = 400, pace) {
  const fail = error => ({ ok: false, complete: false, error });
  const limit = Number.isInteger(cap) && cap >= 1 ? Math.min(cap, 400) : 400;
  const pauseMs = Number.isInteger(pace?.pauseMs) && pace.pauseMs >= 0 ? pace.pauseMs : 4000;
  const settle = Number.isInteger(pace?.settle) && pace.settle >= 1 ? pace.settle : 5;
  const clip = (s, n) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
  try {
    if (!/^[\w.-]+$/.test(shop || '') || shop === 'products') return fail('That is not a Depop shop link. Nothing was imported.');
    const onShop = () => {
      const host = String(location.hostname || '').replace(/^www\./, '');
      const path = String(location.pathname || '');
      return host === 'depop.com' && (path === `/${shop}` || path === `/${shop}/`);
    };
    if (!onShop()) return fail(`This tab is not the requested Depop shop ${shop} (${clip(location.href, 180) || 'no url'}). Nothing was imported.`);
    const listedBy = `item listed by ${shop}`;
    const soldHeading = () => {
      const heads = document.querySelectorAll?.('h1, h2, h3, h4, h5, h6, [role="heading"]') || [];
      for (const h of heads) {
        if (/^sold items$/i.test(String(h.textContent || '').replace(/\s+/g, ' ').trim())) return h;
      }
      return null;
    };
    const inSold = (node, heading) => {
      for (let n = node; n; n = n.parentElement) {
        if (/^sold items$/i.test(String(n.getAttribute?.('aria-label') || '').trim())) return true;
      }
      return !!(heading && typeof heading.compareDocumentPosition === 'function' && (heading.compareDocumentPosition(node) & 4) === 4);
    };
    const collect = () => {
      const bag = { anchors: [], shadows: 0 };
      const walk = (root, depth) => {
        if (!root || typeof root.querySelectorAll !== 'function' || depth > 4) return;
        for (const a of root.querySelectorAll('a[href*="/products/"]')) bag.anchors.push(a);
        for (const el of root.querySelectorAll('*')) {
          if (!el || !el.shadowRoot) continue;
          bag.shadows += 1;
          walk(el.shadowRoot, depth + 1);
        }
      };
      walk(document, 0);
      const heading = soldHeading();
      const productUrls = [];
      const seen = new Set();
      const samples = [];
      let exact = 0;
      let otherListed = 0;
      let soldLinks = 0;
      let last = null;
      for (const a of bag.anchors) {
        if (inSold(a, heading)) { soldLinks += 1; continue; }
        const label = String(a.getAttribute?.('aria-label') || '');
        const shown = clip(label, 80);
        if (shown && samples.length < 3 && !samples.includes(shown)) samples.push(shown);
        if (label !== listedBy) {
          if (label.startsWith('item listed by ')) otherListed += 1;
          continue;
        }
        exact += 1;
        last = a;
        let slug = '';
        try {
          const u = new URL(a.href, location.href);
          if (u.hostname.replace(/^www\./, '') !== 'depop.com') continue;
          slug = u.pathname.match(/^\/products\/([^/]+)\/?$/)?.[1] || '';
        } catch { continue; }
        if (!slug || seen.has(slug)) continue;
        seen.add(slug);
        productUrls.push(`https://www.depop.com/products/${slug}/`);
      }
      const cardTexts = [];
      for (const a of bag.anchors) {
        const card = clip(a.textContent || a.innerText, 160);
        if (card && cardTexts.length < 12 && !cardTexts.includes(card)) cardTexts.push(card);
      }
      return {
        productUrls, exact, otherListed, samples, shadows: bag.shadows, productAnchors: bag.anchors.length, last,
        sold: !!(heading || soldLinks), soldLinks, cardTexts,
        readyState: String(document.readyState || 'unknown'), title: clip(document.title, 120),
        href: clip(location.href, 180), hasBody: !!document.body,
      };
    };
    const chipTexts = () => {
      const out = [];
      let nodes = [];
      try { nodes = document.querySelectorAll?.('button, [role="button"], [aria-pressed]') || []; }
      catch { nodes = []; }
      for (const n of nodes) {
        const t = clip(n?.textContent, 40);
        if (!t || !/^(women|men|footwear|boots)(\s*\/\s*(women|men|footwear|boots))?$/i.test(t)) continue;
        if (!out.includes(t)) out.push(t);
      }
      return out;
    };
    const scrollGrid = snap => {
      const win = typeof window !== 'undefined' ? window : null;
      if (snap.last && typeof snap.last.scrollIntoView === 'function') snap.last.scrollIntoView({ block: 'end' });
      if (win && typeof win.scrollBy === 'function') { win.scrollBy(0, -120); win.scrollBy(0, 240); }
      if (!snap.sold) {
        const height = Math.max(document.body?.scrollHeight || 0, document.documentElement?.scrollHeight || 0);
        if (win && typeof win.scrollTo === 'function') win.scrollTo(0, height);
      }
    };
    const clickMore = () => {
      let nodes = [];
      try { nodes = document.querySelectorAll?.('button, a, [role="button"]') || []; }
      catch { nodes = []; }
      for (const n of nodes) {
        const t = clip(n?.textContent, 40);
        if (!/^load more|^show more|^see more/i.test(t)) continue;
        if (typeof n.click === 'function') n.click();
        return;
      }
    };
    let snap = collect();
    let stable = 0;
    let stop = 'time';
    // Depop adds shop cards slowly. Five unchanged waits usually mean the grid is done.
    // An exact page of 24 (or 48, …) is suspicious, so those grids get two more scroll-and-wait tries.
    // The Sold items block is the end of the selling grid; those links are not queued.
    const needQuiet = n => settle + (n > 0 && n % 24 === 0 ? 2 : 0);
    const shownCount = () => {
      const read = text => {
        const t = String(text ?? '').replace(/\s+/g, ' ').trim();
        if (!t || t.length > 80 || /\$\s*\d/.test(t) || /\bsold\b/i.test(t) || /\bfollowers?\b/i.test(t)) return 0;
        const num = '(\\d{1,3}(?:[,. ]\\d{3})+|\\d{1,5})';
        const m = t.match(new RegExp('\\b' + num + '\\s+results?\\b', 'i'))
          || t.match(new RegExp('\\bresults?\\s*[:\\-]?\\s*' + num + '\\b', 'i'))
          || t.match(new RegExp('\\b' + num + '\\s+items?\\b', 'i'))
          || t.match(new RegExp('\\bshowing\\s+' + num + '\\b', 'i'));
        const n = m ? Number(String(m[1]).replace(/[,. ]/g, '')) : 0;
        return n > 0 && n <= 10000 ? n : 0;
      };
      let nodes = [];
      try { nodes = document.querySelectorAll?.('p, span, h1, h2, h3, [role="status"]') || []; }
      catch { return 0; }
      for (const n of nodes) {
        if (n?.children && n.children.length > 2) continue;
        const found = read(n?.textContent);
        if (found) return found;
      }
      return 0;
    };
    while (snap.productUrls.length < limit && !snap.sold && deadlineMs > Date.now() + pauseMs) {
      const target = shownCount();
      const have = snap.productUrls.length;
      if (target && have >= target) { stop = 'target'; break; }
      const need = needQuiet(have);
      if (!target && snap.readyState === 'complete' && stable >= need && (have > 0 || pace?.allowEmpty)) { stop = 'settled'; break; }
      const before = snap.productUrls.length;
      clickMore();
      scrollGrid(snap);
      await new Promise(r => setTimeout(r, pauseMs));
      if (!onShop()) return fail(`This tab left the requested Depop shop ${shop} (${clip(location.href, 180)}). Nothing was imported.`);
      snap = collect();
      stable = snap.productUrls.length === before ? stable + 1 : 0;
    }
    const queued = snap.productUrls.slice(0, limit);
    if (snap.sold) stop = 'sold';
    else if (stop !== 'settled' && queued.length >= limit) stop = 'cap';
    const settled = stop === 'settled' || stop === 'sold';
    const partial = !settled;
    const limitHit = stop === 'time';
    const capHit = stop === 'cap';
    const chips = chipTexts();
    const pageUrl = String(location.href || '');
    const resultCount = shownCount();
    const short = resultCount > 0 && queued.length < resultCount;
    const evidence = `Tab ${snap.href}. readyState ${snap.readyState}. Title "${snap.title || '(none)'}". Document body ${snap.hasBody ? 'present' : 'missing'}. Product anchors ${snap.productAnchors}. Exact label "item listed by ${shop}": ${snap.exact}. Unique selling links: ${snap.productUrls.length}. Sold-section links skipped: ${snap.soldLinks}. Other "item listed by" anchors: ${snap.otherListed}. Open shadow roots walked: ${snap.shadows}. Sample product aria-labels: ${snap.samples.length ? snap.samples.join(' | ') : '(none)'}. Filter chips: ${chips.length ? chips.join(' | ') : '(none)'}. Closed shadow roots were not opened.`;
    if (!queued.length && !pace?.allowEmpty)
      return fail(`Depop shop ${shop} was not imported. No candidate anchors were available before the time limit, so this is an incomplete or unrecognized page, not a finished import. ${evidence} Nothing was imported. Sync will not remove listings.`);
    const how = stop === 'sold'
      ? ' Stopped at the Sold items section. Sold listings were not queued.'
      : stop === 'target'
        ? ` Reached the displayed count (${queued.length}/${resultCount}).`
      : short
        ? ` Stopped at ${queued.length} of ${resultCount} shown results.`
      : limitHit
        ? ` Shop scroll hit its read limit before the grid settled (${queued.length} links queued). This may not be the whole shop.`
        : capHit
          ? ` Queued ${queued.length} candidate links, the scan cap.`
          : ' The visible shop grid stopped growing.';
    return {
      ok: true, complete: false, partial, limitHit, capHit, value: [], productUrls: queued,
      chips, cardTexts: snap.cardTexts || [], pageUrl, resultCount, short,
      reason: `Depop shop ${shop}: ${queued.length} candidate links queued in page order for a western-boot check (scan cap ${limit}).${how} ${evidence} Sync will not remove listings.`,
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
    const sellerLabel = `${shop}'s shop`;
    const shopLink = [...document.querySelectorAll('a[href]')].find(a => {
      if (sellerHandle(a.href) !== shop) return false;
      if ((a.getAttribute?.('aria-label') || '') === sellerLabel) return true;
      return !!a.querySelector?.('[data-testid="avatar"]');
    });
    if (!shopLink)
      return fail(`This Depop product does not show a seller link to ${shop}. Account binding is unresolved. Nothing was imported.`);
    const script = document.querySelector('script[data-testid="meta__jsonLd"]');
    if (!script || (script.getAttribute?.('type') || '') !== 'application/ld+json')
      return fail('This Depop product has no schema.org product block. Nothing was imported.');
    let parsed;
    try { parsed = JSON.parse(script.textContent || ''); }
    catch { return fail('This Depop product block could not be read. Nothing was imported.'); }
    const product = [parsed].flat().find(x => x && [x['@type']].flat().includes('Product'));
    if (!product) return fail('This Depop product block is not a Product. Nothing was imported.');
    const offer = product.offers || {};
    if (!String(offer.availability || '').endsWith('InStock'))
      return fail('This Depop product is not marked in stock. Nothing was imported.');
    const price = typeof offer.price === 'string' ? offer.price : '';
    if (!/^\d{1,8}(\.\d{1,2})?$/.test(price)) return fail('This Depop product has no price amount. Nothing was imported.');
    const description = typeof product.description === 'string' ? product.description : '';
    if (!description.trim()) return fail('This Depop product has no description. Nothing was imported.');
    const firstLine = description.split('\n').map(s => s.trim()).find(Boolean) || '';
    const sellerName = typeof product.name === 'string' ? product.name : '';
    const generated = (document.querySelector('h1')?.textContent || '').trim();
    const nameTruncated = sellerName.includes('...');
    let title = '';
    let titleNote = '';
    if (!(firstLine && !firstLine.includes('...')))
      return fail(`The first line of the description is unusable, so this item was not imported. Depop's generated heading${generated ? ` "${generated}"` : ''} was not stored as the title.`);
    title = firstLine.slice(0, 300);
    titleNote = `The title is the first line of the full description. Depop's generated heading is "${generated || 'missing'}" and was not stored as the title.${nameTruncated ? ' The seller name in the product block was truncated and was not used.' : ''}`;
    const photos = [];
    for (const src of [product.image].flat()) {
      if (typeof src !== 'string' || !/^https:\/\/\S+$/.test(src) || src.length > 2000) continue;
      if (/\/(?:U1|P8|P10)\.jpg(?:$|\?)/.test(src)) continue;
      if (!photos.includes(src)) photos.push(src);
      if (photos.length > 30) return fail('This Depop product has more photos than the limit. Nothing was imported.');
    }
    if (!photos.length) return fail('This Depop product block has no photos. Nothing was imported.');
    const lines = [...(document.querySelector('[data-testid="productPrimaryAttributes"]')?.querySelectorAll('p') || [])]
      .map(p => (p.textContent || '').trim()).filter(Boolean);
    const sizeLine = lines.find(l => /^size\s+/i.test(l)) || '';
    const conditionLine = lines.find(l => /\scondition$/i.test(l)) || '';
    const size = sizeLine ? sizeLine.replace(/^size\s+/i, '').slice(0, 40) : null;
    const condition = conditionLine ? conditionLine.replace(/\s+condition$/i, '').slice(0, 40) : null;
    const who = /\bwomen['’]s\b/i.test(description) ? 'Women' : /\bmen['’]s\b/i.test(description) ? 'Men' : /\bkids?\b/i.test(description) ? 'Kids' : null;
    const brandName = product.brand?.name;
    const brand = typeof brandName === 'string' && brandName && brandName !== 'Other' ? brandName : null;
    const currency = typeof offer.priceCurrency === 'string' ? offer.priceCurrency : '';
    return {
      ok: true, complete: false,
      value: [{
        source: 'depop', source_id: slug, source_url: `https://www.depop.com/products/${slug}/`,
        title, description, price, brand, size, sized_for: who, condition, color: null, material: null, category: '', photos,
      }],
      reason: `${titleNote} Price amount ${price}${currency ? ` ${currency}` : ''}; a currency symbol in the page heading is not a second price. Sync will not remove listings.`,
    };
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
  const limit = Number.isInteger(cap) && cap >= 1 ? Math.min(cap, 100) : 100;
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

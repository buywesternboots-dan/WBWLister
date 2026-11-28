// Server-only client for https://www.westernbootworld.com/api/bootlister.
// The key stays in WBW_API_KEY. This module must not be imported from client code.
import { appliedAmcaso } from './amcaso-wbw';
import { HttpError } from './http';
import { altText } from './seo';
import { MATERIALS } from './vocab';

export const WBW_API_URL = 'https://www.westernbootworld.com/api/bootlister';
const TIMEOUT_MS = 20000;
const MAX_BACKOFF_MS = 10000;
const TITLE_LIMIT = 120;
const DESC_LIMIT = 5000;
const PHOTO_LIMIT = 30;
const SHIPPING = new Set(['conus', 'usa', 'global', 'pickup']);
const SIZED = { Men: "Men's", Women: "Women's", Kids: 'Kids' };

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export function redactSecret(text, key) {
  let s = String(text ?? '');
  const secret = String(key ?? '').trim();
  if (secret.length >= 8) s = s.split(secret).join('[redacted]');
  return s;
}

function assertKey(env) {
  if (!String(env?.WBW_API_KEY ?? '').trim()) throw new HttpError('WBW_API_KEY not configured', 503);
}

function publicHttps(value) {
  try {
    const u = new URL(String(value).trim());
    if (u.protocol !== 'https:' || u.username || u.password) return false;
    const host = u.hostname.toLowerCase();
    return !!host && host !== 'localhost' && !host.endsWith('.localhost') && !host.endsWith('.local');
  } catch { return false; }
}

function httpsUrl(value) {
  if (!publicHttps(value)) return null;
  return new URL(String(value).trim()).href;
}

function text(value) {
  const s = String(value ?? '').trim();
  return s;
}

function money(value) {
  const s = text(value);
  if (!s) return '';
  return s.startsWith('$') ? s : `$${s}`;
}

function fitDescription(base, notes) {
  let out = text(base);
  if (out.length >= DESC_LIMIT) return out.slice(0, DESC_LIMIT);
  for (const note of notes) {
    const line = text(note);
    if (!line || out.includes(line)) continue;
    const sep = out ? '\n\n' : '';
    if (out.length + sep.length + line.length <= DESC_LIMIT) { out += sep + line; continue; }
    const room = DESC_LIMIT - out.length - sep.length;
    if (room > 0) out += sep + line.slice(0, room);
    break;
  }
  return out;
}

function photoCodeNote(codes) {
  if (!Array.isArray(codes)) return '';
  const bits = codes.map(c => {
    if (c == null) return '';
    if (typeof c === 'string') return c.trim();
    const label = text(c.text);
    if (!label) return '';
    const where = [c.type ? String(c.type) : '', c.photo != null && c.photo !== '' ? `photo ${c.photo}` : ''].filter(Boolean);
    return where.length ? `${label} (${where.join(', ')})` : label;
  }).filter(Boolean);
  return bits.length ? `Photo codes: ${bits.join('; ')}` : '';
}

function keywords(value) {
  const parts = Array.isArray(value) ? value : text(value).split(/[,|]/);
  return parts.map(v => text(v)).filter(Boolean);
}

function skinFamily(material) {
  const name = text(material).toLowerCase();
  if (!name) return '';
  return MATERIALS.find(m => m.name.toLowerCase() === name)?.family || '';
}

function buckle(item) {
  const hay = `${item?.title ?? ''}\n${item?.description ?? ''}`;
  if (/\b(buckle not included|no buckle|without (?:a )?buckle|buckle sold separately)\b/i.test(hay)) return 'not_included';
  if (/\b(buckle included|includes (?:a )?buckle|with buckle)\b/i.test(hay)) return 'included';
  return '';
}

function put(listing, key, value) {
  if (value == null) return;
  if (typeof value === 'string' && value.trim() === '') return;
  if (Array.isArray(value) && !value.length) return;
  listing[key] = typeof value === 'string' ? value.trim() : value;
}

// BootLister item → one WBW listing object. Empty fields are left out. No WBW call.
export function mapListing(item, { publish = false, shipping_type, shipping_cost, seller } = {}) {
  const photos = Array.isArray(item?.photos) ? item.photos : [];
  const applied = appliedAmcaso(item, { seller });
  const pairs = [];
  for (let i = 0; i < photos.length && pairs.length < PHOTO_LIMIT; i++) {
    const url = httpsUrl(photos[i]);
    if (!url) continue;
    const fromAmcaso = applied?.images?.[i]?.alt;
    const alt = fromAmcaso != null && text(fromAmcaso) ? text(fromAmcaso) : altText(item, i + 1, photos.length);
    pairs.push({ url, alt });
  }
  if (!pairs.length) return { error: 'This listing has no usable HTTPS photos, so it was not sent to WBW.' };

  const asking = money(item.wbw_price ?? item.price);
  const source = money(item.price);
  const sourceUrl = text(item.source_url);
  const notes = [];
  if (text(item.id_text)) notes.push(`Model / date codes: ${text(item.id_text)}`);
  if (text(item.material_cut)) notes.push(`Material cut: ${text(item.material_cut)}`);
  const codes = photoCodeNote(item.photo_codes);
  if (codes) notes.push(codes);
  if (asking && source && asking !== source) notes.push(`Source price: ${source}`);
  if (sourceUrl && !httpsUrl(sourceUrl)) notes.push(`Source URL: ${sourceUrl}`);
  const description = fitDescription(item.description, notes);

  const listing = {};
  put(listing, 'title', text(item.title).slice(0, TITLE_LIMIT));
  put(listing, 'description', description);
  put(listing, 'price', asking);
  put(listing, 'brand', text(item.brand));
  put(listing, 'size', text(item.size));
  const sized = text(item.sized_for);
  put(listing, 'size_type', SIZED[sized] || sized);
  put(listing, 'width', text(item.width));
  put(listing, 'condition', text(item.condition));
  put(listing, 'skin', text(item.material));
  put(listing, 'material_type', text(item.material_type));
  put(listing, 'color', text(item.color));
  put(listing, 'where_made', text(item.made_in));
  put(listing, 'skin_family', skinFamily(item.material));
  put(listing, 'toe_shape', text(item.toe));
  put(listing, 'heel_type', text(item.heel));
  put(listing, 'sole_type', text(item.sole));
  put(listing, 'outsole', text(item.sole_length));
  put(listing, 'sole_width', text(item.sole_width));
  put(listing, 'heel_height', text(item.heel_height));
  put(listing, 'shaft_height', text(item.shaft_height));
  put(listing, 'shaft_circumference', text(item.shaft_circ));
  const words = keywords(item.keywords);
  if (words.length) listing.keywords = words;
  if (/^(yes|true)$/i.test(text(item.size_estimated)) || /^estimated$/i.test(text(item.size))) listing.size_estimated = true;
  if (text(item.condition) === 'Custom Made' || /\b(custom made|made to order)\b/i.test(`${item.title ?? ''}\n${item.description ?? ''}`)) listing.custom_made = true;
  if (item.boot === 'boot') listing.item_type = 'boots';
  else if (item.boot === 'belt') listing.item_type = 'belt';
  put(listing, 'buckle', buckle(item));
  put(listing, 'source_url', httpsUrl(sourceUrl) || '');
  listing.photo_urls = pairs.map(p => p.url);
  if (pairs.some(p => p.alt)) listing.photo_alts = pairs.map(p => p.alt);
  if (publish) {
    put(listing, 'shipping_type', shipping_type);
    put(listing, 'shipping_cost', shipping_cost);
  }
  return { listing };
}

function asBool(value) {
  if (value === true || value === 't' || value === 'true' || value === 'yes' || value === 1) return true;
  if (value === false || value === 'f' || value === 'false' || value === 'no' || value === 0) return false;
  return null;
}

// Seller profile id and wbwStatus, using only the names in the WBW contract.
export function sellerStatusPatch(body) {
  const seller = body?.seller && typeof body.seller === 'object' ? body.seller : {};
  const status = body?.wbwStatus && typeof body.wbwStatus === 'object' ? body.wbwStatus : {};
  const id = seller.id ?? seller.sellerId ?? seller.profileId;
  const patch = {};
  if (id != null && text(id)) patch.wbw_seller_id = text(id);
  if ('signed_up' in status) patch.wbw_signed_up = asBool(status.signed_up);
  if ('accepted' in status) patch.wbw_accepted = asBool(status.accepted);
  if ('phone_verified' in status) patch.wbw_phone_verified = asBool(status.phone_verified);
  if (status.source != null && text(status.source)) patch.wbw_status_source = text(status.source);
  if (status.checked_at != null && text(status.checked_at)) patch.wbw_status_checked_at = text(status.checked_at);
  return patch;
}

function errorText(body) {
  return body && typeof body === 'object' && typeof body.error === 'string' ? body.error : '';
}

function pickImport(body) {
  const row = body && typeof body === 'object' ? body : {};
  const publication = row.publication && typeof row.publication === 'object' ? row.publication : null;
  return {
    ok: row.ok === true,
    duplicate: row.duplicate === true,
    listingId: row.listingId != null && text(row.listingId) ? text(row.listingId) : null,
    sellerId: row.sellerId != null && text(row.sellerId) ? text(row.sellerId) : null,
    status: row.status != null && text(row.status) ? text(row.status) : null,
    url: httpsUrl(row.url),
    publicationOk: publication?.ok === true,
    publicationError: publication?.error != null && text(publication.error) ? text(publication.error) : null,
  };
}

export function classifyImport(status, body, key = '') {
  const picked = pickImport(body);
  const clean = s => redactSecret(s, key);
  const base = { confirmed: false, unconfirmed: false, status };
  if (status === 409) return { ...base, kind: 'conflict', message: 'needs review' };
  if (status === 422) return { ...base, kind: 'photo failure', message: clean(errorText(body) || 'WBW could not use the photos.') };
  if (status === 401) return { ...base, kind: 'error', message: 'WBW rejected the API key.' };
  if (status === 403) return { ...base, kind: 'error', message: 'WBW permission is revoked.' };
  if (status === 404) return { ...base, kind: 'error', message: 'WBW does not know this seller.' };
  if (status === 400) return { ...base, kind: 'error', message: clean(errorText(body) || 'WBW rejected the listing.') };
  if (status === 429) return { ...base, kind: 'error', message: 'WBW rate limit. Try again later.' };
  if (status >= 500 || status === 0) return { ...base, kind: 'error', unconfirmed: true, message: 'WBW did not confirm the import. Safe to retry with the same ids.' };
  if (status === 200 && picked.ok) {
    let kind = 'ok';
    if (picked.duplicate) kind = 'duplicate';
    else if (picked.status === 'published' || picked.publicationOk) kind = 'published';
    else if (picked.publicationError) kind = 'publication error';
    else if (picked.status === 'draft') kind = 'draft';
    const message = picked.publicationError
      ? clean(picked.publicationError)
      : kind === 'duplicate' ? 'Already on WBW.' : kind === 'published' ? 'Published.' : 'Saved as a draft.';
    return {
      kind, message, confirmed: true, unconfirmed: false, status,
      listingId: picked.listingId, sellerId: picked.sellerId, listingStatus: picked.status, url: picked.url,
      publicationError: picked.publicationError ? clean(picked.publicationError) : null,
    };
  }
  return { ...base, kind: 'error', message: 'WBW returned an unexpected response.' };
}

function redirected(res) {
  return !!res?.redirected || res?.type === 'opaqueredirect' || (res.status >= 300 && res.status < 400);
}

function retryAfterMs(header, now = Date.now()) {
  if (header == null || String(header).trim() === '') return null;
  const s = String(header).trim();
  if (/^\d+(\.\d+)?$/.test(s)) return Math.max(0, Number(s) * 1000);
  const when = Date.parse(s);
  if (Number.isNaN(when)) return null;
  return Math.max(0, when - now);
}

async function readJson(res) {
  const raw = await res.text();
  if (!raw) return {};
  try { return JSON.parse(raw.slice(0, 100000)); }
  catch { return {}; }
}

export async function wbwRequest({ method = 'GET', query = '', body, env = process.env, fetchImpl = globalThis.fetch, sleepImpl = sleep, timeoutMs = TIMEOUT_MS } = {}) {
  assertKey(env);
  const key = String(env.WBW_API_KEY).trim();
  if (query && !query.startsWith('?')) throw new HttpError('Bad WBW request.', 400);
  const url = WBW_API_URL + query;
  const send = async () => {
    try {
      return await fetchImpl(url, {
        method,
        redirect: 'manual',
        headers: {
          Authorization: `Bearer ${key}`,
          Accept: 'application/json',
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      const timedOut = e?.name === 'TimeoutError' || e?.name === 'AbortError' || /timeout/i.test(e?.message || '');
      const err = new HttpError(timedOut
        ? 'WBW did not respond (unconfirmed). Safe to retry with the same ids.'
        : 'WBW could not be reached (unconfirmed). Safe to retry with the same ids.', 503);
      err.unconfirmed = true;
      throw err;
    }
  };
  let res = await send();
  if (redirected(res)) throw new HttpError('WBW redirected the request. The connection was refused.', 502);
  if (res.status === 429) {
    const wait = retryAfterMs(res.headers?.get?.('retry-after'));
    if (wait != null) {
      await res.text().catch(() => {});
      await sleepImpl(Math.min(wait, MAX_BACKOFF_MS));
      res = await send();
      if (redirected(res)) throw new HttpError('WBW redirected the request. The connection was refused.', 502);
    }
  }
  return { status: res.status, body: await readJson(res), retryAfter: res.headers?.get?.('retry-after') ?? null };
}

function fail(status, body, key) {
  const outcome = classifyImport(status, body, key);
  const err = new HttpError(outcome.message, status === 401 || status === 403 || status === 404 || status === 429 ? status : status >= 500 ? 503 : 400);
  err.unconfirmed = outcome.unconfirmed;
  throw err;
}

export async function readHealth(env = process.env, deps = {}) {
  const key = env.WBW_API_KEY;
  const { status, body } = await wbwRequest({ method: 'GET', env, ...deps });
  if (status !== 200 || body?.ok !== true) fail(status, body, key);
  return { ok: true, integration: body.integration, capabilities: body.capabilities, limits: body.limits };
}

function sellerPayload(row, externalSellerId) {
  const seller = {
    email: text(row.email),
    displayName: text(row.display_name),
    authorized: true,
  };
  if (text(row.location)) seller.location = text(row.location);
  return { action: 'seller', externalSellerId, seller };
}

export async function connectSeller(db, input, env = process.env, deps = {}) {
  if (input?.authorized !== true) throw new HttpError('Tick authorized to confirm the seller permitted account setup.', 400);
  const name = text(input?.seller).toLowerCase();
  const row = await db.getSeller(name);
  if (!row) throw new HttpError('That seller was not found.', 404);
  if (!text(row.email)) throw new HttpError('This seller needs a login email before they can be connected.', 400);
  const externalSellerId = row.wbw_external_id || await db.assignExternalSellerId(name);
  if (!externalSellerId) throw new HttpError('That seller was not found.', 404);
  const { status, body } = await wbwRequest({ method: 'POST', body: sellerPayload(row, externalSellerId), env, ...deps });
  if (status !== 200 || body?.ok !== true) fail(status, body, env.WBW_API_KEY);
  const saved = await db.saveSellerWbw(name, sellerStatusPatch(body));
  return { ok: true, externalSellerId, seller: saved };
}

export async function readSellerStatus(db, seller, env = process.env, deps = {}) {
  const name = text(seller).toLowerCase();
  const row = await db.getSeller(name);
  if (!row) throw new HttpError('That seller was not found.', 404);
  if (!row.wbw_external_id) throw new HttpError('Connect this seller to WBW first.', 400);
  const query = `?externalSellerId=${encodeURIComponent(row.wbw_external_id)}`;
  const { status, body } = await wbwRequest({ method: 'GET', query, env, ...deps });
  if (status !== 200 || body?.ok !== true) fail(status, body, env.WBW_API_KEY);
  const saved = await db.saveSellerWbw(name, sellerStatusPatch(body));
  return { ok: true, externalSellerId: row.wbw_external_id, seller: saved };
}

function confirmedPatch(outcome, now) {
  const patch = {
    wbw_needs_review: false,
    wbw_confirmed_at: now,
    wbw_publication_error: outcome.publicationError || null,
  };
  if (outcome.listingId) patch.wbw_listing_id = outcome.listingId;
  if (outcome.sellerId) patch.wbw_seller_id = outcome.sellerId;
  if (outcome.listingStatus) patch.wbw_status = outcome.listingStatus;
  if (outcome.url) patch.wbw_url = outcome.url;
  return patch;
}

export async function importListings(db, input, env = process.env, deps = {}) {
  const name = text(input?.seller).toLowerCase();
  const row = await db.getSeller(name);
  if (!row) throw new HttpError('That seller was not found.', 404);
  if (!row.wbw_external_id) throw new HttpError('Connect this seller to WBW first.', 400);
  const publish = input?.publish === true;
  let shippingType = '', shippingCost = '';
  if (publish) {
    shippingType = text(input.shipping_type);
    shippingCost = text(input.shipping_cost);
    if (!SHIPPING.has(shippingType)) throw new HttpError('Pick a shipping type: conus, usa, global, or pickup.', 400);
    if (!shippingCost) throw new HttpError('Enter the shipping cost.', 400);
  }
  const ids = Array.isArray(input?.ids) ? input.ids : [];
  if (!ids.length) throw new HttpError('Select at least one listing.', 400);
  assertKey(env);
  const items = await db.getItemsByIds(ids);
  const byId = new Map((items || []).map(item => [String(item.id), item]));
  const results = [];
  for (const id of ids) {
    const item = byId.get(String(id));
    if (!item || String(item.seller) !== name) {
      results.push({ id, kind: 'error', message: "That listing is not this seller's.", confirmed: false, unconfirmed: false });
      continue;
    }
    const externalItemId = String(item.id);
    const mapped = mapListing(item, { publish, shipping_type: shippingType, shipping_cost: shippingCost, seller: row });
    if (mapped.error) {
      results.push({ id: item.id, externalItemId, kind: 'photo failure', message: mapped.error, confirmed: false, unconfirmed: false });
      continue;
    }
    let response;
    try {
      response = await wbwRequest({
        method: 'POST',
        body: {
          action: 'import',
          externalSellerId: row.wbw_external_id,
          externalItemId,
          publish,
          listing: mapped.listing,
        },
        env,
        ...deps,
      });
    } catch (e) {
      results.push({
        id: item.id, externalItemId, kind: 'error', status: e.status || 503,
        message: redactSecret(e.message || 'WBW could not be reached (unconfirmed). Safe to retry with the same ids.', env.WBW_API_KEY),
        confirmed: false, unconfirmed: e.unconfirmed === true,
      });
      continue;
    }
    const outcome = classifyImport(response.status, response.body, env.WBW_API_KEY);
    if (outcome.status === 429 && response.retryAfter && !String(response.retryAfter).includes(String(env.WBW_API_KEY || '')))
      outcome.message = `WBW rate limit. Retry-After: ${response.retryAfter}. Try again later.`;
    outcome.id = item.id;
    outcome.externalItemId = externalItemId;
    if (outcome.kind === 'conflict') {
      await db.saveItemWbw(item.id, name, { wbw_needs_review: true, wbw_publication_error: 'needs review' });
    } else if (outcome.confirmed) {
      await db.saveItemWbw(item.id, name, confirmedPatch(outcome, new Date().toISOString()));
    }
    results.push(outcome);
  }
  return { results };
}

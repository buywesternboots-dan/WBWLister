import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { GET, wbwApi } from '../app/api/wbw/route.js';
import { classifyImport, mapListing, redactSecret, WBW_API_URL } from '../lib/wbw-api.js';
import { SELLER_FIELDS } from '../lib/wbw.js';
import { sessionToken } from '../lib/session.js';

const KEY = 'test-wbw-key-0123456789abcdef';
const ENV = { NODE_ENV: 'production', ADMIN_PASSWORD: 'staff-secret', APP_PASSWORD: 'signing-secret', WBW_API_KEY: KEY };
const read = p => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

function jsonRes(status, body, headers = {}) {
  const bag = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    status, redirected: false, type: 'basic',
    headers: { get: name => bag.get(String(name).toLowerCase()) ?? null },
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body ?? {})),
  };
}

function mockFetch(handler) {
  const calls = [];
  const sleeps = [];
  const fetchImpl = async (url, init) => {
    const call = { url, init, body: init?.body ? JSON.parse(init.body) : null };
    calls.push(call);
    return handler(call, calls.length);
  };
  return { fetchImpl, sleepImpl: ms => { sleeps.push(ms); return Promise.resolve(); }, calls, sleeps };
}

function dbWith() {
  const sellers = new Map();
  const items = [];
  const itemPatches = [];
  return {
    sellers, items, itemPatches,
    async getSeller(name) {
      const row = sellers.get(name);
      return row ? { ...row } : null;
    },
    async assignExternalSellerId(name) {
      const row = sellers.get(name);
      if (!row) return null;
      if (!row.wbw_external_id) row.wbw_external_id = '11111111-1111-4111-8111-111111111111';
      return row.wbw_external_id;
    },
    async saveSellerWbw(name, patch) {
      const row = sellers.get(name);
      Object.assign(row, patch);
      return { ...row };
    },
    async getItemsByIds(ids) {
      const want = new Set(ids.map(String));
      return items.filter(item => want.has(String(item.id))).map(item => ({ ...item, photos: [...(item.photos || [])] }));
    },
    async saveItemWbw(id, seller, patch) {
      itemPatches.push({ id, seller, patch: { ...patch } });
      const item = items.find(row => String(row.id) === String(id) && row.seller === seller);
      if (item) Object.assign(item, patch);
      return { id };
    },
  };
}

const req = (method, token, body, query = '') => new Request(`http://localhost/api/wbw${query}`, {
  method,
  headers: { 'x-auth': token || '', 'content-type': 'application/json', ...(token ? {} : {}) },
  body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
});

const boot = (over = {}) => ({
  id: 42, seller: 'ada', title: 'Lucchese full quill ostrich boots', wbw_price: '250', price: '200',
  brand: 'Lucchese', size: '10', sized_for: 'Men', width: 'AAA', condition: 'Broken In',
  material: 'Full Quill Ostrich', material_type: 'Exotic', material_cut: 'Full quill', color: 'Cognac',
  made_in: 'USA', toe: 'Snip toe', heel: 'Riding heel', sole: 'Leather',
  sole_length: '12.25', sole_width: '4.5', heel_height: '1.5', shaft_height: '13', shaft_circ: '15',
  keywords: 'Vintage, Deadstock', size_estimated: 'Yes', boot: 'boot',
  description: 'The seller’s listing description.', id_text: 'CL-1883',
  photo_codes: [{ text: '1883', type: 'model', photo: 1 }],
  source_url: 'https://seller.example.com/listings/42',
  photos: ['https://photos.example.com/boots-42.jpg'],
  ...over,
});

function ada(db) {
  db.sellers.set('ada', { name: 'ada', email: 'ada@shop.test', display_name: 'Ada Boots', location: 'Austin, TX', wbw_external_id: '11111111-1111-4111-8111-111111111111' });
}

test('logged-out and seller sessions cannot call the WBW routes', async () => {
  const prev = { NODE_ENV: process.env.NODE_ENV, ADMIN_PASSWORD: process.env.ADMIN_PASSWORD, APP_PASSWORD: process.env.APP_PASSWORD };
  Object.assign(process.env, { NODE_ENV: 'production', ADMIN_PASSWORD: 'staff-secret', APP_PASSWORD: 'signing-secret' });
  try {
    const res = await GET(new Request('http://localhost/api/wbw?action=health'));
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.error, 'Please log in.');
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
  const seller = await sessionToken('seller:ada', ENV.APP_PASSWORD);
  const db = dbWith();
  const seen = mockFetch(() => jsonRes(200, { ok: true }));
  for (const call of [
    () => wbwApi(req('GET', seller, null, '?action=health'), db, ENV, seen),
    () => wbwApi(req('GET', seller, null, '?action=status&seller=ada'), db, ENV, seen),
    () => wbwApi(req('POST', seller, { action: 'seller', seller: 'ada', authorized: true }), db, ENV, seen),
    () => wbwApi(req('POST', seller, { action: 'import', seller: 'ada', ids: [1], publish: false }), db, ENV, seen),
  ]) await assert.rejects(call, /Only an admin/);
  assert.equal(seen.calls.length, 0);
});

test('health uses the www URL, refuses redirects, and reports WBW status codes', async () => {
  const admin = await sessionToken('admin', ENV.APP_PASSWORD);
  const db = dbWith();
  const ok = mockFetch(() => jsonRes(200, {
    ok: true, integration: 'bootlister',
    capabilities: ['sellers:provision', 'sellers:status', 'inventory:import', 'inventory:publish'],
    limits: { itemsPerRequest: 1, photosPerItem: 30 },
  }));
  const health = await wbwApi(req('GET', admin, null, '?action=health'), db, ENV, ok);
  assert.equal(health.integration, 'bootlister');
  assert.deepEqual(health.limits, { itemsPerRequest: 1, photosPerItem: 30 });
  assert.equal(ok.calls[0].url, WBW_API_URL);
  assert.equal(ok.calls[0].init.redirect, 'manual');
  assert.equal(ok.calls[0].init.method, 'GET');
  assert.equal(ok.calls[0].init.headers.Authorization, `Bearer ${KEY}`);
  assert.equal(ok.calls[0].url.includes(KEY), false);
  assert.equal(JSON.stringify(health).includes(KEY), false);

  const missing = mockFetch(() => jsonRes(200, { ok: true }));
  await assert.rejects(() => wbwApi(req('GET', admin, null, '?action=health'), db, { ...ENV, WBW_API_KEY: '' }, missing), /WBW_API_KEY not configured/);
  assert.equal(missing.calls.length, 0);

  const redirect = mockFetch(() => ({ status: 302, redirected: false, type: 'basic', headers: { get: () => 'https://evil.example/steal?key=' + KEY }, text: async () => KEY }));
  await assert.rejects(() => wbwApi(req('GET', admin, null, '?action=health'), db, ENV, redirect), /redirected/);
  assert.equal(redirect.calls.length, 1);
  assert.equal(redirect.calls[0].url, WBW_API_URL);

  const denied = mockFetch(() => jsonRes(401, { error: `bad ${KEY}` }));
  await assert.rejects(() => wbwApi(req('GET', admin, null, '?action=health'), db, ENV, denied), e => {
    assert.equal(e.status, 401);
    assert.match(e.message, /rejected the API key/);
    assert.equal(e.message.includes(KEY), false);
    return true;
  });
  const revoked = mockFetch(() => jsonRes(403, { error: KEY }));
  await assert.rejects(() => wbwApi(req('GET', admin, null, '?action=health'), db, ENV, revoked), e => e.status === 403 && !e.message.includes(KEY));
  const down = mockFetch(() => jsonRes(503, {}));
  await assert.rejects(() => wbwApi(req('GET', admin, null, '?action=health'), db, ENV, down), /did not confirm/);

  let n = 0;
  const limited = mockFetch(() => {
    n += 1;
    return n === 1 ? jsonRes(429, { error: KEY }, { 'retry-after': '2' }) : jsonRes(200, { ok: true, integration: 'bootlister', capabilities: [], limits: { itemsPerRequest: 1, photosPerItem: 30 } });
  });
  const again = await wbwApi(req('GET', admin, null, '?action=health'), db, ENV, limited);
  assert.equal(again.ok, true);
  assert.deepEqual(limited.sleeps, [2000]);
  assert.equal(limited.calls.length, 2);
  assert.equal(JSON.stringify(again).includes(KEY), false);
});

test('connect and status use the saved seller, ignore browser account fields, and keep one external id', async () => {
  const admin = await sessionToken('admin', ENV.APP_PASSWORD);
  const db = dbWith();
  db.sellers.set('ada', { name: 'ada', email: 'ada@shop.test', display_name: 'Ada Boots', location: 'Austin, TX' });
  const seen = mockFetch(() => jsonRes(200, {
    ok: true,
    seller: { id: 'wbw-seller-9', name: 'Ada Boots', username: 'ada', location: 'Austin, TX', approval: 'approved' },
    wbwStatus: { signed_up: true, accepted: true, phone_verified: false, source: 'bootlister', checked_at: '2026-11-28T15:00:00.000Z' },
  }));
  const connected = await wbwApi(req('POST', admin, {
    action: 'seller', seller: 'ada', authorized: true,
    email: 'evil@example.com', displayName: 'Evil', location: 'Nowhere',
    externalSellerId: '22222222-2222-4222-8222-222222222222', owner: 'bea', user_id: '999',
  }), db, ENV, seen);
  const sent = seen.calls[0].body;
  assert.equal(sent.action, 'seller');
  assert.equal(sent.externalSellerId, '11111111-1111-4111-8111-111111111111');
  assert.equal(sent.seller.email, 'ada@shop.test');
  assert.equal(sent.seller.displayName, 'Ada Boots');
  assert.equal(sent.seller.location, 'Austin, TX');
  assert.equal(sent.seller.authorized, true);
  assert.equal(sent.user_id, undefined);
  assert.equal(JSON.stringify(sent).includes('evil@example.com'), false);
  assert.equal(connected.seller.wbw_seller_id, 'wbw-seller-9');
  assert.equal(connected.seller.wbw_signed_up, true);
  assert.equal(connected.seller.wbw_phone_verified, false);
  assert.equal(connected.seller.wbw_status_checked_at, '2026-11-28T15:00:00.000Z');
  assert.equal(JSON.stringify(connected).includes(KEY), false);

  const row = db.sellers.get('ada');
  db.sellers.delete('ada');
  row.name = 'ada-boots';
  row.display_name = 'Ada Renamed';
  db.sellers.set('ada-boots', row);
  await wbwApi(req('POST', admin, { action: 'seller', seller: 'ada-boots', authorized: true, email: 'other@example.com' }), db, ENV, seen);
  assert.equal(seen.calls[1].body.externalSellerId, sent.externalSellerId);
  assert.equal(seen.calls[1].body.seller.email, 'ada@shop.test');
  assert.equal(seen.calls[1].body.seller.displayName, 'Ada Renamed');

  const status = mockFetch(() => jsonRes(200, {
    ok: true,
    seller: { id: 'wbw-seller-9' },
    wbwStatus: { signed_up: true, accepted: false, phone_verified: true, source: 'bootlister', checked_at: '2026-11-28T16:00:00.000Z' },
  }));
  await wbwApi(req('GET', admin, null, '?action=status&seller=ada-boots&email=evil@example.com&externalSellerId=hack'), db, ENV, status);
  assert.equal(status.calls[0].url, `${WBW_API_URL}?externalSellerId=11111111-1111-4111-8111-111111111111`);
  assert.equal(status.calls[0].init.method, 'GET');
  assert.equal(db.sellers.get('ada-boots').wbw_accepted, false);
  assert.equal(db.sellers.get('ada-boots').wbw_status_checked_at, '2026-11-28T16:00:00.000Z');

  await assert.rejects(() => wbwApi(req('POST', admin, { action: 'seller', seller: 'ada-boots', authorized: false }), db, ENV, seen), /authorized/);
});

test('field mapping keeps measurements, photo order, alts, and limits, and drops empty fields', () => {
  const photos = ['http://insecure.example/a.jpg', 'https://photos.example.com/b.jpg', 'https://user:pass@photos.example.com/secret.jpg', 'https://photos.example.com/c.jpg'];
  const item = boot({
    photos,
    title: 'T'.repeat(130),
    asmowbw: {
      media: 'asmowbw',
      images: photos.map((stored_url, i) => ({ n: i + 1, stored_url, alt: `Alt ${i + 1}` })),
    },
  });
  const { listing } = mapListing(item, { seller: { name: 'ada' } });
  assert.equal(listing.title.length, 120);
  assert.ok(listing.description.length <= 5000);
  assert.match(listing.description, /Model \/ date codes: CL-1883/);
  assert.match(listing.description, /Material cut: Full quill/);
  assert.match(listing.description, /Photo codes: 1883 \(model, photo 1\)/);
  assert.match(listing.description, /Source price: \$200/);
  assert.equal(listing.price, '$250');
  assert.equal(listing.outsole, '12.25');
  assert.equal(listing.sole_width, '4.5');
  assert.equal(listing.heel_height, '1.5');
  assert.equal(listing.shaft_height, '13');
  assert.equal(listing.shaft_circumference, '15');
  assert.equal(listing.width, 'AAA');
  assert.equal(listing.size_type, "Men's");
  assert.equal(listing.skin, 'Full Quill Ostrich');
  assert.equal(listing.skin_family, 'Ostrich');
  assert.deepEqual(listing.keywords, ['Vintage', 'Deadstock']);
  assert.equal(listing.size_estimated, true);
  assert.equal(listing.item_type, 'boots');
  assert.equal(listing.custom_made, undefined);
  assert.deepEqual(listing.photo_urls, ['https://photos.example.com/b.jpg', 'https://photos.example.com/c.jpg']);
  assert.deepEqual(listing.photo_alts, ['Alt 2', 'Alt 4']);
  const cappedText = mapListing(boot({ description: 'D'.repeat(5100), photos: ['https://photos.example.com/a.jpg'] })).listing;
  assert.equal(cappedText.description.length, 5000);
  assert.equal(cappedText.description.includes('Model / date codes'), false);
  assert.equal(listing.user_id, undefined);
  assert.equal(listing.material_cut, undefined);
  assert.equal(listing.id_text, undefined);

  const many = boot({ photos: Array.from({ length: 31 }, (_, i) => `https://photos.example.com/${i}.jpg`) });
  const capped = mapListing(many).listing;
  assert.equal(capped.photo_urls.length, 30);
  assert.equal(capped.photo_urls[0], 'https://photos.example.com/0.jpg');
  assert.equal(capped.photo_urls[29], 'https://photos.example.com/29.jpg');
  assert.equal(capped.photo_alts.length, 30);

  const blocked = mapListing(boot({ photos: ['http://photos.example.com/a.jpg'] }));
  assert.match(blocked.error, /no usable HTTPS photos/);
  const bare = mapListing({ id: 7, photos: ['https://photos.example.com/only.jpg'], title: 'Plain' }).listing;
  assert.deepEqual(Object.keys(bare).sort(), ['photo_alts', 'photo_urls', 'title']);

  const belt = mapListing(boot({ boot: 'belt', title: 'Belt with buckle included', description: 'Buckle included.', photos: ['https://photos.example.com/belt.jpg'], wbw_price: '80', price: '80', material: '', material_cut: '', id_text: '', photo_codes: [], size_estimated: '' })).listing;
  assert.equal(belt.item_type, 'belt');
  assert.equal(belt.buckle, 'included');
  assert.equal(belt.skin_family, undefined);
  assert.equal(belt.size_estimated, undefined);
  assert.equal(belt.description.includes('Source price'), false);
});

test('import checks ownership, reuses ids, and records each WBW result without stopping the batch', async () => {
  const admin = await sessionToken('admin', ENV.APP_PASSWORD);
  const db = dbWith();
  ada(db);
  db.items.push(boot(), boot({ id: 7, seller: 'bea', title: 'Bea pair', photos: ['https://photos.example.com/bea.jpg'] }));
  db.items.push(boot({ id: 8, photos: [] }));

  const foreign = mockFetch(() => jsonRes(200, { ok: true }));
  const rejected = await wbwApi(req('POST', admin, {
    action: 'import', seller: 'ada', ids: [7], publish: false, email: 'evil@example.com', externalItemId: 'nope', owner: 'bea',
  }), db, ENV, foreign);
  assert.equal(rejected.results[0].kind, 'error');
  assert.match(rejected.results[0].message, /not this seller/);
  assert.equal(foreign.calls.length, 0);

  let step = 0;
  const seen = mockFetch(() => {
    step += 1;
    if (step === 1) return jsonRes(409, { ok: false, listingId: 'SHOULD-NOT-SAVE', error: `changed ${KEY}` });
    if (step === 2) return jsonRes(200, { ok: true, duplicate: true, listingId: 'L1', sellerId: 'S1', status: 'draft', url: 'https://www.westernbootworld.com/l/1' });
    if (step === 3) return jsonRes(200, { ok: true, listingId: 'L2', sellerId: 'S1', status: 'draft', publication: { ok: false, error: `Fix ${KEY}` }, url: 'https://www.westernbootworld.com/l/2' });
    if (step === 4) return jsonRes(422, { error: `photos ${KEY}` });
    if (step === 5) return jsonRes(503, {});
    return jsonRes(200, { ok: true, listingId: 'L6', sellerId: 'S1', status: 'published', publication: { ok: true }, url: 'https://www.westernbootworld.com/l/6' });
  });
  db.items[0].wbw_listing_id = 'OLD';
  db.items[0].wbw_confirmed_at = '2026-11-01T00:00:00.000Z';
  const mixed = await wbwApi(req('POST', admin, {
    action: 'import', seller: 'ada', ids: [42, 42, 42, 42, 42, 42], publish: true, shipping_type: 'conus', shipping_cost: '18',
    email: 'evil@example.com', externalItemId: 'title-based', externalSellerId: 'hack',
  }), db, ENV, seen);
  assert.equal(seen.calls.length, 6);
  for (const call of seen.calls) {
    assert.equal(call.body.externalItemId, '42');
    assert.equal(call.body.externalSellerId, '11111111-1111-4111-8111-111111111111');
    assert.equal(call.body.publish, true);
    assert.equal(call.body.listing.shipping_type, 'conus');
    assert.equal(call.body.listing.shipping_cost, '18');
    assert.equal(call.url, WBW_API_URL);
    assert.equal(call.init.redirect, 'manual');
    assert.equal(JSON.stringify(call.body).includes(KEY), false);
    assert.equal(call.body.user_id, undefined);
  }
  assert.equal(mixed.results[0].kind, 'conflict');
  assert.equal(mixed.results[0].message, 'needs review');
  assert.deepEqual(db.itemPatches[0].patch, { wbw_needs_review: true, wbw_publication_error: 'needs review' });
  assert.equal(db.itemPatches[0].patch.wbw_listing_id, undefined);
  assert.equal(db.itemPatches[0].patch.wbw_confirmed_at, undefined);
  assert.equal(mixed.results[1].kind, 'duplicate');
  assert.equal(db.itemPatches[1].patch.wbw_listing_id, 'L1');
  assert.equal(db.itemPatches[1].patch.wbw_status, 'draft');
  assert.ok(db.itemPatches[1].patch.wbw_confirmed_at);
  assert.equal(mixed.results[2].kind, 'publication error');
  assert.match(mixed.results[2].message, /Fix \[redacted\]/);
  assert.equal(mixed.results[2].message.includes(KEY), false);
  assert.equal(db.itemPatches[2].patch.wbw_status, 'draft');
  assert.equal(db.itemPatches[2].patch.wbw_publication_error.includes(KEY), false);
  assert.equal(mixed.results[3].kind, 'photo failure');
  assert.equal(mixed.results[3].message.includes(KEY), false);
  assert.equal(mixed.results[4].kind, 'error');
  assert.equal(mixed.results[4].unconfirmed, true);
  assert.equal(mixed.results[5].kind, 'published');
  assert.equal(db.itemPatches.length, 4);
  assert.equal(JSON.stringify(mixed).includes(KEY), false);

  const draft = mockFetch(() => jsonRes(200, { ok: true, listingId: 'L7', sellerId: 'S1', status: 'draft', url: 'https://www.westernbootworld.com/l/7' }));
  db.items[0].title = 'Changed title';
  await wbwApi(req('POST', admin, { action: 'import', seller: 'ada', ids: [42], publish: false, shipping_type: 'global', shipping_cost: '40' }), db, ENV, draft);
  assert.equal(draft.calls[0].body.externalItemId, '42');
  assert.equal(draft.calls[0].body.publish, false);
  assert.equal(draft.calls[0].body.listing.shipping_type, undefined);
  assert.equal(draft.calls[0].body.listing.title, 'Changed title');

  const empty = await wbwApi(req('POST', admin, { action: 'import', seller: 'ada', ids: [8], publish: false }), db, ENV, mockFetch(() => jsonRes(200, { ok: true })));
  assert.equal(empty.results[0].kind, 'photo failure');
  assert.match(empty.results[0].message, /no usable HTTPS photos/);

  const timed = mockFetch(() => { throw Object.assign(new Error(`timed out ${KEY}`), { name: 'TimeoutError' }); });
  const timeout = await wbwApi(req('POST', admin, { action: 'import', seller: 'ada', ids: [42], publish: false }), db, ENV, timed);
  assert.equal(timeout.results[0].unconfirmed, true);
  assert.match(timeout.results[0].message, /Safe to retry/);
  assert.equal(timeout.results[0].message.includes(KEY), false);
  assert.equal(timed.calls.length, 1);

  let tries = 0;
  const rate = mockFetch(() => {
    tries += 1;
    return tries === 1 ? jsonRes(429, {}, { 'retry-after': '1' }) : jsonRes(429, {}, { 'retry-after': '9' });
  });
  const limited = await wbwApi(req('POST', admin, { action: 'import', seller: 'ada', ids: [42], publish: false }), db, ENV, rate);
  assert.equal(limited.results[0].status, 429);
  assert.match(limited.results[0].message, /Retry-After: 9/);
  assert.deepEqual(rate.sleeps, [1000]);
  assert.equal(limited.results[0].unconfirmed, false);

  await assert.rejects(() => wbwApi(req('POST', admin, { action: 'import', seller: 'ada', ids: [42], publish: true }), db, ENV, mockFetch(() => jsonRes(200, { ok: true }))), /shipping/);
  const noKey = mockFetch(() => jsonRes(200, { ok: true }));
  await assert.rejects(() => wbwApi(req('POST', admin, { action: 'import', seller: 'ada', ids: [42], publish: false }), db, { ...ENV, WBW_API_KEY: '   ' }, noKey), /WBW_API_KEY not configured/);
  assert.equal(noKey.calls.length, 0);
});

test('the external seller id is assigned once and the client never sees the key', () => {
  const source = read('lib/wbw.js');
  const rename = source.slice(source.indexOf('const from = p.rename_from'), source.indexOf('const others'));
  assert.match(rename, /update sellers set name/);
  assert.equal(rename.includes('wbw_external_id'), false);
  assert.match(source, /wbw_external_id is null/);
  assert.match(source, /add column if not exists wbw_external_id text/);
  assert.match(source, /add column if not exists wbw_listing_id text/);
  assert.match(source, /add column if not exists wbw_confirmed_at timestamptz/);
  assert.match(source, /add column if not exists wbw_needs_review boolean/);
  for (const col of ['wbw_external_id', 'wbw_seller_id', 'wbw_signed_up', 'wbw_status_checked_at'])
    assert.equal(SELLER_FIELDS.includes(col), false, col);

  const clientRoots = ['app', 'components'];
  const files = [];
  const walk = dir => {
    for (const name of readdirSync(dir)) {
      if (name === 'api' || name === 'node_modules' || name === '.next') continue;
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.(js|mjs|jsx)$/.test(name)) files.push(path);
    }
  };
  for (const root of clientRoots) walk(root);
  assert.ok(files.some(file => file.endsWith('app/screen.js')));
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    assert.equal(text.includes('WBW_API_KEY'), false, file);
    assert.equal(text.includes('lib/wbw-api'), false, file);
    assert.equal(text.includes('NEXT_PUBLIC_WBW'), false, file);
    assert.equal(text.includes(KEY), false, file);
  }
  const screen = read('app/screen.js');
  assert.match(screen, /WbwApiPanel/);
  assert.match(screen, /data-wbw-confirmed/);
  assert.match(screen, /Export CSV/);
  assert.equal(/type="checkbox"[^>]*wbw|wbw[^=]*type="checkbox"/.test(screen), false);
  assert.equal(redactSecret(`Bearer ${KEY} failed`, KEY).includes(KEY), false);
  assert.equal(read('lib/wbw-api.js').includes('console.'), false);
  assert.equal(read('app/api/wbw/route.js').includes('console.'), false);
  const built = [];
  const staticDir = new URL('../.next/static', import.meta.url);
  if (existsSync(staticDir)) {
    const walkBuilt = dir => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walkBuilt(path);
        else if (name.endsWith('.js')) built.push(path);
      }
    };
    walkBuilt(staticDir);
    for (const file of built) {
      const text = readFileSync(file, 'utf8');
      assert.equal(text.includes('WBW_API_KEY'), false, file);
      assert.equal(text.includes(KEY), false, file);
    }
  }
  assert.equal(classifyImport(409, { listingId: 'X' }).message, 'needs review');
  assert.equal(classifyImport(200, { ok: true, status: 'draft', publication: { error: 'Held' } }).kind, 'publication error');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  acceptScan, collectIds, depopSellerHandle, explainPageFailure, pageScriptEmpty, readDepopProduct, readDepopShop, rejectEmptyDepopShop, NO_FACEBOOK_LISTINGS,
} from '../extension/import-page.mjs';
import { westernBootDecision, bootScanSummary, GATE_VERSION, rejectToStore } from '../extension/boot-gate.mjs';
import { absentIds, actorForJob, allowedBootlisterOrigin, CANDIDATE_CAP, cardIsNonFootwear, cookieReadUrl, createImportLock, depopBootFilters, gateWrite, importLimit, injectionLost, JOB_DEADLINE_MAX_MS, jobSummary, navListenerArmedBeforeTabCreate, planFilteredShop, planKnownSkips, planSync, presenceIds, REJECT_BATCH, retryInjection, scanWindowOpen, scriptArgs, sessionFromCookie, shopAfterFilterError, shopReadArgs, SHOP_READ_MS, SIGNED_OUT, validateItemEnvelope, WRITE_CAP, withDeadline } from '../extension/import-job.mjs';
import { knownApi, rejectApi } from '../lib/known-api.js';
import { acceptRejectRows, matchKnown, REJECT_WRITE_CAP, visibleRejects } from '../lib/known.js';
import { IMPORT_WRITE_CAP } from '../lib/import-cap.js';
import { itemsApi } from '../lib/items-api.js';
import { nextImportCount } from '../lib/import-cap.js';
import { sessionToken } from '../lib/session.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = p => readFileSync(new URL(`../${p}`, import.meta.url));
const onsale = (slug, extra = {}) => ({
  status: 'STATUS_ONSALE', slug,
  description: `Lucchese ${slug}\nSize 10`,
  brand_name: 'Lucchese', category_name: 'Boots',
  sizes: [{ name: '0030' }],
  pricing: { final_price_key: 'original_price', original_price: { price_breakdown: { price: { amount: '125.00' } } } },
  attributes: { brand: 'lucchese', condition: 'used_good', colour: ['black'], style: ['western'], gender: 'male', is_kids: false, product_type: 'boots' },
  pictures: [
    { formats: null },
    { formats: { P1: { url: 'https://media.depop.com/small.jpg', width: 640 }, P0: { url: 'https://media.depop.com/large.jpg', width: 1280 } } },
  ],
  ...extra,
});
const SHOP = 'nuclear_nostalgia';

function installPage({ entries, pages, path = `/${SHOP}/` }) {
  const urls = [];
  let n = 0;
  globalThis.location = { hostname: 'www.depop.com', pathname: path, href: `https://www.depop.com${path}` };
  globalThis.performance = { getEntriesByType: () => entries };
  globalThis.fetch = async (url, opts = {}) => {
    urls.push(String(url));
    const body = pages[Math.min(n, pages.length - 1)];
    n += 1;
    if (opts.signal?.aborted) throw Object.assign(new Error('Aborted'), { name: 'AbortError' });
    return { ok: (body.http ?? 200) === 200, status: body.http ?? 200, json: async () => body.json };
  };
  return { urls };
}

test('a null script result is rejected before anyone reads length', () => {
  const crash = () => { const items = null; return items.length; };
  assert.throws(crash, /reading 'length'/);
  assert.throws(() => acceptScan(null, 'Depop'), e => {
    assert.match(e.message, /didn't return a result/);
    assert.equal(/reading 'length'/.test(e.message), false);
    return true;
  });
  assert.equal(/reading 'length'/.test(pageScriptEmpty('Depop')), false);
  assert.throws(() => acceptScan({ ok: true, value: null }, 'Depop'), /listing list/);
  const scan = acceptScan({ ok: true, value: [], complete: true }, 'Depop');
  assert.deepEqual(scan.items, []);
  assert.equal(scan.complete, true);
  assert.equal(acceptScan({ ok: true, value: [], complete: false }, 'Depop').complete, false);
  assert.equal(acceptScan({ ok: true, value: [] }, 'Depop').complete, false);
});

test('the script wait is bounded even when the promise never settles', async () => {
  const start = Date.now();
  await assert.rejects(withDeadline(new Promise(() => {}), 40, 'Depop read timed out'), /timed out/);
  assert.ok(Date.now() - start < 500);
});

test('Facebook error pages stay unknown unless Chrome reported a network error', () => {
  const msg = explainPageFailure({
    site: 'Facebook',
    message: 'Frame with ID 0 is showing error page',
    netError: 'net::ERR_TOO_MANY_REDIRECTS',
    pageUrl: 'https://www.facebook.com/marketplace/profile/1661843737/',
  });
  assert.match(msg, /Facebook didn't load/);
  assert.match(msg, /ERR_TOO_MANY_REDIRECTS/);
  assert.match(msg, /1661843737/);
  assert.match(msg, /can't bypass/);
  assert.match(msg, /will not clear cookies/);
  assert.match(msg, /does not fix/);
  const unknown = explainPageFailure({ site: 'Facebook', tabUrl: 'chrome-error://chromewebdata/', title: "This page isn’t working" });
  assert.match(unknown, /unknown/);
  assert.match(unknown, /does not fix/);
  assert.equal(/ERR_TOO_MANY_REDIRECTS/.test(unknown), false);
  assert.equal(explainPageFailure({ site: 'Facebook', message: 'Please log in.' }), '');
  assert.equal(explainPageFailure({ site: 'Facebook', message: msg }), '');
  assert.match(NO_FACEBOOK_LISTINGS, /Nothing was imported/);
});

const LIVE_SELLER = 'https://www.depop.com/nuclear_nostalgia/?brandIds=1667&productId=988597946';
const LIVE_PRODUCT = 'https://www.depop.com/products/nuclear_postalgia-y2k-brown-leather-western-boots-f397/';
const LIVE_SLUG = 'nuclear_postalgia-y2k-brown-leather-western-boots-f397';
const LIVE_PHOTOS = [
  'https://media-photos.depop.com/b1/6702411/5150160802_ce48a0a325d448ea86622af9e4288a67/P0.jpg',
  'https://media-photos.depop.com/b1/6702411/5150160035_f256c7c374f64970a7525a2797db0513/P0.jpg',
  'https://media-photos.depop.com/b1/6702411/5150160138_b5178623f5ae45ab89c70b8a088a5580/P0.jpg',
  'https://media-photos.depop.com/b1/6702411/5150160417_1ae8e66160474812a49664c5943e74e5/P0.jpg',
  'https://media-photos.depop.com/b1/6702411/5150160418_6183d704c5264bb6aef9707bdc10db9d/P0.jpg',
  'https://media-photos.depop.com/b1/6702411/5150160310_24e7be6729ad4e0b976db912cb3a242b/P0.jpg',
  'https://media-photos.depop.com/b1/6702411/5150159751_4e2cf8f684984515a044bcfa76e8f555/P0.jpg',
];
const LIVE_DESC = 'Y2K brown leather western boots \nWomen’s size 8 \nUsed condition has some heel drag and some scuffing \nClassic brown leather coastal cowgirl boots \n\n#western #boho #westernsleaze #indiesleaze #americana';

test('the observed Depop page supplies the listing and the slug is not the account', async () => {
  assert.equal(depopSellerHandle(LIVE_SELLER), SHOP);
  assert.equal(depopSellerHandle(LIVE_PRODUCT), '');
  assert.equal(LIVE_SLUG === SHOP || LIVE_SLUG.startsWith(`${SHOP}-`), false);
  assert.equal(readDepopShop.toString().includes('webapi.depop.com'), false);
  assert.equal(readDepopProduct.toString().includes('webapi.depop.com'), false);

  let fetched = false;
  globalThis.fetch = () => { fetched = true; };
  const listed = (href, shop) => ({ href, getAttribute: n => n === 'aria-label' ? `item listed by ${shop}` : '' });
  globalThis.location = { hostname: 'www.depop.com', pathname: `/${SHOP}/`, href: `https://www.depop.com/${SHOP}/` };
  globalThis.document = { readyState: 'complete', title: 'nuclear_nostalgia - Depop', body: {}, querySelectorAll: () => [
    { href: 'https://www.depop.com/products/related-card-p10/', getAttribute: () => '' },
    listed(LIVE_PRODUCT, SHOP),
    listed(LIVE_PRODUCT, SHOP),
    listed('https://www.depop.com/products/benny-caiman-western/', SHOP),
    listed('https://www.depop.com/products/corral-flaming-skull/', SHOP),
    listed('https://www.depop.com/products/rivers-eel/', SHOP),
    listed('https://www.depop.com/products/nocona-boots/', SHOP),
    listed('https://www.depop.com/products/old-west-suede/', SHOP),
    listed('https://www.depop.com/products/not-this-shop/', 'someone_else'),
  ] };
  const shop = await readDepopShop(SHOP, Date.now(), 9);
  assert.equal(fetched, false);
  assert.equal(shop.ok, true);
  assert.equal(shop.complete, false);
  assert.deepEqual(shop.productUrls, [
    LIVE_PRODUCT,
    'https://www.depop.com/products/benny-caiman-western/',
    'https://www.depop.com/products/corral-flaming-skull/',
    'https://www.depop.com/products/rivers-eel/',
    'https://www.depop.com/products/nocona-boots/',
    'https://www.depop.com/products/old-west-suede/',
  ]);
  assert.match(shop.reason, /6 candidate links queued in page order for a western-boot check \(scan cap 9\)/);
  assert.match(shop.reason, /Sync will not remove listings/);
  assert.match(shop.reason, /Exact label "item listed by nuclear_nostalgia": 7/);
  assert.match(shop.reason, /Shop scroll hit its read limit before the grid settled/);
  assert.match(shop.reason, /may not be the whole shop/);
  assert.equal(shop.limitHit, true);
  assert.deepEqual(JSON.parse(JSON.stringify(shop)), shop);
  assert.deepEqual(rejectEmptyDepopShop(shop, SHOP), shop.productUrls);

  const json = {
    name: 'Y2K brown leather western boots \nWomen’s size 8...',
    description: LIVE_DESC,
    '@type': 'Product',
    image: [...LIVE_PHOTOS],
    brand: { '@type': 'Brand', name: 'Other' },
    offers: { priceCurrency: 'USD', price: '50.00', availability: 'https://schema.org/InStock', itemCondition: 'https://schema.org/UsedCondition' },
  };
  globalThis.location = { hostname: 'www.depop.com', pathname: `/products/${LIVE_SLUG}/`, href: LIVE_PRODUCT };
  globalThis.document = {
    querySelector(sel) {
      if (sel === 'script[data-testid="meta__jsonLd"]')
        return { textContent: JSON.stringify(json), getAttribute: n => n === 'type' ? 'application/ld+json' : '' };
      if (sel === 'h1') return { textContent: "Women's Brown and Black Boots" };
      if (sel === '[data-testid="productPrimaryAttributes"]')
        return { querySelectorAll: () => [{ textContent: 'Size US 8' }, { textContent: 'Fair condition' }] };
      return null;
    },
    querySelectorAll: () => [
      { href: LIVE_SELLER, getAttribute: () => null },
      { href: LIVE_SELLER, getAttribute: n => n === 'aria-label' ? "nuclear_nostalgia's shop" : null },
    ],
  };
  const bound = await readDepopProduct(SHOP, Date.now() + 1000);
  assert.equal(bound.ok, true);
  assert.equal(bound.complete, false);
  const item = bound.value[0];
  assert.equal(item.source_id, LIVE_SLUG);
  assert.equal(item.title, 'Y2K brown leather western boots');
  assert.equal(item.title.includes("Women's Brown"), false);
  assert.equal(item.description, LIVE_DESC);
  assert.match(item.description, /#americana/);
  assert.equal(item.price, '50.00');
  assert.equal(item.size, 'US 8');
  assert.equal(item.condition, 'Fair');
  assert.equal(item.sized_for, 'Women');
  assert.equal(item.brand, null);
  assert.deepEqual(item.photos, LIVE_PHOTOS);
  assert.equal(item.photos.some(p => p.includes('/U1.jpg') || p.includes('/P10.jpg') || p.includes('/P8.jpg')), false);
  assert.match(bound.reason, /generated heading/);
  assert.match(bound.reason, /truncated/);
  assert.match(bound.reason, /USD/);
  assert.equal(validateItemEnvelope(item, { source: 'depop', expectedId: LIVE_SLUG })?.price, '50.00');

  globalThis.document = { querySelectorAll: () => [{ href: 'https://www.depop.com/someone_else/' }], querySelector: () => null };
  const unresolved = await readDepopProduct(SHOP, Date.now() + 1000);
  assert.equal(unresolved.ok, false);
  assert.match(unresolved.error, /unresolved/);

  globalThis.location = { hostname: 'www.depop.com', pathname: '/other_shop/', href: 'https://www.depop.com/other_shop/' };
  const off = await readDepopShop(SHOP, Date.now() + 1000, 2);
  assert.match(off.error, /not the requested Depop shop/);
  assert.equal(fetched, false);
  assert.equal(planSync(true, true, [LIVE_SLUG], true).sync, false);
});

test('a Depop shop with no candidate anchors fails instead of importing nothing', async () => {
  const listed = (href, shop) => ({ href, getAttribute: n => n === 'aria-label' ? `item listed by ${shop}` : '' });
  globalThis.location = { hostname: 'www.depop.com', pathname: `/${SHOP}/`, href: `https://www.depop.com/${SHOP}/` };
  globalThis.document = {
    readyState: 'complete', title: 'nuclear_nostalgia - Depop', body: {},
    querySelectorAll() { return []; },
  };
  const empty = await readDepopShop(SHOP, Date.now() + 500, 2);
  assert.equal(empty.ok, false);
  assert.equal(empty.complete, false);
  assert.match(empty.error, /incomplete or unrecognized page, not a finished import/);
  assert.match(empty.error, /Product anchors 0/);
  assert.match(empty.error, /Exact label "item listed by nuclear_nostalgia": 0/);
  assert.match(empty.error, /readyState complete/);
  assert.match(empty.error, /Sample product aria-labels: \(none\)/);
  assert.match(empty.error, /Nothing was imported/);
  assert.equal(JSON.stringify(empty).includes('0 new'), false);
  assert.throws(() => acceptScan(empty, 'Depop'), e => { assert.match(e.message, /Product anchors 0/); return true; });
  assert.throws(() => rejectEmptyDepopShop({ productUrls: [], reason: empty.error }, SHOP), /Nothing was imported/);

  globalThis.document = {
    readyState: 'interactive', title: 'Just a moment', body: {},
    querySelectorAll(sel) {
      if (sel !== 'a[href*="/products/"]') return [];
      return [{ href: 'https://www.depop.com/products/other-item/', getAttribute: () => 'item listed by someone_else' }];
    },
  };
  const wrong = await readDepopShop(SHOP, Date.now() + 300, 2);
  assert.equal(wrong.ok, false);
  assert.match(wrong.error, /Product anchors 1/);
  assert.match(wrong.error, /Exact label "item listed by nuclear_nostalgia": 0/);
  assert.match(wrong.error, /item listed by someone_else/);
  assert.equal(wrong.productUrls, undefined);

  const anchor = listed(LIVE_PRODUCT, SHOP);
  const shadow = { querySelectorAll(sel) { return sel === 'a[href*="/products/"]' ? [anchor] : []; } };
  globalThis.document = {
    readyState: 'complete', title: 'nuclear_nostalgia - Depop', body: {},
    querySelectorAll(sel) { return sel === '*' ? [{ shadowRoot: shadow }] : []; },
  };
  const hidden = await readDepopShop(SHOP, Date.now(), 2);
  assert.deepEqual(hidden.productUrls, [LIVE_PRODUCT]);
  assert.match(hidden.reason, /Open shadow roots walked: 1/);

  let passes = 0;
  globalThis.document = {
    readyState: 'loading', title: 'nuclear_nostalgia - Depop', body: {},
    querySelectorAll(sel) {
      if (sel !== 'a[href*="/products/"]') return [];
      passes += 1;
      if (passes < 2) return [];
      return [listed(LIVE_PRODUCT, SHOP), listed('https://www.depop.com/products/benny-caiman-western/', SHOP)];
    },
  };
  const late = await readDepopShop(SHOP, Date.now() + 2000, 2, { pauseMs: 30, settle: 2 });
  assert.ok(passes >= 2);
  assert.deepEqual(late.productUrls, [LIVE_PRODUCT, 'https://www.depop.com/products/benny-caiman-western/']);
  assert.equal(late.complete, false);

  let phase = 0;
  const link = href => ({ href, getAttribute: () => `item listed by ${SHOP}`, scrollIntoView() { phase = 1; } });
  globalThis.location = { hostname: 'www.depop.com', pathname: `/${SHOP}/`, href: `https://www.depop.com/${SHOP}/` };
  globalThis.document = {
    readyState: 'complete', title: 'shop', body: {},
    querySelectorAll(sel) {
      if (sel !== 'a[href*="/products/"]') return [];
      const rows = [link('https://www.depop.com/products/first-boot/')];
      if (phase) rows.push(link('https://www.depop.com/products/second-boot/'));
      return rows;
    },
  };
  const grown = await readDepopShop(SHOP, Date.now() + 2000, 10, { pauseMs: 20, settle: 5 });
  assert.deepEqual(grown.productUrls, [
    'https://www.depop.com/products/first-boot/',
    'https://www.depop.com/products/second-boot/',
  ]);
  assert.equal(grown.partial, false);
});

test('a truncated description line is not replaced with the generated heading', async () => {
  globalThis.location = { hostname: 'www.depop.com', pathname: `/products/${LIVE_SLUG}/`, href: LIVE_PRODUCT };
  globalThis.document = {
    querySelector(sel) {
      if (sel === 'script[data-testid="meta__jsonLd"]') return {
        textContent: JSON.stringify({
          name: 'Y2K brown leather western boots...', description: 'Y2K brown leather western boots...\nrest',
          '@type': 'Product', image: LIVE_PHOTOS, brand: { name: 'Other' },
          offers: { price: '50.00', priceCurrency: 'USD', availability: 'https://schema.org/InStock' },
        }),
        getAttribute: n => n === 'type' ? 'application/ld+json' : '',
      };
      if (sel === 'h1') return { textContent: "Women's Brown and Black Boots" };
      if (sel === '[data-testid="productPrimaryAttributes"]') return { querySelectorAll: () => [] };
      return null;
    },
    querySelectorAll: () => [{ href: LIVE_SELLER, getAttribute: n => n === 'aria-label' ? "nuclear_nostalgia's shop" : '' }],
  };
  const bad = await readDepopProduct(SHOP, Date.now() + 1000);
  assert.equal(bad.ok, false);
  assert.equal(bad.value, undefined);
  assert.match(bad.error, /not stored as the title/);
  assert.equal(/title = generated/.test(readDepopProduct.toString()), false);
});

test('a nav link to the shop is not the seller anchor', async () => {
  globalThis.location = { hostname: 'www.depop.com', pathname: `/products/${LIVE_SLUG}/`, href: LIVE_PRODUCT };
  globalThis.document = {
    querySelectorAll: () => [{ href: 'https://www.depop.com/nuclear_nostalgia/', getAttribute: () => 'Home' }],
    querySelector: () => { throw new Error('should not read the product'); },
  };
  const decoy = await readDepopProduct(SHOP, Date.now() + 1000);
  assert.equal(decoy.ok, false);
  assert.match(decoy.error, /unresolved/);
});

test('one import job can create two listings and not a third', async () => {
  assert.throws(() => nextImportCount(0, '1'), /missing its job/);
  const jobA = crypto.randomUUID();
  const jobB = crypto.randomUUID();
  assert.equal(nextImportCount(0, jobA, 2), 1);
  assert.equal(nextImportCount(1, jobA, 2), 2);
  assert.throws(() => nextImportCount(2, jobA, 2), /2 listing writes/);
  assert.equal(nextImportCount(2, jobA, 100), 3);
  const secret = 'signing-secret';
  const token = await sessionToken('admin', secret);
  const env = { NODE_ENV: 'production', ADMIN_PASSWORD: 'staff-secret', APP_PASSWORD: secret };
  const counts = new Map();
  const db = {
    async claimImportWrite(seller, job, limit) {
      const key = `${seller}\n${String(job || '').trim()}`;
      counts.set(key, nextImportCount(counts.get(key) || 0, job, limit));
    },
    async createItem(seller, raw) { return { id: raw.source_id, seller }; },
  };
  const call = (job, id, source = 'depop') => itemsApi({
    method: 'POST', url: 'http://localhost/api/items',
    headers: { get(name) {
      const key = String(name).toLowerCase();
      if (key === 'x-auth') return token;
      if (key === 'x-import-job') return job;
      if (key === 'x-import-limit') return '2';
      if (key === 'authorization') return 'Bearer import-test';
      return '';
    } },
    json: async () => ({ source, source_id: id, title: 'Lucchese cowboy boots', description: 'Lucchese cowboy boots\nSize 10', price: '50.00', photos: ['https://example.test/a.jpg'] }),
  }, db, env);
  assert.equal((await call(jobA, 'one')).item.id, 'one');
  assert.equal((await call(jobA, 'two')).item.id, 'two');
  await assert.rejects(() => call(jobA, 'three'), /2 listing writes/);
  assert.equal((await call(jobB, 'three')).item.id, 'three');
  await assert.rejects(() => call('1', 'four'), /missing its job/);
  assert.equal(read('lib/items-api.js').toString().includes('new Map'), false);
});

test('a clear boot title is not rejected by heel caps or later bag words', () => {
  const shrunken = {
    source_id: 'nuclearanostalgia-tony-lama-vintage-90s-shrunken-b50c',
    title: 'TONY LAMA vintage 90s shrunken bull shoulder western boots',
    description: `TONY LAMA vintage 90s shrunken bull shoulder western boots
Men's size 13 D
has some cracking in the footbed that isn't photographable but some good cushioned insoles would help a lot
The heel caps have been replaced to extend the life of the boots
Classic black leather western boots featuring shrunken bull shoulder vamps
Made in USA

#western #westernsleaze #indiesleaze #tonylama #americana`,
  };
  const cherry = {
    source_id: 'nucletr_nostalgia-tony-lama-vintage-80s-black-100f',
    title: 'TONY LAMA vintage 80s black cherry western boots',
    description: `TONY LAMA vintage 80s black cherry western boots
Men's size 11 D
Used condition has some minor cracks on the leather near the toes (the cracks do not go through) and the heel caps have been replaced to extend the life of the boots
Absolutely stunning handcrafted cowboy boots in a beautiful black cherry colorway
Made in USA

#tonylama #western #westernsleaze #indiesleaze #americana`,
  };
  for (const item of [shrunken, cherry]) {
    const decision = westernBootDecision(item);
    assert.equal(decision.eligible, true, item.source_id);
    assert.equal(decision.kind, 'western-boot');
    assert.match(decision.reason, /slug was not used/);
  }
  assert.equal(westernBootDecision({ ...shrunken, description: `${shrunken.description}\n#bag #wallet` }).eligible, true);
  assert.equal(westernBootDecision({
    title: 'DAN POST vintage 70s teju western boots',
    description: 'DAN POST vintage 70s teju western boots\nThe heel caps have been replaced to extend the life of the boots\n#wallet',
    source_id: 'nuc9ear_nostalgia-dan-post-vintage-70s-teju-049c',
  }).eligible, true);
  assert.equal(westernBootDecision({
    title: 'JUSTIN vintage 90s square toe western boots',
    description: 'JUSTIN vintage 90s square toe western boots\nThe heel caps have been replaced\ncomes with a dust bag',
    source_id: 'nuclear_nostylgia-justin-vintage-90s-square-toe-6c31',
  }).eligible, true);
  assert.equal(westernBootDecision({ title: 'STAUD ida tote bag', description: 'cowboy boots in the photo\n#westernboots' }).kind, 'non-footwear');
  assert.equal(westernBootDecision({ title: 'Leather wallet', description: 'Tony Lama cowboy boots' }).eligible, false);
  const buckle = westernBootDecision({ title: '1970s vintage cowboy boot belt buckle', description: '1970s vintage cowboy boot belt buckle\n$25', price: '25' });
  assert.equal(buckle.eligible, false);
  assert.equal(buckle.kind, 'non-footwear');
  for (const title of ['boot charm', 'boot jack', 'boot bag', 'cowboy boot bolo']) {
    assert.equal(westernBootDecision({ title, description: title }).eligible, false, title);
  }
  const summary = bootScanSummary({ scanned: 57, candidates: 72, eligible: 38, skipped: { 'non-footwear': 8, uncertain: 1, already: 15 }, writeCap: 100 });
  assert.match(summary, /15 already imported \(skipped\)/);
  assert.match(summary, /Skipped 8 non-footwear, 0 other footwear, 1 uncertain, 0 unread/);
});

test('a settled shop stops after five quiet scrolls and does not use the whole read budget', async () => {
  let scrolls = 0;
  globalThis.window = { scrollTo() { scrolls += 1; }, scrollBy() {} };
  const link = href => ({ href, getAttribute: () => `item listed by ${SHOP}`, scrollIntoView() {} });
  const links = Array.from({ length: 24 }, (_, i) => link(`https://www.depop.com/products/settled-${i}-boot/`));
  globalThis.location = { hostname: 'www.depop.com', pathname: `/${SHOP}/`, href: `https://www.depop.com/${SHOP}/` };
  globalThis.document = {
    readyState: 'complete', title: 'shop', body: { scrollHeight: 4000 },
    querySelectorAll(sel) { return sel === 'a[href*="/products/"]' ? links : []; },
  };
  const started = Date.now();
  const shop = await readDepopShop(SHOP, started + SHOP_READ_MS, 400, { pauseMs: 10, settle: 5 });
  delete globalThis.window;
  assert.equal(shop.ok, true);
  assert.equal(shop.partial, false);
  assert.equal(shop.limitHit, false);
  assert.equal(shop.productUrls.length, 24);
  assert.equal(scrolls, 5);
  assert.match(shop.reason, /visible shop grid stopped growing/);
  assert.ok(Date.now() - started < 1000);
});

test('the shop keeps scrolling past the first screen of links', async () => {
  let pages = 1;
  globalThis.window = { scrollTo() { pages = 2; } };
  const link = href => ({ href, getAttribute: () => `item listed by ${SHOP}`, scrollIntoView() {} });
  const batch = (n, prefix) => Array.from({ length: n }, (_, i) => link(`https://www.depop.com/products/${prefix}-${i}-boot/`));
  globalThis.location = { hostname: 'www.depop.com', pathname: `/${SHOP}/`, href: `https://www.depop.com/${SHOP}/` };
  globalThis.document = {
    readyState: 'complete', title: 'shop', body: { scrollHeight: 8000 },
    querySelectorAll(sel) {
      if (sel !== 'a[href*="/products/"]') return [];
      return pages === 1 ? batch(24, 'first') : [...batch(24, 'first'), ...batch(24, 'next')];
    },
  };
  const shop = await readDepopShop(SHOP, Date.now() + 3000, 400, { pauseMs: 20, settle: 5 });
  delete globalThis.window;
  assert.equal(shop.productUrls.length, 48);
  assert.equal(shop.partial, false);
  assert.match(shop.reason, /visible shop grid stopped growing/);
});

test('a slow shop page is not treated as finished before later cards load', async () => {
  let scrolls = 0;
  globalThis.window = {
    scrollTo() { scrolls += 1; },
    scrollBy() {},
  };
  const link = href => ({ href, getAttribute: () => `item listed by ${SHOP}`, scrollIntoView() {} });
  const batch = (n, prefix) => Array.from({ length: n }, (_, i) => link(`https://www.depop.com/products/${prefix}-${i}-boot/`));
  globalThis.location = { hostname: 'www.depop.com', pathname: `/${SHOP}/`, href: `https://www.depop.com/${SHOP}/` };
  globalThis.document = {
    readyState: 'complete', title: 'shop', body: { scrollHeight: 9000 },
    querySelectorAll(sel) {
      if (sel !== 'a[href*="/products/"]') return [];
      return scrolls >= 4 ? [...batch(24, 'first'), ...batch(24, 'later')] : batch(24, 'first');
    },
  };
  const shop = await readDepopShop(SHOP, Date.now() + 5000, 400, { pauseMs: 15, settle: 5 });
  delete globalThis.window;
  assert.ok(scrolls >= 4);
  assert.equal(shop.productUrls.length, 48);
  assert.equal(shop.partial, false);
  assert.match(shop.reason, /visible shop grid stopped growing/);
});

test('sold-section links are not queued', async () => {
  const selling = { href: 'https://www.depop.com/products/selling-boot/', getAttribute: () => `item listed by ${SHOP}`, scrollIntoView() {}, afterSold: false };
  const sold = { href: 'https://www.depop.com/products/sold-boot/', getAttribute: () => `item listed by ${SHOP}`, scrollIntoView() {}, afterSold: true };
  const heading = { textContent: 'Sold items', compareDocumentPosition: node => node.afterSold ? 4 : 0 };
  globalThis.location = { hostname: 'www.depop.com', pathname: `/${SHOP}/`, href: `https://www.depop.com/${SHOP}/` };
  globalThis.document = {
    readyState: 'complete', title: 'shop', body: {},
    querySelectorAll(sel) {
      if (String(sel).includes('h1')) return [heading];
      if (sel === 'a[href*="/products/"]') return [selling, sold];
      return [];
    },
  };
  const shop = await readDepopShop(SHOP, Date.now() + 2000, 400, { pauseMs: 20, settle: 5 });
  assert.deepEqual(shop.productUrls, ['https://www.depop.com/products/selling-boot/']);
  assert.equal(shop.partial, false);
  assert.match(shop.reason, /Sold items/);
  assert.match(shop.reason, /Sold-section links skipped: 1/);
  assert.equal(shop.reason.includes('visible shop grid stopped growing'), false);
});

test('only cowboy or western boots are eligible, and bags ahead of boots are skipped', async () => {
  const briefcase = { title: 'COACH Hamilton sport calf leather briefcase', description: 'COACH Hamilton sport calf leather briefcase', source_id: 'western-cowboy-boots-slug' };
  const tote = { title: 'STAUD ida tote bag', description: 'STAUD ida tote bag\n$150', source_id: 'boots' };
  const sneaker = { title: 'Black leather sneakers', description: 'Black leather sneakers\nSize 8' };
  const heels = { title: 'Leather high heels', description: 'Leather high heels\nSize 8' };
  const hiking = { title: 'Hiking boots', description: 'Hiking boots\nSize 10' };
  const jeans = { title: 'Bootcut jeans', description: 'Bootcut jeans' };
  const boot = { title: 'Y2K brown leather western boots', description: LIVE_DESC, source_id: 'not-a-boot-slug' };
  const second = { title: 'Lucchese cowboy boots', description: 'Lucchese cowboy boots\nMen shoe size 10', source_id: 'tote-bag' };
  const third = { title: 'Roper boots', description: 'Vintage roper boots\nSize 9' };
  for (const bag of [briefcase, tote]) {
    const decision = westernBootDecision(bag);
    assert.equal(decision.eligible, false);
    assert.equal(decision.kind, 'non-footwear');
    assert.match(decision.reason, /slug was not used/);
  }
  assert.equal(westernBootDecision(sneaker).kind, 'other-footwear');
  assert.equal(westernBootDecision(heels).kind, 'other-footwear');
  assert.equal(westernBootDecision(hiking).kind, 'uncertain');
  assert.equal(westernBootDecision(jeans).eligible, false);
  assert.equal(westernBootDecision({ title: 'Listing', description: 'Nice leather', source_id: 'y2k-western-cowboy-boots' }).eligible, false);
  assert.equal(westernBootDecision(boot).eligible, true);
  assert.equal(westernBootDecision(second).eligible, true);
  const secret = 'signing-secret';
  const token = await sessionToken('admin', secret);
  const env = { NODE_ENV: 'production', ADMIN_PASSWORD: 'staff-secret', APP_PASSWORD: secret };
  const calls = { claim: 0, create: 0 };
  const db = {
    async claimImportWrite() { calls.claim += 1; },
    async createItem(_seller, raw) { calls.create += 1; raw.sized_for = 'Men'; raw.material_cut = 'Shoulder'; return { id: 'should-not' }; },
  };
  const post = body => itemsApi({
    method: 'POST', url: 'http://localhost/api/items',
    headers: { get(name) {
      const key = String(name).toLowerCase();
      if (key === 'x-auth') return token;
      if (key === 'x-import-job') return crypto.randomUUID();
      if (key === 'authorization') return 'Bearer import-test';
      return '';
    } },
    json: async () => body,
  }, db, env);
  await assert.rejects(() => post({ ...briefcase, source: 'depop', price: '100', photos: ['https://example.test/a.jpg'] }), /non-footwear/);
  assert.equal(calls.claim, 0);
  assert.equal(calls.create, 0);
  const saved = await post({ ...boot, source: 'depop', price: '50.00', photos: ['https://example.test/a.jpg'] });
  assert.equal(saved.item.id, 'should-not');
  assert.equal(calls.claim, 1);
  assert.equal(calls.create, 1);
  db.unchangedImport = (_seller, raw) => raw.source_id === boot.source_id;
  const again = await post({ ...boot, source: 'depop', price: '50.00', photos: ['https://example.test/a.jpg'] });
  assert.equal(again.duplicate, true);
  assert.equal(again.item, null);
  assert.equal(calls.claim, 1);
  assert.equal(calls.create, 1);

  const order = [briefcase, tote, sneaker, boot, second, third];
  const skipped = { 'non-footwear': 0, 'other-footwear': 0, uncertain: 0, unread: 0 };
  const eligible = [];
  let scanned = 0;
  for (const item of order) {
    if (eligible.length >= 2) break;
    if (!scanWindowOpen(Date.now() + 120000)) break;
    scanned += 1;
    const decision = westernBootDecision(item);
    if (!decision.eligible) { skipped[decision.kind] += 1; continue; }
    eligible.push(item);
  }
  assert.deepEqual(eligible.map(i => i.title), ['Y2K brown leather western boots', 'Lucchese cowboy boots']);
  assert.equal(scanned, 5);
  assert.equal(order.length - scanned, 1);
  assert.deepEqual(skipped, { 'non-footwear': 2, 'other-footwear': 1, uncertain: 0, unread: 0 });
  const summary = bootScanSummary({ scanned, candidates: order.length, eligible: eligible.length, unopened: order.length - scanned, skipped, writeCap: 2, partial: true });
  assert.match(summary, /Scanned 5 of 6/);
  assert.match(summary, /Skipped 2 non-footwear, 1 other footwear, 0 uncertain/);
  assert.match(summary, /Eligible western boots: 2/);
  assert.match(summary, /1 candidate link was not opened/);
  assert.match(summary, /Import limit 2/);
  assert.match(summary, /Partial coverage/);
  assert.equal(scanWindowOpen(Date.now() + 1000), false);
});

test('the extension uses the site session and refuses a hostile origin', () => {
  assert.equal(cookieReadUrl('https://evil.example/phish'), '');
  assert.equal(cookieReadUrl('https://bootlister.vercel.app.evil.example/'), '');
  assert.equal(allowedBootlisterOrigin('https://not-bootlister.example'), '');
  assert.equal(cookieReadUrl('https://bootlister.vercel.app/inventory'), 'https://bootlister.vercel.app/');
  const signedOut = sessionFromCookie('https://wbw-lister.vercel.app', '');
  assert.equal(signedOut.ok, false);
  assert.equal(signedOut.error, SIGNED_OUT);
  assert.equal(signedOut.signIn, 'https://wbw-lister.vercel.app/login');
  const hostile = sessionFromCookie('https://evil.example', 'stolen');
  assert.match(hostile.error, /not a BootLister site/);
  assert.equal(hostile.token, undefined);
  const input = { origin: 'https://bootlister.vercel.app', token: 'site-session', role: 'seller', ownSeller: 'ada', requestedSeller: 'other' };
  const sellerJob = actorForJob(input);
  input.token = 'changed';
  assert.equal(sellerJob.seller, 'ada');
  assert.equal(sellerJob.token, 'site-session');
  assert.equal(actorForJob({ origin: 'https://bootlister.vercel.app', token: 'site-session', role: 'admin', requestedSeller: 'Ada Boots' }).seller, 'ada boots');
  assert.match(actorForJob({ origin: 'https://evil.example', token: 'x', role: 'admin', requestedSeller: 'ada' }).error, /not a BootLister site/);
  assert.equal(actorForJob({ origin: 'https://bootlister.vercel.app', token: '', role: 'admin', requestedSeller: 'ada' }).signIn, 'https://bootlister.vercel.app/login');
});

test('the import limit, worker envelope, and job deadline gate writes', () => {
  assert.equal(importLimit(undefined), 100);
  assert.equal(importLimit(''), 100);
  assert.equal(importLimit(9), 9);
  assert.equal(importLimit(1), 1);
  assert.equal(importLimit('2'), 2);
  assert.equal(importLimit(400), 100);
  const good = {
    source: 'depop', source_id: LIVE_SLUG, source_url: `https://www.depop.com/products/${LIVE_SLUG}/`,
    title: "Women's Brown and Black Boots", description: '', price: '50.00', photos: ['https://media.example/boot-0.jpg'],
  };
  assert.equal(validateItemEnvelope(good, { source: 'depop', expectedId: LIVE_SLUG })?.source_id, LIVE_SLUG);
  assert.equal(validateItemEnvelope({ ...good, photos: ['http://media.example/boot.jpg'] }, { source: 'depop', expectedId: LIVE_SLUG }), null);
  assert.equal(validateItemEnvelope({ ...good, source_id: '988597946' }, { source: 'depop', expectedId: LIVE_SLUG }), null);
  assert.equal(validateItemEnvelope({ ...good, photos: Array.from({ length: 31 }, (_, i) => `https://media.example/${i}.jpg`) }, { source: 'depop', expectedId: LIVE_SLUG }), null);
  const fb = validateItemEnvelope({
    source: 'facebook', source_id: '100000111', source_url: 'https://www.facebook.com/marketplace/item/100000111/',
    title: 'Boots', description: '', photos: ['https://example.test/a.jpg'],
  }, { source: 'facebook', expectedId: '100000111' });
  assert.equal(fb?.source_id, '100000111');
  assert.equal(validateItemEnvelope(fb, { source: 'facebook', expectedId: '100000222' }), null);
  assert.equal(gateWrite({ deadline: Date.now() + 1000, written: 2, cap: 9 }).ok, true);
  assert.equal(gateWrite({ deadline: Date.now() + 1000, written: 9, cap: 9 }).ok, false);
  assert.match(gateWrite({ deadline: Date.now() + 1000, written: 2, cap: 2 }).reason, /Import limit is 2/);
  assert.equal(gateWrite({ deadline: Date.now() - 1, written: 0, cap: 2 }).ok, false);
  assert.match(gateWrite({ deadline: Date.now() - 1, written: 0, cap: 2 }).reason, /time limit/);
  const lock = createImportLock();
  const job = lock.begin({ server: 'https://bootlister.vercel.app', seller: 'import-test', token: '', tokenServer: 'https://bootlister.vercel.app', limit: 400, deadline: Date.now() + 999999999 });
  assert.equal(job.job.limit, 100);
  assert.ok(job.job.deadline <= Date.now() + JOB_DEADLINE_MAX_MS);
  assert.ok(job.job.deadline > Date.now() + JOB_DEADLINE_MAX_MS - 5000);
  const started = job.job.started;
  lock.extendDeadline(job.job.id, 6);
  assert.ok(lock.job.deadline > Date.now() + 60000);
  assert.ok(lock.job.deadline < started + JOB_DEADLINE_MAX_MS);
  lock.end(job.job.id);
});

test('Facebook profile scan fails closed without the profile dialog', async () => {
  const calls = { docAll: 0 };
  globalThis.location = { hostname: 'www.facebook.com', pathname: '/marketplace/profile/1661843737/', href: 'https://www.facebook.com/marketplace/profile/1661843737/' };
  globalThis.document = {
    querySelector() { return null; },
    querySelectorAll() { calls.docAll += 1; throw new Error('scanned the whole document'); },
  };
  const missing = await collectIds('1661843737', Date.now() + 1000, 0);
  assert.equal(missing.ok, false);
  assert.equal(missing.complete, false);
  assert.match(missing.error, /dialog/);
  assert.equal(calls.docAll, 0);

  globalThis.location.pathname = '/marketplace/profile/999/';
  const other = await collectIds('1661843737', Date.now() + 1000, 0);
  assert.match(other.error, /not the requested Facebook profile/);

  const dialogLinks = [
    { href: 'https://www.facebook.com/marketplace/item/100000111/', scrollIntoView() {} },
    { href: 'https://www.facebook.com/marketplace/item/100000111/', scrollIntoView() {} },
    { href: 'https://www.facebook.com/marketplace/?ref=feed', scrollIntoView() {} },
  ];
  globalThis.location.pathname = '/marketplace/profile/1661843737/';
  globalThis.document = {
    querySelector(sel) { return sel === '[role="dialog"]' ? { querySelectorAll: () => dialogLinks } : null; },
    querySelectorAll() { calls.docAll += 1; throw new Error('scanned the whole document'); },
  };
  const found = await collectIds('1661843737', Date.now() + 1000, 0);
  assert.equal(found.ok, true);
  assert.equal(found.complete, false);
  assert.match(found.reason, /does not prove every listing/);
  assert.deepEqual(found.value, ['100000111']);
  assert.equal(calls.docAll, 0);
});

test('one import lock covers every entry and ignores later setting changes', () => {
  const lock = createImportLock();
  const req = { server: 'https://bootlister.vercel.app/', seller: 'Import-Test', token: 'secret', tokenServer: 'https://bootlister.vercel.app' };
  const first = lock.begin(req);
  req.seller = 'other-seller';
  req.token = 'changed';
  req.server = 'https://evil.example';
  assert.equal(lock.auth().seller, 'import-test');
  assert.equal(lock.auth().server, 'https://bootlister.vercel.app');
  assert.equal(lock.auth().headers.Authorization, 'Bearer import-test');
  assert.equal(lock.auth().headers['x-auth'], 'secret');
  for (const entry of ['link', 'listing', 'context']) {
    const again = lock.begin({ server: 'https://bootlister.vercel.app', seller: entry, token: 'x', tokenServer: 'https://bootlister.vercel.app' });
    assert.match(again.error, /already running/, entry);
  }
  assert.equal(lock.job.seller, 'import-test');
  assert.match(first.job.id, /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  lock.end('1');
  assert.equal(lock.job.id, first.job.id);
  lock.end(first.job.id);
  assert.equal(lock.job, null);
  const mismatched = createImportLock().begin({ server: 'https://evil.example', seller: 'a', token: 'secret', tokenServer: 'https://bootlister.vercel.app' });
  assert.equal(mismatched.job.token, '');
});

test('known links are seller-scoped, and a session is required', async () => {
  const secret = 'signing-secret';
  const env = { NODE_ENV: 'production', ADMIN_PASSWORD: 'staff-secret', APP_PASSWORD: secret };
  const rows = [
    { seller: 'ada', source: 'depop', source_id: 'stored-a', source_url: 'https://www.depop.com/products/shop-slug-a/' },
    { seller: 'bob', source: 'depop', source_id: 'slug-b', source_url: 'https://www.depop.com/products/slug-b/' },
  ];
  const rejects = [
    { seller: 'ada', source: 'depop', source_id: 'ada-bag', source_url: 'https://www.depop.com/products/ada-bag/', gate_version: GATE_VERSION },
    { seller: 'bob', source: 'depop', source_id: 'bob-bag', source_url: 'https://www.depop.com/products/bob-bag/', gate_version: GATE_VERSION },
    { seller: 'ada', source: 'depop', source_id: 'ada-old', source_url: 'https://www.depop.com/products/ada-old/', gate_version: GATE_VERSION - 1 },
  ];
  const db = {
    async knownImports(seller, source, candidates) {
      const mine = row => row.seller === seller && row.source === source;
      return {
        ...matchKnown(rows.filter(mine), candidates),
        rejected: matchKnown(visibleRejects(rejects.filter(mine), GATE_VERSION), candidates).known,
      };
    },
  };
  const candidates = [
    { id: 'shop-slug-a', url: 'https://www.depop.com/products/shop-slug-a/' },
    { id: 'slug-b', url: 'https://www.depop.com/products/slug-b/' },
    { id: 'ada-bag', url: 'https://www.depop.com/products/ada-bag/' },
    { id: 'bob-bag', url: 'https://www.depop.com/products/bob-bag/' },
    { id: 'ada-old', url: 'https://www.depop.com/products/ada-old/' },
  ];
  const call = (token, authorization) => knownApi({
    method: 'POST', url: 'http://localhost/api/import/known',
    headers: { get(name) {
      const key = String(name).toLowerCase();
      if (key === 'x-auth') return token;
      if (key === 'authorization') return authorization;
      return '';
    } },
    json: async () => ({ source: 'depop', candidates }),
  }, db, env);
  await assert.rejects(() => call('', ''), /log in/);
  const ada = await sessionToken('seller:ada', secret);
  await assert.rejects(() => call(ada, 'Bearer bob'), /own items/);
  const own = await call(ada, '');
  assert.deepEqual(own.known.map(k => k.source_id), ['stored-a']);
  assert.equal(own.known[0].id, 'shop-slug-a');
  assert.deepEqual(own.rejected.map(k => k.source_id), ['ada-bag']);
  assert.equal(own.rejected.some(k => k.source_id === 'bob-bag' || k.source_id === 'ada-old'), false);
  const admin = await sessionToken('admin', secret);
  const bobs = await call(admin, 'Bearer bob');
  assert.deepEqual(bobs.known.map(k => k.source_id), ['slug-b']);
  assert.deepEqual(bobs.rejected.map(k => k.source_id), ['bob-bag']);
  assert.equal(bobs.rejected.some(k => k.source_id === 'ada-bag'), false);
});

test('already imported links are not reopened unless re-check is on, and skipped links are not gone', () => {
  assert.equal(WRITE_CAP, 100);
  assert.equal(CANDIDATE_CAP, 400);
  assert.equal(IMPORT_WRITE_CAP, 100);
  assert.equal(REJECT_BATCH, 100);
  assert.equal(REJECT_WRITE_CAP, 100);
  assert.equal(JOB_DEADLINE_MAX_MS, 15 * 60 * 1000);
  assert.equal(SHOP_READ_MS, 8 * 60 * 1000);
  const urls = [
    'https://www.depop.com/products/shop-slug-a/',
    'https://www.depop.com/products/bag-slug/',
    'https://www.depop.com/products/new-boot/',
  ];
  const known = {
    known: [{ id: 'shop-slug-a', url: urls[0], source_id: 'stored-a' }],
    rejected: [{ id: 'bag-slug', url: urls[1], source_id: 'bag-slug' }],
  };
  const skipped = planKnownSkips(urls, known);
  assert.deepEqual(skipped.open, [urls[2]]);
  assert.deepEqual(skipped.skipped, [urls[0]]);
  assert.deepEqual(skipped.rejected, [urls[1]]);
  assert.deepEqual(skipped.presentIds, ['stored-a']);
  assert.equal(skipped.presentIds.includes('bag-slug'), false);
  const seen = presenceIds(skipped.presentIds, ['new-boot']);
  assert.deepEqual(absentIds(['stored-a', 'new-boot', 'left-the-shop'], seen), ['left-the-shop']);
  assert.equal(seen.includes('bag-slug'), false);
  const plan = planSync(true, true, seen, false);
  assert.equal(plan.sync, true);
  assert.ok(plan.ids.includes('stored-a'));
  assert.equal(plan.ids.includes('bag-slug'), false);
  assert.equal(plan.ids.includes('left-the-shop'), false);
  const recheck = planKnownSkips(urls, known, { recheck: true });
  assert.deepEqual(recheck.open, urls);
  assert.equal(recheck.skipped.length, 0);
  assert.equal(recheck.rejected.length, 0);
  assert.equal(recheck.recheck, true);
  const popup = read('extension/popup.html').toString();
  assert.match(popup, /Also re-check already imported and non-boot listings/);
  assert.equal(/id="recheck"[^>]*checked/.test(popup), false);
  assert.match(read('extension/popup.js').toString(), /recheck: \$\('recheck'\)\.checked/);
  assert.match(read('extension/popup.js').toString(), /previously not boots \(skipped\)/);
  const depop = read('extension/background.js').toString();
  assert.match(depop, /\/api\/import\/known/);
  assert.match(depop, /\/api\/import\/rejects/);
  assert.match(depop, /planKnownSkips/);
  assert.match(depop, /presenceIds/);
  assert.match(depop, /complete: false/);
  assert.match(jobSummary.toString(), /already imported \(skipped\)/);
  assert.match(jobSummary.toString(), /previously not boots \(skipped\)/);
  assert.match(depop, /jobSummary/);
  const summary = bootScanSummary({ scanned: 1, candidates: 3, eligible: 1, skipped: { already: 1, prior: 1 }, writeCap: 100 });
  assert.match(summary, /1 already imported \(skipped\)/);
  assert.match(summary, /1 previously not boots \(skipped\)/);
});

test('non-boot rejects are stored for this seller only, and uncertain is not', async () => {
  assert.equal(rejectToStore({ eligible: false, kind: 'uncertain' }), '');
  assert.equal(rejectToStore({ eligible: false, kind: 'non-footwear' }), 'non-footwear');
  assert.equal(rejectToStore({ eligible: false, kind: 'other-footwear' }), 'other-footwear');
  assert.equal(rejectToStore({ eligible: false, kind: 'non-footwear', store: 'boot-modifier' }), 'boot-modifier');
  assert.equal(rejectToStore({ eligible: true, kind: 'western-boot' }), '');
  const kept = acceptRejectRows([
    { source_id: 'bag', reason: 'non-footwear' },
    { source_id: 'shoe', reason: 'other-footwear' },
    { source_id: 'buckle', reason: 'boot-modifier' },
    { source_id: 'maybe', reason: 'uncertain' },
    { source_id: 'miss', reason: 'unread' },
  ]);
  assert.deepEqual(kept.map(r => r.reason), ['non-footwear', 'other-footwear', 'boot-modifier']);
  const old = visibleRejects([{ source_id: 'bag', gate_version: GATE_VERSION - 1 }, { source_id: 'shoe', gate_version: GATE_VERSION }], GATE_VERSION);
  assert.deepEqual(old.map(r => r.source_id), ['shoe']);
  const secret = 'signing-secret';
  const env = { NODE_ENV: 'production', ADMIN_PASSWORD: 'staff-secret', APP_PASSWORD: secret };
  const saved = [];
  const db = {
    async saveRejects(seller, source, rows) {
      const accepted = acceptRejectRows(rows);
      saved.push({ seller, source, accepted });
      return { saved: accepted.length };
    },
  };
  const ada = await sessionToken('seller:ada', secret);
  const headers = (token, authorization) => ({ get(name) {
    const key = String(name).toLowerCase();
    if (key === 'x-auth') return token;
    if (key === 'authorization') return authorization;
    return '';
  } });
  await assert.rejects(() => rejectApi({
    method: 'POST', url: 'http://localhost/api/import/rejects', headers: headers('', ''),
    json: async () => ({ source: 'depop', rejects: [{ source_id: 'bag', reason: 'non-footwear' }] }),
  }, db, env), /log in/);
  await assert.rejects(() => rejectApi({
    method: 'POST', url: 'http://localhost/api/import/rejects', headers: headers(ada, 'Bearer bob'),
    json: async () => ({ source: 'depop', rejects: [{ source_id: 'bag', reason: 'non-footwear' }] }),
  }, db, env), /own items/);
  const tooMany = Array.from({ length: 101 }, (_, i) => ({ source_id: `id-${i}`, reason: 'non-footwear' }));
  await assert.rejects(() => rejectApi({
    method: 'POST', url: 'http://localhost/api/import/rejects', headers: headers(ada, ''),
    json: async () => ({ source: 'depop', rejects: tooMany }),
  }, db, env), /too large/);
  const result = await rejectApi({
    method: 'POST', url: 'http://localhost/api/import/rejects', headers: headers(ada, ''),
    json: async () => ({ source: 'depop', rejects: [
      { source_id: 'bag', reason: 'non-footwear' },
      { source_id: 'maybe', reason: 'uncertain' },
    ] }),
  }, db, env);
  assert.equal(result.saved, 1);
  assert.equal(saved[0].seller, 'ada');
  assert.deepEqual(saved[0].accepted.map(r => r.source_id), ['bag']);
  assert.equal(saved.some(row => row.seller === 'bob'), false);
});

test('depop boot filters dedupe links and fall back when the filter does not stick', () => {
  const filters = depopBootFilters('nuclear_nostalgia');
  assert.deepEqual(filters.map(f => f.url), [
    'https://www.depop.com/nuclear_nostalgia/?groups=footwear&gender=female&productTypes=boots',
    'https://www.depop.com/nuclear_nostalgia/?groups=footwear&gender=male&productTypes=boots',
    'https://www.depop.com/nuclear_nostalgia/?groups=footwear&productTypes=boots',
  ]);
  for (const filter of filters) {
    assert.equal(filter.url.includes('category='), false);
    assert.equal(filter.url.includes('categories='), false);
    assert.equal(filter.url.includes('subcategory='), false);
    assert.equal(filter.url.includes('sellerUsername'), false);
  }
  const women = 'https://www.depop.com/products/women-boot/';
  const shared = 'https://www.depop.com/products/shared-boot/';
  const men = 'https://www.depop.com/products/men-boot/';
  const plan = planFilteredShop([
    { ...filters[0], chips: ['Women / Footwear', 'Boots'], cardTexts: ['lace-up moto boots'], href: filters[0].url, urls: [women, shared] },
    { ...filters[1], chips: ['Men / Footwear', 'Boots'], cardTexts: ['lace-up moto boots'], href: filters[1].url, urls: [shared, men] },
    { ...filters[2], chips: [], cardTexts: [], href: 'https://www.depop.com/nuclear_nostalgia/', urls: [women, 'https://www.depop.com/products/extra-boot/'] },
  ]);
  assert.equal(plan.ok, true);
  assert.deepEqual(plan.urls, [women, shared, men]);
  assert.match(plan.note, /Boots only \(fast\)/);
  assert.match(plan.note, /Women 2, Men 2/);
  assert.match(plan.note, /All boots skipped \(no filter\)/);
  assert.equal(cardIsNonFootwear('lace-up moto boots'), false);
  assert.equal(cardIsNonFootwear('leather tote bag'), true);
  const bag = planFilteredShop([
    { ...filters[0], chips: ['Women / Footwear', 'Boots'], cardTexts: ['leather tote bag'], href: filters[0].url, urls: [women] },
  ]);
  assert.equal(bag.fallback, true);
  assert.match(bag.reason, /Women: non-footwear/);
  const same = planFilteredShop([
    { ...filters[0], chips: ['Women / Footwear', 'Boots'], cardTexts: ['lace-up moto boots'], href: filters[0].url, urls: [shared] },
    { ...filters[1], chips: ['Men / Footwear', 'Boots'], cardTexts: ['lace-up moto boots'], href: filters[1].url, urls: [shared] },
  ]);
  assert.equal(same.fallback, true);
  assert.match(same.reason, /same count/);
  const kept = planFilteredShop([
    { ...filters[0], chips: [], cardTexts: ['lace-up moto boots'], href: filters[0].url, urls: [women] },
    { ...filters[1], chips: [], cardTexts: ['lace-up moto boots'], href: filters[1].url, urls: [men] },
  ]);
  assert.equal(kept.ok, true);
  assert.equal(kept.fallback, undefined);
  assert.deepEqual(kept.urls, [women, men]);
  assert.match(kept.note, /Boots only \(fast\)/);
  const dropped = planFilteredShop([
    { ...filters[0], chips: [], cardTexts: ['lace-up moto boots'], href: 'https://www.depop.com/nuclear_nostalgia/', urls: [women] },
  ]);
  assert.equal(dropped.fallback, true);
  assert.match(dropped.reason, /filter params were dropped/);
  const popup = read('extension/popup.html').toString();
  assert.match(popup, /Boots only \(fast\)/);
  assert.match(popup, /Full shop \(slower, catches mis-categorized boots\)/);
  assert.ok(popup.indexOf('value="boots"') < popup.indexOf('value="full"'));
  assert.match(read('extension/popup.js').toString(), /modeNote/);
  assert.equal(CANDIDATE_CAP, 400);
  assert.equal(WRITE_CAP, 100);
  assert.equal(JOB_DEADLINE_MAX_MS, 15 * 60 * 1000);
});

test('a removed frame is retried once, then the shop falls back, and the summary still prints', async () => {
  assert.equal(injectionLost(new Error('Frame with ID 0 was removed.')), true);
  assert.equal(injectionLost(new Error('No frame with id 0')), true);
  assert.equal(injectionLost(new Error('Receiving end does not exist.')), true);
  assert.equal(injectionLost(new Error('Frame with ID 0 is showing error page')), false);
  const calls = [];
  const recovered = await retryInjection(async (attempt) => {
    calls.push(attempt);
    if (attempt === 1) throw new Error('Frame with ID 0 was removed.');
    return { ok: true, productUrls: ['https://www.depop.com/products/boot/'] };
  });
  assert.deepEqual(calls, [1, 2]);
  assert.equal(recovered.ok, true);
  let tries = 0;
  await assert.rejects(() => retryInjection(async () => {
    tries += 1;
    throw new Error('Receiving end does not exist.');
  }), /Receiving end does not exist/);
  assert.equal(tries, 2);
  let other = 0;
  await assert.rejects(() => retryInjection(async () => { other += 1; throw new Error('timed out'); }), /timed out/);
  assert.equal(other, 1);
  const step = shopAfterFilterError(new Error('Frame with ID 0 was removed.'));
  assert.equal(step.fallback, true);
  assert.match(step.reason, /Frame with ID 0 was removed/);
  const line = jobSummary({ error: 'Frame with ID 0 was removed.' });
  assert.match(line, /0 new/);
  assert.match(line, /0 already imported \(skipped\)/);
  assert.match(line, /0 previously not boots \(skipped\)/);
  assert.match(line, /0 opened/);
  assert.match(line, /0 failed/);
  assert.match(line, /Frame with ID 0 was removed/);
  const bg = read('extension/background.js').toString();
  assert.match(bg, /retryInjection\(once\)/);
  assert.match(bg, /shopAfterFilterError/);
  const grid = bg.slice(bg.indexOf('async function readShopGrid'), bg.indexOf('async function importDepop'));
  assert.match(grid, /readDepopShop, 'ISOLATED'/);
  assert.match(grid, /, false\)/);
  const counted = jobSummary({ added: 2, duplicate: 3, prior: 4, opened: 5, failed: 1, modeNote: 'Boots only (fast).' });
  assert.match(counted, /Boots only \(fast\)\./);
  assert.match(counted, /2 new, 3 already imported \(skipped\), 4 previously not boots \(skipped\), 5 opened, 1 failed/);
});

test('shop script args stay JSON-serializable when allowEmpty is false', () => {
  for (const allowEmpty of [false, true]) {
    const args = shopReadArgs('nuclear_nostalgia', 1_700_000_000_000, CANDIDATE_CAP, allowEmpty);
    assert.deepEqual(args[3], { allowEmpty });
    assert.equal(args.includes(undefined), false);
    assert.deepEqual(JSON.parse(JSON.stringify(args)), args);
  }
  assert.throws(() => scriptArgs(['nuclear_nostalgia', 1, 400, undefined]), /args\[3\] is undefined/);
  assert.throws(() => scriptArgs([() => {}]), /function/);
  assert.throws(() => scriptArgs([new Map()]), /Map/);
  const bg = read('extension/background.js').toString();
  const grid = bg.slice(bg.indexOf('async function readShopGrid'), bg.indexOf('async function importDepop'));
  assert.match(grid, /shopReadArgs\(/);
  assert.equal(grid.includes('undefined'), false);
  assert.match(bg, /scriptArgs\(args\)/);
});

test('the committed extension zip matches source and its service worker parses', () => {
  const bg = read('extension/background.js').toString();
  assert.equal(navListenerArmedBeforeTabCreate(bg), true);
  assert.match(bg, /async \(id, site\) =>/);
  const api = bg.slice(bg.indexOf('async function api'), bg.indexOf('const send'));
  assert.equal(/chrome\.storage/.test(api), false);
  assert.match(api, /lock\.auth\(\)/);
  assert.match(bg, /cookieReadUrl/);
  assert.match(bg, /allowedBootlisterOrigin/);
  assert.match(bg, /runEntry/);
  const depop = bg.slice(bg.indexOf('async function readShopGrid'), bg.indexOf('function importLink'));
  assert.match(depop, /validateItemEnvelope/);
  assert.match(depop, /complete: false/);
  assert.match(depop, /readDepopShop, 'ISOLATED'/);
  assert.match(depop, /readDepopProduct, 'ISOLATED'/);
  assert.equal(depop.includes("'MAIN'"), false);
  assert.match(depop, /rejectEmptyDepopShop/);
  assert.match(depop, /CANDIDATE_CAP/);
  assert.match(depop, /westernBootDecision/);
  assert.match(depop, /bootScanSummary/);
  assert.match(depop, /result\.duplicate = \(result\.duplicate \|\| 0\) \+ skipped\.already/);
  assert.match(depop, /planKnownSkips/);
  assert.match(read('extension/popup.js').toString(), /scanLimit/);
  assert.match(depop, /extendDeadline/);
  assert.equal(CANDIDATE_CAP, 400);
  assert.match(bg, /info\?\.status === 'complete'/);
  assert.match(bg, /AbortSignal\.timeout\(API_TIMEOUT_MS\)/);
  assert.match(bg, /expectedId: expected/);
  assert.match(read('app/screen.js').toString(), /n\.skipped/);
  assert.match(read('app/screen.js').toString(), /stored photo/);
  assert.match(read('app/screen.js').toString(), /Source condition/);
  assert.match(read('extension/popup.js').toString(), /r\.skipped/);
  const manifest = JSON.parse(read('extension/manifest.json').toString());
  assert.equal(manifest.version, '0.18');
  const zip = readZip(read('public/bootlister-extension-0.18.zip'));
  const loop = bg.slice(bg.indexOf('async function importAll'), bg.indexOf('async function importFacebook'));
  assert.equal(loop.includes('retry(() => importOne'), false);
  assert.match(bg, /x-import-job/);
  const names = ['background.js', 'boot-gate.mjs', 'bridge.js', 'import-page.mjs', 'import-job.mjs', 'manifest.json', 'popup.html', 'popup.js'];
  assert.deepEqual([...zip.keys()].sort(), names.map(n => `wbw-importer/${n}`).sort());
  for (const name of names) assert.deepEqual(zip.get(`wbw-importer/${name}`), read(`extension/${name}`));
  const dir = mkdtempSync(join(tmpdir(), 'bootlister-ext-'));
  const file = join(dir, 'background.mjs');
  writeFileSync(file, zip.get('wbw-importer/background.js'));
  execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
  rmSync(dir, { recursive: true, force: true });
});

function readZip(buf) {
  const out = new Map();
  for (let o = 0; o + 30 < buf.length && buf.readUInt32LE(o) === 0x04034b50;) {
    const nameLen = buf.readUInt16LE(o + 26), extra = buf.readUInt16LE(o + 28), size = buf.readUInt32LE(o + 18);
    const name = buf.subarray(o + 30, o + 30 + nameLen).toString();
    out.set(name, Buffer.from(buf.subarray(o + 30 + nameLen, o + 30 + nameLen + size)));
    o += 30 + nameLen + extra + size;
  }
  return out;
}

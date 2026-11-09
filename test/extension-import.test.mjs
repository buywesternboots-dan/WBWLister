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
import { westernBootDecision, bootScanSummary } from '../extension/boot-gate.mjs';
import { actorForJob, allowedBootlisterOrigin, cookieReadUrl, createImportLock, gateWrite, navListenerArmedBeforeTabCreate, planSync, scanWindowOpen, sessionFromCookie, SHOP_SCAN_CAP, SIGNED_OUT, smokeCap, validateItemEnvelope, withDeadline } from '../extension/import-job.mjs';
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
  assert.match(shop.reason, /At most 2 will be written/);
  assert.match(shop.reason, /Exact label "item listed by nuclear_nostalgia": 7/);
  assert.match(shop.reason, /not the whole shop/);
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
  const late = await readDepopShop(SHOP, Date.now() + 2000, 2);
  assert.ok(passes >= 2);
  assert.deepEqual(late.productUrls, [LIVE_PRODUCT, 'https://www.depop.com/products/benny-caiman-western/']);
  assert.equal(late.complete, false);
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
  assert.equal(nextImportCount(0, jobA), 1);
  assert.equal(nextImportCount(1, jobA), 2);
  assert.throws(() => nextImportCount(2, jobA), /2 listing writes/);
  const secret = 'signing-secret';
  const token = await sessionToken('admin', secret);
  const env = { NODE_ENV: 'production', ADMIN_PASSWORD: 'staff-secret', APP_PASSWORD: secret };
  const counts = new Map();
  const db = {
    async claimImportWrite(seller, job) {
      const key = `${seller}\n${String(job || '').trim()}`;
      counts.set(key, nextImportCount(counts.get(key) || 0, job));
    },
    async createItem(seller, raw) { return { id: raw.source_id, seller }; },
  };
  const call = (job, id, source = 'depop') => itemsApi({
    method: 'POST', url: 'http://localhost/api/items',
    headers: { get(name) {
      const key = String(name).toLowerCase();
      if (key === 'x-auth') return token;
      if (key === 'x-import-job') return job;
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
  const summary = bootScanSummary({ scanned, candidates: order.length, eligible: eligible.length, unopened: order.length - scanned, skipped });
  assert.match(summary, /Scanned 5 of 6/);
  assert.match(summary, /Skipped 2 non-footwear, 1 other footwear, 0 uncertain/);
  assert.match(summary, /Eligible western boots: 2/);
  assert.match(summary, /1 candidate link was not opened/);
  assert.match(summary, /At most 2 are written/);
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

test('the smoke cap, worker envelope, and job deadline gate writes', () => {
  assert.equal(smokeCap(undefined), 2);
  assert.equal(smokeCap(9), 2);
  assert.equal(smokeCap(1), 1);
  assert.equal(smokeCap('2'), 2);
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
  assert.equal(gateWrite({ deadline: Date.now() + 1000, written: 2, cap: 9 }).ok, false);
  assert.match(gateWrite({ deadline: Date.now() + 1000, written: 2, cap: 2 }).reason, /Smoke test limit is 2/);
  assert.equal(gateWrite({ deadline: Date.now() - 1, written: 0, cap: 2 }).ok, false);
  assert.match(gateWrite({ deadline: Date.now() - 1, written: 0, cap: 2 }).reason, /time limit/);
  const lock = createImportLock();
  const job = lock.begin({ server: 'https://bootlister.vercel.app', seller: 'import-test', token: '', tokenServer: 'https://bootlister.vercel.app', limit: 400, deadline: Date.now() + 999999999 });
  assert.equal(job.job.limit, 2);
  assert.ok(job.job.deadline <= Date.now() + 120000);
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
  const depop = bg.slice(bg.indexOf('async function importDepop'), bg.indexOf('function importLink'));
  assert.match(depop, /validateItemEnvelope/);
  assert.match(depop, /complete: false/);
  assert.match(depop, /readDepopShop, 'ISOLATED'/);
  assert.match(depop, /readDepopProduct, 'ISOLATED'/);
  assert.equal(depop.includes("'MAIN'"), false);
  assert.match(depop, /rejectEmptyDepopShop/);
  assert.match(depop, /SHOP_SCAN_CAP/);
  assert.match(depop, /westernBootDecision/);
  assert.match(depop, /bootScanSummary/);
  assert.equal(SHOP_SCAN_CAP, 24);
  assert.match(bg, /info\?\.status === 'complete'/);
  assert.match(bg, /AbortSignal\.timeout\(API_TIMEOUT_MS\)/);
  assert.match(bg, /expectedId: expected/);
  assert.match(read('app/screen.js').toString(), /n\.skipped/);
  assert.match(read('extension/popup.js').toString(), /r\.skipped/);
  const manifest = JSON.parse(read('extension/manifest.json').toString());
  assert.equal(manifest.version, '0.11');
  const zip = readZip(read('public/bootlister-extension-0.11.zip'));
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

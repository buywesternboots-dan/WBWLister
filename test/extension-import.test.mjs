import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  acceptScan, collectIds, depopSellerHandle, explainPageFailure, pageScriptEmpty, readDepopProduct, readDepopShop, NO_FACEBOOK_LISTINGS,
} from '../extension/import-page.mjs';
import { createImportLock, gateWrite, navListenerArmedBeforeTabCreate, planSync, smokeCap, validateItemEnvelope, withDeadline } from '../extension/import-job.mjs';

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

test('the observed Depop seller link binds the shop and the product slug does not', async () => {
  assert.equal(depopSellerHandle(LIVE_SELLER), SHOP);
  assert.equal(depopSellerHandle(LIVE_PRODUCT), '');
  assert.equal(LIVE_SLUG === SHOP || LIVE_SLUG.startsWith(`${SHOP}-`), false);
  assert.equal(readDepopShop.toString().includes('webapi.depop.com'), false);
  assert.equal(readDepopProduct.toString().includes('webapi.depop.com'), false);

  let fetched = false;
  globalThis.fetch = () => { fetched = true; };
  globalThis.location = { hostname: 'www.depop.com', pathname: `/${SHOP}/`, href: `https://www.depop.com/${SHOP}/` };
  globalThis.document = { querySelectorAll: () => [
    { href: LIVE_PRODUCT },
    { href: 'https://www.depop.com/products/another-boot/' },
    { href: 'https://www.depop.com/products/third-boot/' },
  ] };
  const shop = await readDepopShop(SHOP, Date.now() + 1000, 9);
  assert.equal(fetched, false);
  assert.equal(shop.ok, true);
  assert.equal(shop.complete, false);
  assert.deepEqual(shop.value, []);
  assert.deepEqual(shop.productUrls, [LIVE_PRODUCT, 'https://www.depop.com/products/another-boot/']);
  assert.match(shop.reason, /not that account/);

  globalThis.location = { hostname: 'www.depop.com', pathname: `/products/${LIVE_SLUG}/`, href: LIVE_PRODUCT };
  globalThis.document = { querySelectorAll: () => [{ href: LIVE_SELLER }] };
  const bound = await readDepopProduct(SHOP, Date.now() + 1000);
  assert.equal(bound.ok, false);
  assert.equal(bound.complete, false);
  assert.match(bound.error, new RegExp(`Seller link matches ${SHOP}`));
  assert.match(bound.error, /not the account/);
  assert.match(bound.error, /not identified/);
  assert.equal(bound.error.includes('988597946'), false);
  assert.equal(bound.value, undefined);

  globalThis.document = {
    querySelectorAll: () => [],
    body: { innerText: '' },
  };
  const unresolved = await readDepopProduct(SHOP, Date.now() + 1000);
  assert.equal(unresolved.ok, false);
  assert.match(unresolved.error, /unresolved/);
  assert.equal(unresolved.value, undefined);

  globalThis.location = { hostname: 'www.depop.com', pathname: '/other_shop/', href: 'https://www.depop.com/other_shop/' };
  const off = await readDepopShop(SHOP, Date.now() + 1000, 2);
  assert.match(off.error, /not the requested Depop shop/);
  assert.equal(fetched, false);

  assert.equal(planSync(true, true, [LIVE_SLUG], true).sync, false);
  assert.match(planSync(true, true, [LIVE_SLUG], true).skipped, /did not remove/);
  assert.equal(planSync(true, false, [LIVE_SLUG]).sync, false);
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
  lock.end(first.job.id + 1);
  assert.equal(lock.job.seller, 'import-test');
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
  assert.match(bg, /sameOrigin\(saved\.server, server\)/);
  assert.match(bg, /runEntry/);
  const depop = bg.slice(bg.indexOf('async function importDepop'), bg.indexOf('function importLink'));
  assert.match(depop, /validateItemEnvelope/);
  assert.match(depop, /complete: false/);
  assert.match(bg, /AbortSignal\.timeout\(API_TIMEOUT_MS\)/);
  assert.match(bg, /expectedId: expected/);
  assert.match(read('app/screen.js').toString(), /n\.skipped/);
  assert.match(read('extension/popup.js').toString(), /r\.skipped/);
  const manifest = JSON.parse(read('extension/manifest.json').toString());
  assert.equal(manifest.version, '0.4');
  const zip = readZip(read('public/bootlister-extension-0.4.zip'));
  const names = ['background.js', 'bridge.js', 'import-page.mjs', 'import-job.mjs', 'manifest.json', 'popup.html', 'popup.js'];
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

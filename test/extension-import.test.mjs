import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  acceptScan, collectIds, explainPageFailure, pageScriptEmpty, readDepopShop, NO_FACEBOOK_LISTINGS,
} from '../extension/import-page.mjs';
import { createImportLock, navListenerArmedBeforeTabCreate, planSync, withDeadline } from '../extension/import-job.mjs';

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

test('Depop keeps literal fields, fails closed on identity, and does not complete a partial feed', async () => {
  const shop = installPage({
    entries: [{ name: 'https://webapi.depop.com/presentation/api/v1/shops/42/products/?limit=24' }],
    pages: [
      { json: { objects: [onsale(`${SHOP}-0030`), { ...onsale(`${SHOP}-sold`), status: 'STATUS_PURCHASED' }], page_info: { has_more: true, last: '0030' } } },
      { json: { objects: [onsale(`${SHOP}-second`)], page_info: { has_more: false, last: null } } },
    ],
  });
  const data = await readDepopShop(SHOP, Date.now() + 60000);
  assert.equal(data.ok, true);
  assert.equal(data.complete, true);
  assert.equal(data.value.length, 2);
  const item = data.value[0];
  assert.equal(item.source_id, `${SHOP}-0030`);
  assert.equal(item.source_url, `https://www.depop.com/products/${SHOP}-0030/`);
  assert.equal(item.size, '0030');
  assert.equal(item.price, '125.00');
  assert.deepEqual(item.photos, ['https://media.depop.com/large.jpg']);
  assert.equal(shop.urls[1], 'https://webapi.depop.com/presentation/api/v1/shops/42/products/?limit=24&after=0030');

  const stranger = installPage({
    entries: [{ name: 'https://webapi.depop.com/presentation/api/v1/shops/7/products/' }],
    pages: [{ json: { objects: [onsale('someone_else-boot')], page_info: { has_more: false } } }],
  });
  const wrong = await readDepopShop(SHOP, Date.now() + 60000);
  assert.equal(wrong.ok, false);
  assert.equal(wrong.complete, false);
  assert.equal(wrong.value, undefined);
  assert.match(wrong.error, /requested shop/);
  assert.equal(stranger.urls.length, 1);

  const many = installPage({
    entries: [
      { name: 'https://webapi.depop.com/presentation/api/v1/shops/1/products/' },
      { name: 'https://webapi.depop.com/presentation/api/v1/shops/2/products/' },
    ],
    pages: [{ json: { objects: [onsale(`${SHOP}-0030`)], page_info: { has_more: false } } }],
  });
  const ambiguous = await readDepopShop(SHOP, Date.now() + 60000);
  assert.equal(ambiguous.ok, false);
  assert.match(ambiguous.error, /More than one Depop shop/);
  assert.equal(many.urls.length, 0);

  const elsewhere = installPage({
    entries: [{ name: 'https://webapi.depop.com/presentation/api/v1/shops/42/products/' }],
    pages: [],
    path: '/other_shop/',
  });
  const off = await readDepopShop(SHOP, Date.now() + 60000);
  assert.match(off.error, /not the requested Depop shop/);
  assert.equal(elsewhere.urls.length, 0);

  const partial = installPage({
    entries: [{ name: 'https://webapi.depop.com/presentation/api/v1/shops/42/products/' }],
    pages: [{ json: { objects: [onsale(`${SHOP}-0030`), onsale(`${SHOP}-0030`)] } }],
  });
  const incomplete = await readDepopShop(SHOP, Date.now() + 60000);
  assert.equal(incomplete.ok, true);
  assert.equal(incomplete.complete, false);
  assert.equal(incomplete.value.length, 1);
  assert.equal(incomplete.value[0].source_id, `${SHOP}-0030`);
  assert.equal(partial.urls.length, 1);

  assert.equal(planSync(true, false, [`${SHOP}-0030`]).sync, false);
  assert.match(planSync(true, false, [`${SHOP}-0030`]).skipped, /did not remove/);
  assert.equal(planSync(true, true, [`${SHOP}-0030`]).sync, true);
  assert.deepEqual(planSync(false, true, [`${SHOP}-0030`]), { sync: false });
});

test('Depop HTTP errors use status precedence and a past deadline does not fetch', async () => {
  assert.equal(Boolean(401 ?? 200 === 200), true);
  assert.equal((401 ?? 200) === 200, false);
  for (const http of [401, 500]) {
    installPage({
      entries: [{ name: 'https://webapi.depop.com/presentation/api/v1/shops/42/products/' }],
      pages: [{ http, json: { objects: [onsale(`${SHOP}-0030`)], page_info: { has_more: false } } }],
    });
    const data = await readDepopShop(SHOP, Date.now() + 60000);
    assert.equal(data.ok, false, String(http));
    assert.match(data.error, new RegExp(`HTTP ${http}`));
    assert.equal(data.complete, false);
  }
  let called = false;
  globalThis.fetch = () => { called = true; };
  globalThis.performance = { getEntriesByType: () => [{ name: 'https://webapi.depop.com/presentation/api/v1/shops/42/products/' }] };
  globalThis.location = { hostname: 'www.depop.com', pathname: `/${SHOP}/`, href: `https://www.depop.com/${SHOP}/` };
  const late = await readDepopShop(SHOP, Date.now() - 5);
  assert.equal(called, false);
  assert.match(late.error, /timed out/);
  assert.equal(late.complete, false);
});

test('a hanging Depop fetch is aborted by the deadline', async () => {
  globalThis.location = { hostname: 'www.depop.com', pathname: `/${SHOP}/`, href: `https://www.depop.com/${SHOP}/` };
  globalThis.performance = { getEntriesByType: () => [{ name: 'https://webapi.depop.com/presentation/api/v1/shops/42/products/' }] };
  globalThis.fetch = (_url, opts) => new Promise((_, reject) => {
    const abort = () => reject(Object.assign(new Error('Aborted'), { name: 'AbortError' }));
    if (opts?.signal?.aborted) return abort();
    opts?.signal?.addEventListener('abort', abort);
  });
  const start = Date.now();
  const data = await readDepopShop(SHOP, Date.now() + 50);
  assert.match(data.error, /timed out/);
  assert.equal(data.complete, false);
  assert.ok(Date.now() - start < 1000);
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
  assert.equal(found.complete, true);
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
  assert.ok(depop.indexOf('acceptScan') >= 0 && depop.indexOf('acceptScan') < depop.indexOf('.length'));
  assert.match(read('app/screen.js').toString(), /n\.skipped/);
  assert.match(read('extension/popup.js').toString(), /r\.skipped/);
  const manifest = JSON.parse(read('extension/manifest.json').toString());
  assert.equal(manifest.version, '0.3');
  const zip = readZip(read('public/bootlister-extension-0.3.zip'));
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

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  explainPageFailure, requirePagePayload, pageScriptEmpty, readDepopShop, NO_FACEBOOK_LISTINGS,
} from '../extension/import-page.mjs';

const read = p => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
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

function installPage({ entries, pages }) {
  const nodes = [];
  const urls = [];
  let n = 0;
  globalThis.document = {
    createElement: () => ({ type: '', id: '', textContent: '' }),
    documentElement: { appendChild(el) { nodes.push(el); } },
  };
  globalThis.performance = { getEntriesByType: () => entries };
  globalThis.fetch = async url => {
    urls.push(String(url));
    const body = pages[Math.min(n, pages.length - 1)];
    n += 1;
    return { ok: body.http ?? 200 === 200, status: body.http ?? 200, json: async () => body.json };
  };
  return {
    urls,
    payload() {
      assert.equal(nodes.length, 1);
      return JSON.parse(nodes[0].textContent);
    },
  };
}

test('a null page result explains itself and does not crash on length', () => {
  const crash = () => { const items = null; return items.length; };
  assert.throws(crash, /reading 'length'/);
  assert.throws(() => requirePagePayload(null, 'Depop'), e => {
    assert.match(e.message, /didn't return a result/);
    assert.equal(/reading 'length'/.test(e.message), false);
    return true;
  });
  assert.equal(pageScriptEmpty('Depop').includes("reading 'length'"), false);
  assert.throws(() => requirePagePayload(JSON.stringify({ ok: true, value: null }), 'Depop'), e => {
    assert.equal(/reading 'length'/.test(e.message), false);
    assert.match(e.message, /listing list/);
    return true;
  });
  assert.deepEqual(requirePagePayload(JSON.stringify({ ok: true, value: [] }), 'Depop'), []);
  assert.throws(() => requirePagePayload(JSON.stringify({ ok: false, error: 'Depop feed said no' }), 'Depop'), /Depop feed said no/);
});

test('Facebook error pages stay honest about the redirect and do not offer a bypass', () => {
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
  assert.equal(/reading 'length'/.test(msg), false);
  const chromeError = explainPageFailure({ site: 'Facebook', tabUrl: 'chrome-error://chromewebdata/', title: "This page isn’t working" });
  assert.match(chromeError, /error page/);
  assert.equal(/ERR_TOO_MANY_REDIRECTS/.test(chromeError), false);
  assert.equal(explainPageFailure({ site: 'Facebook', message: 'Please log in.' }), '');
  assert.equal(explainPageFailure({ site: 'Facebook', message: msg }), '');
  assert.match(NO_FACEBOOK_LISTINGS, /sign in to Facebook/);
  assert.match(NO_FACEBOOK_LISTINGS, /Nothing was imported/);
});

test('Depop reader keeps literal listing fields and survives a null feed', async () => {
  const shop = installPage({
    entries: [{ name: 'https://webapi.depop.com/presentation/api/v1/shops/42/products/?limit=24' }],
    pages: [
      { json: { objects: [onsale('0030-nuclear-boot'), { ...onsale('sold-one'), status: 'STATUS_PURCHASED' }], page_info: { has_more: true, last: '0030' } } },
      { json: { objects: [onsale('second-boot')], page_info: { has_more: false, last: null } } },
    ],
  });
  await readDepopShop('wbw-key');
  const data = shop.payload();
  assert.equal(data.ok, true);
  assert.equal(data.value.length, 2);
  const item = data.value[0];
  assert.equal(item.source, 'depop');
  assert.equal(item.source_id, '0030-nuclear-boot');
  assert.equal(item.source_url, 'https://www.depop.com/products/0030-nuclear-boot/');
  assert.equal(item.description, 'Lucchese 0030-nuclear-boot\nSize 10');
  assert.equal(item.size, '0030');
  assert.equal(item.price, '125.00');
  assert.deepEqual(item.photos, ['https://media.depop.com/large.jpg']);
  assert.equal(item.brand, 'Lucchese');
  assert.equal(shop.urls[0], 'https://webapi.depop.com/presentation/api/v1/shops/42/products/?limit=24');
  assert.equal(shop.urls[1], 'https://webapi.depop.com/presentation/api/v1/shops/42/products/?limit=24&after=0030');
  assert.equal(shop.urls.some(u => /after=30(?!\d)/.test(u)), false);

  const missing = installPage({
    entries: [{ name: 'https://webapi.depop.com/presentation/api/v1/shops/42/products/?limit=24' }],
    pages: [{ json: { objects: null, page_info: null } }],
  });
  await readDepopShop('wbw-key');
  const err = missing.payload();
  assert.equal(err.ok, false);
  assert.match(err.error, /no listing list/);
  assert.equal(/reading 'length'/.test(err.error), false);

  const stuck = installPage({
    entries: [{ name: 'https://webapi.depop.com/presentation/api/v1/shops/9/products/' }],
    pages: [{ json: { objects: [], page_info: { has_more: true, last: null } } }],
  });
  await readDepopShop('wbw-key');
  assert.match(stuck.payload().error, /didn't give a next page/);
  assert.equal(stuck.urls.length, 1);

  const none = installPage({ entries: [], pages: [] });
  await readDepopShop('wbw-key');
  assert.match(none.payload().error, /Could not find the shop/);
  assert.equal(none.urls.length, 0);
});

test('the packaged extension is 0.2, does not clear cookies, and the served zip matches', () => {
  const manifest = JSON.parse(read('extension/manifest.json'));
  assert.equal(manifest.version, '0.2');
  assert.equal(manifest.background.type, 'module');
  assert.equal(manifest.permissions.includes('webNavigation'), true);
  for (const banned of ['cookies', 'browsingData', 'webRequest', 'webRequestBlocking'])
    assert.equal(manifest.permissions.includes(banned), false);
  const bg = read('extension/background.js');
  assert.match(bg, /requirePagePayload/);
  assert.match(bg, /explainPageFailure/);
  assert.match(bg, /from '\.\/import-page\.mjs'/);
  assert.equal(/chrome\.cookies|browsingData|webRequest/.test(bg), false);
  assert.match(read('extension/popup.js'), /getManifest\(\)\.version/);
  const reader = read('extension/import-page.mjs');
  assert.equal(/chrome\.cookies|browsingData/.test(reader), false);
  assert.match(reader, /webapi\.depop\.com\/presentation\/api\/v1\/shops\//);
  execFileSync(process.execPath, ['scripts/zip-extension.mjs'], { cwd: fileURLToPath(new URL('..', import.meta.url)) });
  const served = readFileSync(new URL('../public/wbw-importer.zip', import.meta.url));
  const versioned = readFileSync(new URL('../public/bootlister-extension-0.2.zip', import.meta.url));
  assert.deepEqual(served, versioned);
  const names = [];
  for (let o = 0; o + 30 < served.length && served.readUInt32LE(o) === 0x04034b50;) {
    const nameLen = served.readUInt16LE(o + 26), extra = served.readUInt16LE(o + 28), size = served.readUInt32LE(o + 18);
    names.push(served.subarray(o + 30, o + 30 + nameLen).toString());
    o += 30 + nameLen + extra + size;
  }
  for (const file of ['wbw-importer/manifest.json', 'wbw-importer/background.js', 'wbw-importer/import-page.mjs', 'wbw-importer/bridge.js', 'wbw-importer/popup.js'])
    assert.equal(names.includes(file), true);
  assert.equal(names.some(n => n.includes('wbw.js') || n.endsWith('.env')), false);
});

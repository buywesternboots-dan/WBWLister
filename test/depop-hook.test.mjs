import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import * as feed from '../extension/depop-feed.mjs';
const root = 'https://webapi.depop.com/presentation/api/v1/shops/6702411/';
const url = root + 'products/?limit=24&groups=footwear&product_types=boots&gender=female';
const item = (id, status = 'STATUS_ONSALE') => ({ id, slug: `boot-${id}`, status });
const page = (items, more, extra = {}) => ({ url, status: 200, items, page_info: { has_more: more }, ...extra });
test('hook collection is per shop/filter, onsale-only, deduped, and terminal without inventing a total', () => {
  const result = feed.collectHookProducts({ pages: [page([item(1), item(2, 'STATUS_DRAFT')], true), page([item(1), item(3)], false), { ...page([item(4)], false), url: url.replace('female', 'male') }, { ...page([item(5)], false), url: url.replace('/products/', '/products/by-status/sold/') }] }, 'female', '6702411');
  assert.deepEqual(result.ids, ['1', '3']);
  assert.equal(result.expected, 0);
  assert.equal(result.complete, true);
  assert.deepEqual(result.hasMoreTrail, [true, false]);
});
test('aggregate or response total is an independent oracle: terminal short reads fail closed', () => {
  const hook = { pages: [page([item(1)], false)], aggregates: [{ url: url.replace('/products/', '/aggregates/'), status: 200, total: 2 }] };
  const result = feed.collectHookProducts(hook, 'female', '6702411');
  assert.equal(result.expected, 2);
  assert.equal(result.complete, false);
  assert.equal(result.verdict, 'short');
  assert.equal(feed.collectHookProducts({ pages: [page([item(1)], false, { total: 1 })] }, 'female', '6702411').complete, true);
  assert.equal(feed.collectHookProducts({ pages: [page([item(1)], true)] }, 'female', '6702411').complete, false);
});
test('DOM rejects unknown >150 and short oracle even without a cap hit', () => {
  assert.equal(feed.judgeDomRead({ urls: Array(151).fill('x') }).ok, false);
  assert.equal(feed.judgeDomRead({ urls: ['x'], expected: 2 }).ok, false);
});
test('MAIN hook captures exact replay init, aggregates, trails and never changes the page fetch promise', async () => {
  let body = { objects: [item(1)], page_info: { has_more: false } };
  const response = () => ({ status: 200, clone: () => ({ json: async () => body }) });
  let original = Promise.resolve(response());
  const messages = [];
  const window = { fetch: () => original, postMessage: m => messages.push(m), addEventListener() {} };
  vm.runInNewContext(readFileSync(new URL('../extension/depop-hook.js', import.meta.url), 'utf8'), { window, location: { origin: 'https://www.depop.com' }, URL, Headers, Request, Date, setTimeout });
  assert.equal(window.fetch(url, { credentials: 'omit', headers: { 'x-test': 'yes' } }), original);
  await new Promise(r => setImmediate(r));
  assert.equal(window.__bootlisterDepop.requests[0].init.credentials, 'omit');
  assert.equal(window.__bootlisterDepop.requests[0].init.headers['x-test'], 'yes');
  assert.equal(window.__bootlisterDepop.pages[0].page_info.has_more, false);
  assert.ok(messages.some(m => m.bootlisterDepopSnapshot));
  body = { total: 50 };
  original = Promise.resolve(response());
  await window.fetch(url.replace('/products/', '/aggregates/'));
  await new Promise(r => setImmediate(r));
  assert.equal(window.__bootlisterDepop.aggregates[0].total, 50);
  original = Promise.reject(new TypeError('Failed to fetch'));
  // Deliberately do not catch at the caller: the wrapper must attach a rejection observer to every fetch.
  assert.equal(window.fetch('https://unrelated.example/'), original);
  await new Promise(r => setImmediate(r));
});
test('cross-round union preserves oracle and requires complete counts', () => {
  const a = feed.collectHookProducts({ pages: [page([item(1)], false, { total: 2 })] }, 'female', '6702411');
  const b = feed.collectHookProducts({ pages: [page([item(2)], false, { total: 2 })] }, 'female', '6702411');
  const merged = feed.mergeHookRounds(a, b);
  assert.equal(merged.complete, true);
  assert.deepEqual(merged.ids, ['1', '2']);
});
test('exact replay selects captured GET for same shop and never sold', () => {
  const init = { headers: { 'x-test': 'yes' }, credentials: 'omit' };
  assert.equal(feed.replayRequest({ requests: [{ url: url.replace('/products/', '/products/by-status/sold/'), init }] }), null);
  assert.equal(feed.replayRequest({ requests: [{ url, init }] }, '1234'), null);
  assert.deepEqual(feed.replayRequest({ requests: [{ url, init }] }, '6702411'), { url, init });
});
test('product plan refuses non-product/offsite links, dedupes and keeps only the collected slugs', () => {
  assert.deepEqual(feed.productPlan(['https://www.depop.com/products/a/', 'https://www.depop.com/products/a/', 'https://other.com/products/b/', 'https://www.depop.com/shop/', 'https://www.depop.com/products/c/']), ['https://www.depop.com/products/a/', 'https://www.depop.com/products/c/']);
});
test('hook ignores every explicit non-onsale status, including drafts and inactive', () => {
  const r = feed.collectHookProducts({ pages: [page([item(1), item(2, 'STATUS_DRAFT'), item(3, 'STATUS_INACTIVE'), item(4, '')], false)] }, 'female', '6702411');
  assert.deepEqual(r.ids, ['1']);
});
test('isolated bridge rejects other sources and accepts only MAIN snapshots', async () => {
  let onMessage;
  const window = { addEventListener: (_, fn) => { onMessage = fn; }, postMessage() {} };
  vm.runInNewContext(readFileSync(new URL('../extension/depop-bridge.js', import.meta.url), 'utf8'), { window, location: { origin: 'https://www.depop.com' } });
  onMessage({ source: {}, origin: 'https://www.depop.com', data: { bootlisterDepopSnapshot: true, snapshot: { pages: [1] } } });
  assert.equal(window.__bootlisterDepopSnapshot, undefined);
  onMessage({ source: window, origin: 'https://www.depop.com', data: { bootlisterDepopSnapshot: true, snapshot: { pages: [], aggregates: [] } } });
  assert.equal(window.__bootlisterDepopSnapshot.pages.length, 0);
});
test('replay is one exact captured request, catches network failure and preserves init', async () => {
  const { replayDepopRequest } = await import('../extension/import-page.mjs');
  const saved = globalThis.fetch;
  const init = { headers: { 'x-test': 'yes' }, credentials: 'omit', mode: 'cors' };
  let calls = 0;
  globalThis.fetch = async (u, opts) => { calls++; assert.equal(u, url); assert.equal(opts.credentials, 'omit'); assert.equal(opts.headers['x-test'], 'yes'); throw new TypeError('Failed to fetch'); };
  try {
    const r = await replayDepopRequest(url, init);
    assert.equal(r.status, 0);
    assert.equal(r.error, 'Failed to fetch');
    assert.equal(calls, 1);
  } finally { globalThis.fetch = saved; }
});
test('page driver scrolls until Depop reports has_more false and returns trail', async () => {
  const { driveDepopHook } = await import('../extension/import-page.mjs');
  const keep = { window: globalThis.window, document: globalThis.document };
  const pages = [page([item(1)], true)];
  let scrolled = 0;
  globalThis.window = { __bootlisterDepopSnapshot: { pages, aggregates: [], requests: [], errors: [] }, scrollBy() {}, scrollTo() { scrolled++; if (scrolled === 1) pages.push({ ...page([item(2)], false), url: url + '&after=x' }); } };
  globalThis.document = { querySelectorAll: () => [], body: { scrollHeight: 1000 }, documentElement: { scrollHeight: 1000 } };
  try {
    const r = await driveDepopHook({ gender: 'female', shopId: '6702411', pauseMs: 0, quietMax: 3, deadlineMs: Date.now() + 5000 });
    assert.equal(r.stop, 'has_more_false');
    assert.equal(r.scrolls, 1);
    assert.equal(feed.collectHookProducts(r.hook, 'female', '6702411').ids.length, 2);
  } finally { globalThis.window = keep.window; globalThis.document = keep.document; }
});

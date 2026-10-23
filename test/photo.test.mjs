import { test, mock, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { importPhoto } from '../lib/wbw.js';
import { isBlobPhoto, isBlockedIp, readSourcePhoto } from '../app/img/[id]/[n]/[name]/route.js';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

const jpegResponse = (status = 200) => ({
  ok: status >= 200 && status < 300, status,
  headers: { get: () => 'image/jpeg' },
  blob: async () => new Blob([Uint8Array.from([0xff, 0xd8, 0xff, 0xd9])]),
});
const QUOTA = 'Vercel Blob: Storage quota exceeded for Hobby plan (1GB maximum)';
const src = 'https://cdn.shopify.com/s/files/boot.jpg';

test('a Blob quota error keeps the source photo url and does not fail the photo', async () => {
  globalThis.fetch = async () => jpegResponse();
  const put = mock.fn(async () => { throw new Error(QUOTA); });
  assert.equal(await importPhoto(src, 2, put), src);
  assert.equal(put.mock.calls.length, 1);
});

test('any Blob put error keeps the source photo url', async () => {
  globalThis.fetch = async () => jpegResponse();
  const put = mock.fn(async () => { throw new Error('socket hang up'); });
  assert.equal(await importPhoto(src, 1, put), src);
});

test('a downloaded photo that Blob accepts is stored at the Blob url', async () => {
  globalThis.fetch = async () => jpegResponse();
  const blob = 'https://abc.public.blob.vercel-storage.com/photos/x.jpg';
  const put = mock.fn(async () => ({ url: blob }));
  assert.equal(await importPhoto(src, 1, put), blob);
  assert.equal(put.mock.calls[0].arguments[2].access, 'public');
});

test('a photo that does not download still fails the item', async () => {
  globalThis.fetch = async () => jpegResponse(404);
  const put = mock.fn(async () => ({ url: 'https://blob.example/x.jpg' }));
  await assert.rejects(importPhoto(src, 4, put), /Photo 4 didn't import \(HTTP 404\)/);
  assert.equal(put.mock.calls.length, 0);
});

test('a photo already in Blob is not uploaded again', async () => {
  let called = false;
  globalThis.fetch = async () => { called = true; };
  const blob = 'https://abc.public.blob.vercel-storage.com/photos/old.jpg';
  assert.equal(await importPhoto(blob, 1, async () => { throw new Error(QUOTA); }), blob);
  assert.equal(called, false);
});

test('private and loopback addresses are blocked', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.1', '192.168.1.9', '169.254.169.254', '0.0.0.0', '::1', '::', 'fe80::1', 'fd00::1', '::ffff:127.0.0.1'])
    assert.equal(isBlockedIp(ip), true, ip);
  for (const ip of ['8.8.8.8', '93.184.216.34', '1.1.1.1'])
    assert.equal(isBlockedIp(ip), false, ip);
  assert.equal(isBlobPhoto('https://abc.public.blob.vercel-storage.com/photos/a.jpg'), true);
  assert.equal(isBlobPhoto('https://cdn.shopify.com/s/files/a.jpg'), false);
  assert.equal(isBlobPhoto('https://evil.example/blob.vercel-storage.com/a.jpg'), false);
});

const pub = { lookup: async () => [{ address: '93.184.216.34', family: 4 }] };
const headers = map => ({ get: h => map[h.toLowerCase()] ?? null });
const bodyOf = bytes => (async function* () { yield bytes; })();

test('source photos allow public image bytes and refuse private, non-image, svg, and oversized urls', async () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
  const ok = await readSourcePhoto('https://cdn.shopify.com/s/files/a.png', {
    ...pub,
    fetch: async () => ({ ok: true, status: 200, headers: headers({ 'content-type': 'image/png' }), body: bodyOf(png) }),
  });
  assert.equal(ok.type, 'image/png');
  assert.deepEqual(ok.body, png);

  let fetches = 0;
  const blocked = url => assert.rejects(readSourcePhoto(url, { ...pub, fetch: () => { fetches += 1; } }), /blocked|bad url/);
  await blocked('file:///etc/passwd');
  await blocked('http://127.0.0.1/latest');
  await blocked('http://169.254.169.254/latest/meta-data');
  await blocked('http://10.0.0.5/a.jpg');
  await blocked('http://[::1]/a.jpg');
  await blocked('https://localhost/a.jpg');
  await assert.rejects(readSourcePhoto('https://internal.example/a.jpg', {
    fetch: () => { fetches += 1; }, lookup: async () => [{ address: '192.168.0.4', family: 4 }],
  }), /blocked/);
  assert.equal(fetches, 0);

  const hops = [];
  await assert.rejects(readSourcePhoto('https://cdn.example/start', {
    ...pub,
    fetch: async url => {
      hops.push(url);
      return { status: 302, headers: headers({ location: 'http://127.0.0.1/secret' }), body: { cancel: async () => {} } };
    },
  }), /blocked/);
  assert.deepEqual(hops, ['https://cdn.example/start']);

  await assert.rejects(readSourcePhoto('https://cdn.example/pic.svg', {
    ...pub, fetch: async () => ({ ok: true, status: 200, headers: headers({ 'content-type': 'image/svg+xml' }), body: bodyOf(Buffer.from('<svg/>')) }),
  }), /type/);
  await assert.rejects(readSourcePhoto('https://cdn.example/page', {
    ...pub, fetch: async () => ({ ok: true, status: 200, headers: headers({ 'content-type': 'text/html' }), body: bodyOf(Buffer.from('<html>')) }),
  }), /type/);

  await assert.rejects(readSourcePhoto('https://cdn.example/big.jpg', {
    ...pub,
    fetch: async () => ({ ok: true, status: 200, headers: headers({ 'content-type': 'image/jpeg', 'content-length': String(16 * 1024 * 1024) }), body: { cancel: async () => {} } }),
  }), /too big/);
});

test('a source photo fetch stops at 15 MB', async () => {
  let sent = 0;
  const body = (async function* () {
    while (sent <= 15 * 1024 * 1024) { sent += 1024 * 1024; yield new Uint8Array(1024 * 1024); }
  })();
  await assert.rejects(readSourcePhoto('https://cdn.example/big.jpg', {
    ...pub, fetch: async () => ({ ok: true, status: 200, headers: headers({ 'content-type': 'image/jpeg' }), body }),
  }), /too big/);
});

test('a source photo fetch stops at 15 seconds', async () => {
  // AbortSignal.timeout does not keep the event loop alive by itself; hold it until the abort fires.
  const fetch = (_url, { signal }) => new Promise((_, reject) => {
    const hold = setTimeout(() => {}, 1000);
    const fail = () => { clearTimeout(hold); const e = new Error('The operation was aborted'); e.name = 'TimeoutError'; reject(e); };
    if (signal.aborted) fail(); else signal.addEventListener('abort', fail, { once: true });
  });
  await assert.rejects(readSourcePhoto('https://cdn.example/slow.jpg', { ...pub, fetch, timeoutMs: 30 }), /aborted|TimeoutError/i);
});

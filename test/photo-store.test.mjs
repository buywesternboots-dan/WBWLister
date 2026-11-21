import { test, mock, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { allowedPhotoUrl, photoStoreOrigin, unsyncedPhotoLikePatterns } from '../lib/net.js';
import { put, putToPhotoStore } from '../lib/photo-store.js';
import { importPhoto } from '../lib/wbw.js';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

const STORE = {
  PHOTO_STORE_URL: 'https://studiolimitlessgrunt2.tail738951.ts.net:10000',
  PHOTO_STORE_TOKEN: 'test-token',
};

test('PHOTO_STORE_URL is an allowed already-stored host, compared by origin and port', () => {
  assert.equal(photoStoreOrigin(STORE), 'https://studiolimitlessgrunt2.tail738951.ts.net:10000');
  assert.equal(allowedPhotoUrl('https://studiolimitlessgrunt2.tail738951.ts.net:10000/photos/a.jpg', STORE), true);
  assert.equal(allowedPhotoUrl('https://studiolimitlessgrunt2.tail738951.ts.net/photos/a.jpg', STORE), false);
  assert.equal(allowedPhotoUrl('https://studiolimitlessgrunt2.tail738951.ts.net:8443/photos/a.jpg', STORE), false);
  assert.equal(allowedPhotoUrl('https://studiolimitlessgrunt2.tail738951.ts.net.evil.example/photos/a.jpg', STORE), false);
  assert.equal(allowedPhotoUrl('https://evil.example/?x=studiolimitlessgrunt2.tail738951.ts.net', STORE), false);
  assert.equal(allowedPhotoUrl('https://cdn.example/a.jpg', STORE), false);
  assert.deepEqual(unsyncedPhotoLikePatterns(STORE), [
    'https://%.blob.vercel-storage.com/%',
    'https://blob.vercel-storage.com/%',
    'https://studiolimitlessgrunt2.tail738951.ts.net:10000/%',
  ]);
  assert.deepEqual(unsyncedPhotoLikePatterns({}), [
    'https://%.blob.vercel-storage.com/%',
    'https://blob.vercel-storage.com/%',
  ]);
});

test('put uses the photo store when PHOTO_STORE_URL and PHOTO_STORE_TOKEN are set', async () => {
  const calls = [];
  globalThis.fetch = async (url, opt) => {
    calls.push({ url, method: opt.method, headers: opt.headers, body: Buffer.from(opt.body) });
    return { ok: true, json: async () => ({ url: `${STORE.PHOTO_STORE_URL}/photos/a.jpg` }) };
  };
  const blob = mock.fn(async () => ({ url: 'https://blob.example/nope.jpg' }));
  const out = await put('photos/a.jpg', Buffer.from('hi'), { access: 'public', contentType: 'image/jpeg' }, STORE, blob);
  assert.equal(out.url, 'https://studiolimitlessgrunt2.tail738951.ts.net:10000/photos/a.jpg');
  assert.equal(blob.mock.calls.length, 0);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://studiolimitlessgrunt2.tail738951.ts.net:10000/photos/a.jpg');
  assert.equal(calls[0].method, 'PUT');
  assert.equal(calls[0].headers.Authorization, 'Bearer test-token');
  assert.equal(calls[0].headers['Content-Type'], 'image/jpeg');
  assert.deepEqual(calls[0].body, Buffer.from('hi'));
});

test('put falls back to Vercel Blob when the photo store env is not set', async () => {
  let fetched = false;
  globalThis.fetch = async () => { fetched = true; throw new Error('should not fetch'); };
  const blob = mock.fn(async () => ({ url: 'https://abc.public.blob.vercel-storage.com/photos/a.jpg' }));
  const out = await put('photos/a.jpg', Buffer.from('hi'), { access: 'public', contentType: 'image/jpeg' }, {}, blob);
  assert.equal(out.url, 'https://abc.public.blob.vercel-storage.com/photos/a.jpg');
  assert.equal(blob.mock.calls.length, 1);
  assert.equal(fetched, false);
});

test('a photo-store put error is thrown so importPhoto can keep the source URL', async () => {
  globalThis.fetch = async () => ({ ok: false, status: 507, json: async () => ({}) });
  await assert.rejects(putToPhotoStore('photos/a.jpg', Buffer.from('hi'), { contentType: 'image/jpeg' }, STORE), /Photo store HTTP 507/);
  const src = 'https://cdn.shopify.com/s/files/boot.jpg';
  globalThis.fetch = async url => {
    if (String(url).includes('shopify')) {
      return {
        ok: true, status: 200,
        headers: { get: () => 'image/jpeg' },
        blob: async () => new Blob([Uint8Array.from([0xff, 0xd8, 0xff, 0xd9])]),
      };
    }
    return { ok: false, status: 503, json: async () => ({}) };
  };
  const putFn = (path, body, opt) => put(path, body, opt, STORE);
  assert.equal(await importPhoto(src, 2, putFn), src);
});

test('a photo already on the photo store is not uploaded again', async () => {
  let called = false;
  globalThis.fetch = async () => { called = true; };
  const url = 'https://studiolimitlessgrunt2.tail738951.ts.net:10000/photos/old.jpg';
  const prev = { PHOTO_STORE_URL: process.env.PHOTO_STORE_URL, PHOTO_STORE_TOKEN: process.env.PHOTO_STORE_TOKEN };
  process.env.PHOTO_STORE_URL = STORE.PHOTO_STORE_URL;
  process.env.PHOTO_STORE_TOKEN = STORE.PHOTO_STORE_TOKEN;
  try {
    assert.equal(await importPhoto(url, 1, async () => { throw new Error('nope'); }), url);
    assert.equal(called, false);
  } finally {
    if (prev.PHOTO_STORE_URL == null) delete process.env.PHOTO_STORE_URL; else process.env.PHOTO_STORE_URL = prev.PHOTO_STORE_URL;
    if (prev.PHOTO_STORE_TOKEN == null) delete process.env.PHOTO_STORE_TOKEN; else process.env.PHOTO_STORE_TOKEN = prev.PHOTO_STORE_TOKEN;
  }
});

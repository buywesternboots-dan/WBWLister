// One-click AMCASO WBW end to end: click on a pair -> prepared photos stored as items.photos -> CSV export URL ->
// the /img bytes WBW downloads carry amcasoWBW's title, description, and keywords, and are otherwise lossless.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { oneClickPair, oneClickMany, sourcePhotos } from '../lib/amcaso-wbw-oneclick.js';
import { appliedAmcaso, undoPreparedPhotos } from '../lib/amcaso-wbw.js';
import { exportRecord, toCsv } from '../lib/export.js';
import { photoResponse } from '../app/img/[id]/[n]/[name]/route.js';
import { imageSize, jpegIccSegments, jpegScanPayload, readXmpFields } from '../lib/photo-meta.js';
import { itemsResponse } from '../lib/items-api.js';
import { sessionToken } from '../lib/session.js';

const FIX = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'photos');
const photo = name => readFileSync(join(FIX, name));
const ORIG = {
  'https://abc.public.blob.vercel-storage.com/photos/a1.jpg': photo('cmyk.jpg'),
  'https://abc.public.blob.vercel-storage.com/photos/a2.jpg': photo('rotated.jpg'),
  'https://abc.public.blob.vercel-storage.com/photos/a3.webp': photo('prepared-landscape.webp'),
};
const seller = { name: 'danhoffenberg', display_name: 'Dan Hoffenberg', location: 'Texas' };
const pair = (over = {}) => ({
  id: 1842, seller: 'danhoffenberg', source: 'listperfectly', status: 'published', boot: 'boot',
  title: 'Lucchese 1883 boots, style 0123, size 10 D', description: 'Style #: 0123\nBlack cherry goat Lucchese cowboy boots, size 10 D.',
  id_text: '0123', price: 250, wbw_price: 250, brand: 'Lucchese', sized_for: 'Men', size: '10', width: 'D', material: 'Goat',
  color: 'Black Cherry', guessed: [], verified: ['brand', 'id_text', 'size', 'width', 'color', 'material'],
  photos: Object.keys(ORIG), asmowbw: null, ...over,
});

function store() {
  const blobs = new Map(Object.entries(ORIG));
  const putFn = async (path, body, opt) => {
    assert.equal(opt.access, 'public');
    assert.ok(path.startsWith('prepared/'), path);
    const url = `https://abc.public.blob.vercel-storage.com/${path}`;
    blobs.set(url, Buffer.from(body));
    putFn.puts += 1;
    return { url };
  };
  putFn.puts = 0;
  const readPhoto = async url => {
    if (!blobs.has(url)) throw new Error('404');
    return { body: blobs.get(url) };
  };
  const sniff = b => (b[0] === 0xff ? 'image/jpeg' : b[0] === 0x89 ? 'image/png' : 'image/webp');
  const read = async url => ({ body: blobs.get(url), type: sniff(blobs.get(url)) });
  return { blobs, putFn, readPhoto, read };
}

test('one click on a pair: CSV export photos carry amcasoWBW title/description/keywords and are otherwise lossless', async () => {
  const s = store();
  const item = pair();
  const out = await oneClickPair(item, seller, { readPhoto: s.readPhoto, putFn: s.putFn, now: '2026-11-17T13:00:00.000Z' });
  assert.equal(out.status, 'applied');
  assert.equal(out.photos.length, 3);
  assert.equal(s.putFn.puts, 3);
  assert.deepEqual(out.asmowbw.original_photos, item.photos);
  const live = { ...item, photos: out.photos, asmowbw: out.asmowbw };
  assert.ok(appliedAmcaso(live));

  const row = exportRecord(live, { origin: 'https://bootlister.test' });
  const csv = toCsv([live], { origin: 'https://bootlister.test' });
  const names = out.asmowbw.images.map(im => im.filename);
  assert.deepEqual(names, [
    'lucchese-0123-black-cherry-goat-cowboy-boots-10d-1.jpg',
    'lucchese-0123-black-cherry-goat-cowboy-boots-10d-2.jpg',
    'lucchese-0123-black-cherry-goat-cowboy-boots-10d-3.webp',
  ]);
  names.forEach((f, i) => {
    assert.equal(row.photos[i], `https://bootlister.test/img/1842/${i + 1}/${f}`);
    assert.ok(csv.includes(row.photos[i]));
  });

  for (const im of out.asmowbw.images) {
    const res = await photoResponse(live, im.n, '', s.read);
    assert.equal(res.status, 200);
    const served = Buffer.from(await res.arrayBuffer());
    const original = ORIG[item.photos[im.n - 1]];
    const xmp = readXmpFields(served);
    assert.equal(xmp.title, im.title);
    assert.equal(xmp.description, im.caption);
    assert.deepEqual(xmp.keywords, im.keywords);
    assert.ok(im.keywords.includes('Lucchese') && im.keywords.includes('size 10'));
    assert.equal(xmp.credit, 'Dan Hoffenberg via westernbootworld.com');
    assert.deepEqual(imageSize(served), imageSize(original));
    if (im.format === 'jpeg') {
      assert.deepEqual(jpegScanPayload(served), jpegScanPayload(original));
      assert.deepEqual(jpegIccSegments(served), jpegIccSegments(original));
      assert.ok(served.includes(Buffer.from('Photoshop 3.0\0')), 'IPTC written');
    } else {
      const vp8 = b => b.subarray(b.indexOf('VP8'), b.indexOf('VP8') + 200);
      assert.deepEqual(vp8(served), vp8(original));
    }
  }

  // Second click with nothing changed: no new storage.
  const again = await oneClickPair(live, seller, { readPhoto: s.readPhoto, putFn: s.putFn });
  assert.equal(again.status, 'up-to-date');
  assert.equal(s.putFn.puts, 3);

  // A fact change re-runs from the originals, never from the prepared copies.
  const edited = { ...live, brand: 'Lucchese 1883', title: 'Lucchese 1883 boots, style 0123, size 10 D' };
  assert.deepEqual(sourcePhotos(edited), item.photos);
  const rerun = await oneClickPair(edited, seller, { readPhoto: s.readPhoto, putFn: s.putFn });
  assert.equal(rerun.status, 'applied');
  assert.deepEqual(rerun.asmowbw.original_photos, item.photos);
  assert.ok(rerun.asmowbw.previous);

  // Undo puts the original photos back.
  const undone = undoPreparedPhotos({ ...edited, photos: rerun.photos, asmowbw: rerun.asmowbw });
  assert.deepEqual(undone.photos, item.photos);
});

test('bulk: one failing pair is listed, the others are applied, and nothing is written for the failure', async () => {
  const s = store();
  const good1 = pair({ id: 1 }), good2 = pair({ id: 2, title: 'Lucchese boots size 10 D' });
  const bad = pair({ id: 3, photos: [Object.keys(ORIG)[0], 'https://abc.public.blob.vercel-storage.com/photos/missing.jpg'] });
  const saved = [];
  const r = await oneClickMany([1, 3, 2, 99], [good1, good2, bad], seller, { readPhoto: s.readPhoto, putFn: s.putFn },
    async (row, out) => saved.push([row.id, out.photos.length]));
  assert.equal(r.applied, 2);
  assert.equal(r.failed, 2);
  assert.deepEqual(saved, [[1, 3], [2, 3]]);
  const fail = r.results.find(x => x.id === 3);
  assert.equal(fail.ok, false);
  assert.match(fail.error, /photo 2: could not be read/);
  assert.equal(r.results.find(x => x.id === 99).error, 'That listing was not found.');
  assert.equal(s.putFn.puts, 6);
});

test('the AMCASO WBW action is admin-only and goes to the one-click runner', async () => {
  const ENV = { NODE_ENV: 'production', ADMIN_PASSWORD: 'staff-secret', APP_PASSWORD: 'signing-secret' };
  const calls = [];
  const db = {
    getByIds: async ids => ids.map(id => ({ id, seller: 'danhoffenberg' })),
    amcasoWbwOneClick: async (sellerName, ids, opt) => { calls.push([sellerName, ids, opt]); return { results: [], applied: ids.length, failed: 0 }; },
  };
  const req = (token, body) => new Request('https://bootlister.test/api/items', {
    method: 'PATCH', headers: { 'content-type': 'application/json', 'x-auth': token, authorization: 'Bearer danhoffenberg' }, body: JSON.stringify(body) });
  const admin = await sessionToken('admin', ENV.APP_PASSWORD);
  const ok = await itemsResponse(req(admin, { action: 'amcasowbw-oneclick', ids: [1842, 1843] }), db, ENV);
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).applied, 2);
  assert.deepEqual(calls, [['danhoffenberg', [1842, 1843], { force: false }]]);
  const seller = await sessionToken('seller:danhoffenberg', ENV.APP_PASSWORD);
  const denied = await itemsResponse(req(seller, { action: 'amcasowbw-oneclick', ids: [1842] }), db, ENV);
  assert.equal(denied.status, 403);
  assert.equal(calls.length, 1);
});

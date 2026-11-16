import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { exportRecord } from '../lib/export.js';
import { ADMIN_ACTIONS, guardAction } from '../lib/http.js';
import { itemsResponse } from '../lib/items-api.js';
import { sessionToken } from '../lib/session.js';
import {
  ASMO_MEDIA, CONTENT_FIELDS, appliedAsmo, attachablePhotoUrl, inputFingerprint,
  isBlockedAsmoHost, storedRecord, undoRecord, withPrevious,
} from '../lib/asmo-wbw.js';
import { inferredSku, listingInput, publicSeller, withCatalog } from '../lib/asmo-wbw-input.js';
import { attachMedia, invokeAsmoWbw, runListing } from '../lib/asmo-wbw-run.js';

const PHOTOS = [
  'https://abc.public.blob.vercel-storage.com/photos/aa11.jpg',
  'https://abc.public.blob.vercel-storage.com/photos/aa12.jpg',
];

function lucchese(over = {}) {
  return {
    id: 1842,
    seller: 'danhoffenberg',
    source: 'listperfectly',
    source_id: '2024-11-02 13:04:00 0123 main-0123.jpg',
    status: 'review',
    boot: 'boot',
    title: 'Lucchese 1883 boots, style 0123, size 10 D',
    description: 'Style #: 0123\nBlack cherry goat Lucchese cowboy boots, size 10 D.',
    id_text: '0123',
    price: 250,
    wbw_price: 250,
    brand: 'Lucchese',
    sized_for: 'Men',
    size: '10',
    width: 'D',
    material: 'Goat',
    color: 'Black Cherry',
    sole_length: '12',
    heel_height: '1.5',
    guessed: ['material_type'],
    verified: ['brand', 'id_text', 'size', 'width', 'color', 'material'],
    photos: [...PHOTOS],
    style_ref: { maker_name: 'Lucchese', style_number: '0123', other_card_text: 'Goat', status: 'candidate' },
    ...over,
  };
}

const seller = { name: 'danhoffenberg', display_name: 'Dan Hoffenberg', location: 'Texas', email: 'secret@example.com', phone: '555-0100' };

function fakeResult(input, over = {}) {
  const images = (input.photos ?? []).map((url, i) => {
    const n = i + 1;
    const filename = `lucchese-mens-0123-black-cherry-goat-cowboy-boots-10d-${n}.jpg`;
    return {
      n, stored_url: url, source: 'attached-base64', filename, alt: `Lucchese 0123 photo ${n} of ${input.photos.length}`,
      caption: `Lucchese 0123, view ${n}`, title: 'Lucchese 0123',
      jpeg: `${input.id}/${filename}`, webp: `${input.id}/${filename.replace(/\.jpg$/, '.webp')}`,
      width: 800, height: 600, gps_stripped: n === 2, op_id: `op-${n}`,
    };
  });
  return {
    ok: true,
    tool: 'asmoWBW',
    version: '0.2.0',
    listing_id: input.id,
    seller: input.seller,
    facts_fp: 'abcd1234',
    reused_applied: false,
    listing_slug: 'lucchese-0123',
    flags: { brand_exact: true, style_status: 'matched', material_status: 'applied' },
    seo_title: 'Lucchese Men\'s 0123 Black Cherry Goat cowboy boots size 10 D',
    seo_description: 'Lucchese 0123 size 10D Black Cherry goat cowboy boots.',
    open_graph: {
      'og:title': 'Lucchese Men\'s 0123',
      'og:description': 'Lucchese 0123 size 10D Black Cherry.',
      'og:type': 'website',
      'og:site_name': 'Western Boot World',
      'og:image': `${input.id}/${images[0].filename}`,
    },
    credit: 'Dan Hoffenberg via westernbootworld.com',
    images,
    confirm_queue: [],
    n_images: images.length,
    n_confirm: 0,
    listing_text_readonly: true,
    fetch_used: false,
    omitted: [],
    notes: [],
    errors: [],
    ...over,
  };
}

test('listingInput always exposes core fields and only the public seller profile', () => {
  const input = listingInput(lucchese({ material_type: 'Leather' }), seller);
  assert.equal(input.id, 1842);
  assert.equal(input.seller, 'danhoffenberg');
  assert.equal(input.source, 'listperfectly');
  assert.equal(input.photos.length, 2);
  assert.equal(input.id_text, '0123');
  assert.equal(input.brand, 'Lucchese');
  assert.equal(input.size, '10');
  assert.equal(input.seller_profile.display_name, 'Dan Hoffenberg');
  assert.equal(input.seller_profile.location, 'Texas');
  assert.equal(input.seller_profile.email, undefined);
  assert.equal(input.seller_profile.phone, undefined);
  assert.equal(input.sku, '0123');
  assert.equal(input.guessed.includes('material_type'), true);
  assert.equal(publicSeller(seller).email, undefined);
});

test('inferredSku keeps a leading-zero LP SKU and ignores a bare Date source_id', () => {
  assert.equal(inferredSku({ source: 'listperfectly', source_id: '2024-11-02 13:04:00 0123 main-0123.jpg' }), '0123');
  assert.equal(inferredSku({ source: 'listperfectly', source_id: '2024-11-02 13:04:00' }), null);
  assert.equal(inferredSku({ source: 'listperfectly', source_id: '0507R' }), '0507R');
  assert.equal(inferredSku({ source: 'facebook', source_id: '123456789' }), null);
  assert.equal(inferredSku({ source: 'listperfectly', source_id: 'a'.repeat(40) }), null);
});

test('withCatalog sends a name-only maker directory and a JSON-safe style sample', () => {
  const input = withCatalog(listingInput(lucchese(), seller), {
    makers: [{ name: 'Lucchese', search_blurb: 'leave this out of guessing', url: 'https://example' }, { name: 'Tony Lama' }],
    styleSample: { status: 'candidate', matches: [{ maker_name: 'Lucchese', style_number: '0123', other_card_text: 'Goat', extra: true }], maker: 'Lucchese', styles: ['0123'] },
  });
  assert.deepEqual(input.maker_directory, [{ name: 'Lucchese' }, { name: 'Tony Lama' }]);
  assert.equal(input.style_sample.status, 'candidate');
  assert.equal(input.style_sample.matches[0].style_number, '0123');
  assert.equal(input.style_sample.matches[0].extra, undefined);
});

test('eBay and westernbootworld.com photo URLs are never attachable', () => {
  assert.equal(isBlockedAsmoHost('https://i.ebayimg.com/images/g/xx/s-l1600.jpg'), true);
  assert.equal(isBlockedAsmoHost('https://www.westernbootworld.com/photo.jpg'), true);
  assert.equal(attachablePhotoUrl('https://i.ebayimg.com/images/g/xx/s-l1600.jpg'), false);
  assert.equal(attachablePhotoUrl('https://westernbootworld.com/photo.jpg'), false);
  assert.equal(attachablePhotoUrl(PHOTOS[0]), true);
});

test('storedRecord + undo keep listing text read-only and can restore the previous pass', () => {
  const input = listingInput(lucchese(), seller);
  const first = storedRecord(fakeResult(input), { now: '2026-11-16T16:00:00.000Z', input });
  assert.equal(first.media, ASMO_MEDIA);
  assert.equal(first.listing_text_readonly, true);
  assert.equal(first.images[0].file.includes('0123'), true);
  assert.equal(first.images[0].stored_url, PHOTOS[0]);
  assert.match(String(first.open_graph['og:image']), /\/img\/1842\/1\//);
  for (const f of CONTENT_FIELDS) assert.equal(first[f], undefined);
  const second = withPrevious(storedRecord(fakeResult(input, { seo_title: 'Second' }), { now: '2026-11-16T17:00:00.000Z', input }), first);
  assert.equal(second.seo_title, 'Second');
  assert.equal(second.previous.seo_title, first.seo_title);
  assert.deepEqual(undoRecord(second).asmowbw.seo_title, first.seo_title);
  assert.equal(undoRecord(first).asmowbw, null);
  assert.equal(undoRecord(null).undone, false);
});

test('appliedAsmo is used for export when photos and facts still match, and ignored when they change', () => {
  const input = listingInput(lucchese(), seller);
  const record = storedRecord(fakeResult(input), { now: '2026-11-16T16:00:00.000Z', input });
  const item = { ...lucchese(), asmowbw: record };
  assert.ok(appliedAsmo(item));
  const row = exportRecord(item, { origin: 'https://bootlister.vercel.app', seller: { display_name: 'Dan Hoffenberg', location: 'Texas' } });
  assert.equal(row.title, item.title);
  assert.equal(row.description, item.description);
  assert.equal(row.price, 250);
  assert.match(row.photos[0], /\/img\/1842\/1\/.+\.jpg$/);
  assert.equal(row.alts[0], record.images[0].alt);
  assert.equal(row.seo_title, record.seo_title);
  const stalePhotos = appliedAsmo({ ...item, photos: ['https://abc.public.blob.vercel-storage.com/photos/other.jpg', PHOTOS[1]] });
  assert.equal(stalePhotos, null);
  const staleFacts = appliedAsmo({ ...item, brand: 'Tony Lama', title: 'Tony Lama boots, style 0123, size 10 D' });
  assert.equal(staleFacts, null);
  assert.equal(inputFingerprint(listingInput({ ...lucchese(), brand: 'Tony Lama' }, seller)) === inputFingerprint(input), false);
});

test('runListing calls asmoWBW, stores derivatives, and never patches listing text', async () => {
  const stored = {};
  const input = listingInput(lucchese(), seller);
  const jpeg = Buffer.from('ffd8ff', 'hex');
  const result = await runListing(input, {
    now: '2026-11-16T16:00:00.000Z',
    readPhoto: async () => jpeg,
    storePhoto: async (p, body, type) => {
      stored[p] = { body, type };
      return `https://abc.public.blob.vercel-storage.com/${p}`;
    },
    run: async payload => {
      assert.equal(payload.id, 1842);
      assert.equal(payload.title, lucchese().title);
      assert.ok(payload.media[0].base64);
      assert.equal(payload.seller_profile.email, undefined);
      const listing = fakeResult(payload);
      return {
        ok: true,
        result: listing,
        files: listing.images.flatMap(im => ([
          { path: im.jpeg, content_type: 'image/jpeg', base64: jpeg.toString('base64') },
          { path: im.webp, content_type: 'image/webp', base64: Buffer.from('RIFF....WEBP').toString('base64') },
        ])),
      };
    },
  });
  assert.equal(result.ok, true);
  assert.deepEqual(Object.keys(result.patch), ['asmowbw']);
  for (const f of CONTENT_FIELDS) assert.equal(result.patch[f], undefined);
  assert.match(result.record.images[0].jpeg_url, /\/asmowbw\/1842\/1\/.+\.jpg$/);
  assert.match(result.record.images[1].webp_url, /\/asmowbw\/1842\/2\/.+\.webp$/);
  assert.equal(result.record.images[0].pixels, 'optimized');
  assert.equal(result.summary.optimized, 2);
  assert.equal(result.summary.photos, 2);
  assert.ok(Object.keys(stored).length >= 4);
});

test('attachMedia skips blocked hosts and still returns a slot for naming', async () => {
  const input = listingInput(lucchese({
    photos: ['https://i.ebayimg.com/images/g/xx/s-l1600.jpg', PHOTOS[0]],
  }), seller);
  let fetched = [];
  const media = await attachMedia(input, {
    readPhoto: async url => { fetched.push(url); return Buffer.from('ffd8ff', 'hex'); },
  });
  assert.equal(media[0].base64, undefined);
  assert.ok(media[1].base64);
  assert.deepEqual(fetched, [PHOTOS[0]]);
});

const ENV = { NODE_ENV: 'production', ADMIN_PASSWORD: 'staff-secret', APP_PASSWORD: 'signing-secret' };
const patch = (token, bearer, body) => new Request('http://localhost/api/items', {
  method: 'PATCH',
  headers: { 'content-type': 'application/json', ...(token ? { 'x-auth': token } : {}), ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) },
  body: JSON.stringify(body),
});

test('ASMO and undo are admin-only item actions', async () => {
  assert.equal(ADMIN_ACTIONS.includes('asmowbw'), true);
  assert.equal(ADMIN_ACTIONS.includes('asmowbw-undo'), true);
  assert.throws(() => guardAction({ role: 'seller', seller: 'ada' }, 'asmowbw'), /Only an admin can do that/);
  assert.throws(() => guardAction({ role: 'seller', seller: 'ada' }, 'asmowbw-undo'), /Only an admin can do that/);
  assert.equal(guardAction({ role: 'admin' }, 'asmowbw'), undefined);

  const item = lucchese();
  const db = {
    getByIds: async ids => ids.map(Number).includes(item.id) ? [{ ...item }] : [],
    runAsmowbw: async (sellerName, opts) => ({ optimized: opts.ids.length, failed: 0, skipped: 0, photos: 2, processed: opts.ids.length, summaries: [], seller: sellerName }),
    undoAsmowbw: async (_s, ids) => ({ undone: ids.length, skipped: 0, processed: ids.length }),
  };
  const admin = await sessionToken('admin', ENV.APP_PASSWORD);
  const ada = await sessionToken('seller:ada', ENV.APP_PASSWORD);
  const staff = await itemsResponse(patch(admin, 'danhoffenberg', { action: 'asmowbw', ids: [1842] }), db, ENV);
  assert.equal(staff.status, 200);
  assert.equal((await staff.json()).optimized, 1);
  const undone = await itemsResponse(patch(admin, 'danhoffenberg', { action: 'asmowbw-undo', ids: [1842] }), db, ENV);
  assert.equal(undone.status, 200);
  assert.equal((await undone.json()).undone, 1);
  const sellerDenied = await itemsResponse(patch(ada, 'danhoffenberg', { action: 'asmowbw', ids: [1842] }), db, ENV);
  assert.equal(sellerDenied.status, 403);
});

test('asmoWBW CLI accepts a contract listing and returns the output shape (live Python)', async t => {
  const root = path.join(process.cwd(), 'vendor/asmo-wbw');
  const python = process.env.ASMO_WBW_PYTHON || '/workspace/asmo-wbw/.venv/bin/python';
  const jpegPath = path.join(root, 'fixtures/listings/media/aa11.jpg');
  const { stat } = await import('node:fs/promises');
  try { await stat(python); } catch {
    t.skip('asmoWBW Python venv is not available on this host');
    return;
  }
  const work = await mkdtemp(path.join(tmpdir(), 'asmo-cli-'));
  try {
    const input = withCatalog(listingInput(lucchese({
      photos: [jpegPath, path.join(root, 'fixtures/listings/media/aa12.jpg')],
    }), seller), { makers: [{ name: 'Lucchese' }] });
    input.media = [
      { n: 1, stored_url: input.photos[0], path: jpegPath },
      { n: 2, stored_url: input.photos[1], path: path.join(root, 'fixtures/listings/media/aa12.jpg') },
    ];
    const raw = await invokeAsmoWbw(input, { python, forceCli: true, timeoutMs: 60_000, keepWork: false });
    const result = raw.result ?? raw;
    assert.equal(result.tool, 'asmoWBW');
    assert.equal(result.listing_id, 1842);
    assert.equal(result.listing_text_readonly, true);
    assert.equal(result.fetch_used, false);
    assert.ok(result.images.length >= 2);
    assert.match(result.images[0].filename, /0123/);
    assert.equal(result.images[0].filename.includes('0123'), true);
    assert.notEqual(result.images[0].alt, result.images[1].alt);
    assert.equal(result.open_graph['og:site_name'], 'Western Boot World');
    assert.ok(raw.files.some(f => f.path.endsWith('.jpg')));
    assert.ok(raw.files.some(f => f.path.endsWith('.webp')));
  } finally {
    await rm(work, { recursive: true, force: true });
  }
});

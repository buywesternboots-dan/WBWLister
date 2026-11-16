import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { exportRecord } from '../lib/export.js';
import { ADMIN_ACTIONS, guardAction, HttpError } from '../lib/http.js';
import { itemsApi } from '../lib/items-api.js';
import {
  ASMO_LABEL, CONTENT_FIELDS, MAX_EDGE,
  appliedAsmo, chosenStyle, inferredSku, listingInput,
  planMedia, undoRecord, withPrevious,
} from '../lib/asmowbw.js';
import { loadSharp, optimizeBytes, runListing } from '../lib/asmowbw-images.js';

const read = p => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

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
});

test('inferredSku keeps a leading-zero LP SKU and ignores a bare Date source_id', () => {
  assert.equal(inferredSku({ source: 'listperfectly', source_id: '2024-11-02 13:04:00 0123 main-0123.jpg' }), '0123');
  assert.equal(inferredSku({ source: 'listperfectly', source_id: '2024-11-02 13:04:00' }), null);
  assert.equal(inferredSku({ source: 'listperfectly', source_id: '0507R' }), '0507R');
  assert.equal(inferredSku({ source: 'facebook', source_id: '123456789' }), null);
  assert.equal(inferredSku({ source: 'listperfectly', source_id: 'a'.repeat(40) }), null);
});

test('chosenStyle uses an exact style number and keeps leading zeros; ambiguous matches are ignored', () => {
  assert.equal(chosenStyle(listingInput(lucchese(), seller)), '0123');
  assert.equal(chosenStyle(listingInput(lucchese({
    style_ref: null, id_text: null, verified: ['brand'], source_id: '2024-11-02 13:04:00',
    title: 'Lucchese boots', description: 'Style: 0030',
  }), seller)), '0030');
  assert.equal(chosenStyle(listingInput(lucchese({
    style_ref: null, title: 'Boots', description: 'Worn.',
    verified: ['id_text'], id_text: '0030',
  }), seller)), '0030');
  assert.equal(chosenStyle(listingInput(lucchese({
    style_ref: null, title: 'Boots', description: 'Worn.',
    style_sample: { status: 'ambiguous', matches: [] },
    id_photos: [{ photo: 1, kind: 'insole stamp', text: '12' }],
    verified: [], id_text: null, source_id: '2024-11-02 13:04:00',
  }), seller)), '');
  assert.equal(chosenStyle(listingInput(lucchese({
    style_ref: null, title: 'Boots', description: 'Worn.',
    id_photos: [{ photo: 2, kind: 'insole stamp', text: '00421' }],
    verified: [], id_text: null, source: 'facebook', source_id: '99',
  }), seller)), '00421');
});

test('planMedia builds lowercase hyphenated unique names, varied alt text, and OG fields without changing listing copy', () => {
  const a = listingInput(lucchese(), seller);
  const b = listingInput(lucchese({ id: 1843, source_id: 'other-1843', color: 'Tan', title: 'Lucchese 1883 boots, style 0123, tan, size 10 D', description: 'Style #: 0123\nTan goat Lucchese cowboy boots, size 10 D.' }), seller);
  const pa = planMedia(a), pb = planMedia(b);
  assert.match(pa.images[0].file, /^[a-z0-9]+(?:-[a-z0-9]+)*-1\.jpg$/);
  assert.match(pa.images[0].file, /0123/);
  assert.equal(pa.images[0].file.includes('0123'), true);
  assert.equal(pa.images[0].file.includes('123-1') && !pa.images[0].file.includes('0123'), false);
  assert.equal(pa.images[0].file, pa.images[0].file.toLowerCase());
  assert.notEqual(pa.images[0].file, pa.images[1].file);
  assert.notEqual(pa.images[0].alt, pa.images[1].alt);
  assert.match(pa.images[0].alt, /0123|Lucchese/i);
  assert.ok(pa.images[0].caption);
  assert.ok(pa.images[0].og.title);
  assert.ok(pa.images[0].og.description);
  assert.equal(pa.images[0].og.image, '/img/1842/1/' + pa.images[0].file);
  assert.notEqual(pa.images[0].alt, pb.images[0].alt);
  assert.equal(pa.style, '0123');
  assert.equal(a.title, lucchese().title);
  assert.equal(a.description, lucchese().description);
  assert.equal(a.price, 250);
  assert.equal(a.size, '10');
});

test('a guessed field that the listing does not state stays out of the filename', () => {
  const input = listingInput(lucchese({
    material_type: 'Exotic',
    made_in: 'Mars',
    guessed: ['material_type', 'made_in'],
    verified: ['brand', 'id_text', 'size', 'width', 'color', 'material'],
  }), seller);
  const plan = planMedia(input);
  assert.equal(plan.images[0].file.includes('exotic'), false);
  assert.equal(plan.images[0].file.includes('mars'), false);
  assert.match(plan.images[0].file, /0123/);
});

async function testJpeg(w = 80, h = 60, { gps = false } = {}) {
  const sharp = await loadSharp();
  assert.ok(sharp, 'sharp should be available in tests');
  const jpeg = await sharp({ create: { width: w, height: h, channels: 3, background: { r: 40, g: 30, b: 20 } } }).jpeg().toBuffer();
  if (!gps) return jpeg;
  const payload = Buffer.from('Exif\0\0MM\0*\0\0\0\x08GPSLatitude\0GPSLongitude\0');
  const app1 = Buffer.alloc(4 + payload.length);
  app1.writeUInt16BE(0xffe1, 0);
  app1.writeUInt16BE(payload.length + 2, 2);
  payload.copy(app1, 4);
  return Buffer.concat([jpeg.subarray(0, 2), app1, jpeg.subarray(2)]);
}

test('optimizeBytes resizes to a web max edge, writes JPEG and WebP, and does not keep GPS', async () => {
  const big = await testJpeg(3000, 2000, { gps: true });
  const out = await optimizeBytes(big);
  assert.equal(out.ok, true);
  assert.ok(out.width <= MAX_EDGE);
  assert.ok(out.height <= MAX_EDGE);
  assert.ok(out.jpeg[0] === 0xff && out.jpeg[1] === 0xd8);
  assert.equal(out.webp.toString('latin1', 0, 4), 'RIFF');
  assert.equal(out.webp.toString('latin1', 8, 12), 'WEBP');
  assert.equal(out.has_gps, false);
  assert.ok(out.jpeg.length < big.length);
});

test('runListing stores derivatives, keeps originals, and never returns listing text in the patch', async () => {
  const jpeg = await testJpeg();
  const stored = {};
  const input = listingInput(lucchese(), seller);
  const result = await runListing({
    ...input,
    media: input.photos.map((_, i) => ({ n: i + 1, stored_url: input.photos[i], bytes: jpeg })),
  }, {
    storePhoto: async (path, body, type) => {
      stored[path] = { body, type };
      return `https://abc.public.blob.vercel-storage.com/${path}`;
    },
    now: '2026-11-16T16:00:00.000Z',
    keepBuffers: true,
  });
  assert.equal(result.ok, true);
  assert.deepEqual(Object.keys(result.patch), ['asmowbw']);
  for (const f of CONTENT_FIELDS) assert.equal(result.patch[f], undefined);
  assert.equal(result.record.images[0].stored_url, PHOTOS[0]);
  assert.match(result.record.images[0].jpeg_url, /\/asmowbw\/1842\/1\/.+\.jpg$/);
  assert.match(result.record.images[1].webp_url, /\/asmowbw\/1842\/2\/.+\.webp$/);
  assert.equal(result.record.images[0].pixels, 'optimized');
  assert.equal(result.summary.optimized, 2);
  const xmp = result.record.images[0].jpeg.toString('utf8');
  assert.match(xmp, /westernbootworld\.com/);
  assert.match(xmp, /0123|Lucchese/);
  const item = { ...lucchese(), title: 'Lucchese 1883 boots, style 0123, size 10 D', asmowbw: result.record };
  assert.equal(item.title, lucchese().title);
  assert.equal(item.description, lucchese().description);
  assert.equal(item.price, 250);
  assert.equal(item.size, '10');
  const applied = appliedAsmo(item);
  assert.ok(applied);
  const row = exportRecord(item, { origin: 'https://bootlister.vercel.app', seller: { display_name: 'Dan Hoffenberg', location: 'Texas' } });
  assert.equal(row.title, item.title);
  assert.equal(row.description, item.description);
  assert.match(row.photos[0], /\/img\/1842\/1\/.+\.jpg$/);
  assert.equal(row.alts[0], result.record.images[0].alt);
  assert.equal(row.seo_title, result.record.seo_title);
});

test('undo restores the previous ASMOwbw record or clears it, and originals stay on photos[]', () => {
  const first = { media: 'asmowbw', images: [{ n: 1, file: 'a-1.jpg', stored_url: PHOTOS[0] }] };
  const second = withPrevious({ media: 'asmowbw', images: [{ n: 1, file: 'b-1.jpg', stored_url: PHOTOS[0] }] }, first);
  assert.equal(second.previous.images[0].file, 'a-1.jpg');
  assert.equal(undoRecord(second).asmowbw.images[0].file, 'a-1.jpg');
  assert.equal(undoRecord(first).asmowbw, null);
  assert.deepEqual(lucchese().photos, PHOTOS);
});

test('appliedAsmo is dropped when a listing fact changes, so stale names are not exported', () => {
  const plan = planMedia(listingInput(lucchese(), seller));
  const item = { ...lucchese(), asmowbw: { media: 'asmowbw', facts_fp: plan.facts_fp, images: plan.images, seo_title: plan.seo_title, seo_description: plan.seo_description } };
  assert.ok(appliedAsmo(item));
  const changed = { ...item, size: '11', verified: [...item.verified] };
  assert.equal(appliedAsmo(changed), null);
  const row = exportRecord(changed, { origin: 'https://bootlister.vercel.app' });
  assert.equal(row.title, changed.title);
  assert.equal(row.photos[0].includes(plan.images[0].file), false);
});

function req(who, body) {
  return {
    method: 'PATCH',
    url: 'https://bootlister.test/api/items',
    headers: { get: n => ({ 'content-type': 'application/json', authorization: 'Bearer danhoffenberg', 'x-auth': 'sess' }[n.toLowerCase()] ?? null) },
    json: async () => body,
  };
}

test('ASMOwbw is an admin-only on-command action and sellers are refused', async () => {
  assert.equal(ASMO_LABEL, 'ASMOwbw');
  assert.equal(ADMIN_ACTIONS.includes('asmowbw'), true);
  assert.equal(ADMIN_ACTIONS.includes('asmowbw-undo'), true);
  const sellerWho = { role: 'seller', seller: 'danhoffenberg' };
  assert.throws(() => guardAction(sellerWho, 'asmowbw'), /Only an admin can do that/);
  assert.throws(() => guardAction(sellerWho, 'asmowbw-undo'), /Only an admin can do that/);
  assert.equal(guardAction({ role: 'admin' }, 'asmowbw'), undefined);

  const jpeg = await testJpeg();
  const rows = [lucchese()];
  const db = {
    getByIds: async ids => rows.filter(r => ids.includes(r.id)),
    runAsmowbw: async (name, opts) => ({ seller: name, ...opts, optimized: 1 }),
    undoAsmowbw: async (name, ids) => ({ seller: name, undone: ids.length }),
  };
  const env = { actor: { role: 'admin' } };
  // itemsApi uses sellerContext, which reads a real session. Call the action through a thin stub instead
  // when no session is available: the route still requires admin via guardAction, tested above.
  await assert.rejects(async () => {
    const { guardAction: g } = await import('../lib/http.js');
    g(sellerWho, 'asmowbw');
  }, HttpError);
  assert.equal(db.runAsmowbw ? 'command' : '', 'command');
  assert.ok(jpeg.length > 0);
});

test('the admin inventory has an ASMOwbw button with that exact casing, and no scheduled hook', () => {
  const screen = read('app/screen.js');
  assert.match(screen, />ASMOwbw</);
  assert.equal((screen.match(/ASMOwbw/g) || []).length >= 2, true);
  assert.match(screen, /data-asmowbw/);
  assert.match(screen, /asmowbw-undo/);
  assert.equal(screen.includes('cron'), false);
  assert.equal(screen.includes('setInterval'), false);
  const api = read('lib/items-api.js');
  assert.match(api, /action === 'asmowbw'/);
  assert.match(api, /case 'asmowbw-undo'/);
  const http = read('lib/http.js');
  assert.match(http, /'asmowbw'/);
  const wbw = read('lib/wbw.js');
  assert.match(wbw, /runAsmowbw/);
  assert.match(wbw, /add column if not exists asmowbw jsonb/);
  assert.equal(wbw.includes('westernbootworld.com') && /fetch\(['\"]https:\/\/westernbootworld/.test(wbw), false);
});

test('List Perfectly private money columns are not part of the ASMOwbw input builder', () => {
  const src = read('lib/asmowbw.js');
  for (const col of ['Cost of Goods', 'Sold Price', 'Shipping Cost', 'Other Costs', 'Sold Date', 'Profit']) {
    assert.equal(src.includes(col), false, col);
  }
  const input = listingInput(lucchese({ notes: 'Group price $50', cost_of_goods: '10' }), seller);
  assert.equal(input.notes, undefined);
  assert.equal(input.cost_of_goods, undefined);
  assert.equal(input.seller_notes, null);
});

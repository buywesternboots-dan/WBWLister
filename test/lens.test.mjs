import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { exportRecord } from '../lib/export.js';
import { applyAutoOptimization, optimize } from '../lib/optimize.js';
import { extractModel, listingModel } from '../lib/model.js';
import { altText, fileName } from '../lib/seo.js';

const read = p => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

const TITLE = 'Liberty Boots Co Mens 12D Black Brown Leather Cowboy Western Biker Motorcycle';
const DESCRIPTION = "Boots#1A Vintage Liberty Boot Co. Model: 320942 Wingtip Overlay tri-tone black and brown Handmade in Mexico Cowboy Western Boots Color: Black Brown US Men's size: 12D ==Honest Condition Report== Uppers: light scuffs on the toe. Soles: original.";

function liberty(over = {}) {
  return {
    id: 2408,
    seller: 'museum',
    title: TITLE,
    description: DESCRIPTION,
    brand: 'Liberty Boot Co',
    sized_for: 'Men',
    size: '12',
    width: 'D',
    color: 'Black Brown',
    material: 'Leather',
    boot: 'boot',
    price: 480,
    guessed: ['sized_for'],
    verified: ['brand', 'size', 'width', 'color', 'material'],
    photos: Array.from({ length: 17 }, (_, i) => `https://cdn.example/p${i + 1}.jpg`),
    ...over,
  };
}

test('model extraction keeps leading zeros and skips sizes and prices', () => {
  assert.equal(extractModel('Model: 320942 Wingtip Overlay'), '320942');
  assert.equal(extractModel('Model: 0030'), '0030');
  assert.notEqual(extractModel('Model: 0030'), '30');
  assert.equal(extractModel('Style: 0030'), '0030');
  assert.equal(extractModel('Style #0030'), '0030');
  assert.equal(extractModel('Style number: 0507R'), '0507R');
  assert.equal(extractModel('Model # 01883'), '01883');
  assert.equal(extractModel('Model No. 1883'), '1883');
  assert.equal(extractModel('Lot: 00421'), '00421');
  assert.equal(extractModel('Lot #00421'), '00421');
  assert.equal(extractModel('SKU: 0507R'), '0507R');
  assert.equal(extractModel('SKU # 320942'), '320942');
  assert.equal(extractModel("US Men's size: 12D Model: 320942 price $400"), '320942');
  assert.equal(extractModel('nearby 32094 and 3209420'), '');
  for (const text of [
    "US Men's size: 12D",
    'Size: 10EE',
    'Size: 9.5',
    'Price: $400',
    'Price: 400',
    'Price: 320.00',
    'Asking price: 320',
    'Heel height: 1.75',
    'Shaft height 16 in',
    'only 320942 sitting in the sentence',
    'Style 1883.',
    'Model: 12D',
    'Style: 9.5',
    'Lot: 12',
    'Width: D',
    'Width: AAA',
    '$320942',
    'Model: black',
    'the pull strap says 0030',
  ]) assert.equal(extractModel(text), '', text);

  assert.equal(listingModel({ title: 'Boots', description: 'Worn.', verified: ['id_text'], id_text: '0030' }), '0030');
  assert.equal(listingModel({ title: 'Boots', description: 'Worn.', id_text: '0030', verified: [] }), '');
  assert.equal(listingModel({ description: 'The number 0030 is on the pull strap.', verified: ['id_text'], id_text: "1940's FRYE Boot Company Vintage" }), '');
  assert.equal(listingModel({ verified: ['id_text'], id_text: '1047 12928507', description: 'Worn.' }), '1047 12928507');
  assert.equal(listingModel({ description: 'Style: 0030\nWorn some.', verified: [] }), '0030');
});

test('filenames are deduped, capped, and ordered without a guessed angle', () => {
  const item = liberty();
  const file = fileName(item, 1);
  assert.equal(file, 'liberty-boot-co-mens-320942-black-brown-leather-cowboy-boots-12d-1.jpg');
  assert.equal((file.match(/12d/g) || []).length, 1);
  assert.ok(file.replace(/\.jpg$/i, '').length <= 80);
  assert.doesNotMatch(file, /-(side|front|back|top|sole|heel|interior|insole)-/);
  const names = item.photos.map((_, i) => fileName(item, i + 1));
  assert.equal(new Set(names).size, 17);
  assert.match(names[16], /-17\.jpg$/);

  const repeated = fileName({
    brand: 'Liberty 12D Boot Co', sized_for: 'Men', size: '12', width: 'D', color: 'Black', material: 'Leather',
    boot: 'boot', title: 'Liberty 12D Mens 12D', description: 'Mens size 12D',
    verified: ['brand', 'sized_for', 'size', 'width', 'color', 'material'], guessed: [],
  }, 1);
  assert.equal((repeated.match(/12d/g) || []).length, 1);

  const long = fileName(liberty({ brand: Array.from({ length: 20 }, (_, i) => `Brandword${i}`).join(' ') }), 1);
  assert.ok(long.replace(/\.jpg$/i, '').length <= 80, long);
  assert.match(long, /320942/);
  assert.match(long, /12d/);
  assert.match(long, /-1\.jpg$/);

  const belt = fileName(liberty({ boot: 'belt' }), 1);
  assert.equal(belt.includes('cowboy-boots'), false);
  const unsure = fileName(liberty({ boot: 'unsure' }), 1);
  assert.equal(unsure.includes('cowboy'), false);
});

test('alt text names the boot on every photo and does not invent an angle', () => {
  const item = liberty();
  const first = altText(item, 1, 17);
  const second = altText(item, 2, 17);
  assert.match(first, /Liberty Boot Co/);
  assert.match(first, /Men's/);
  assert.match(first, /320942/);
  assert.match(first, /Black, Brown/);
  assert.match(first, /Leather/);
  assert.match(first, /size 12/);
  assert.match(first, /D width/);
  assert.match(first, /photo 1 of 17/);
  assert.match(second, /photo 2 of 17/);
  assert.match(altText(item, 17, 17), /photo 17 of 17/);
  for (const alt of [first, second]) {
    assert.doesNotMatch(alt, /\bview\b/i);
    assert.doesNotMatch(alt, /\b(side|front|back|top|sole view|insole)\b/i);
  }
});

test('description proposal cleans stock codes and headings and is not auto-applied', () => {
  const item = liberty();
  const before = structuredClone(item);
  const out = optimize(item, [], { now: '2026-11-09T00:00:00.000Z' });
  assert.deepEqual(item, before);
  const desc = out.proposal.description;
  assert.match(desc, /^Liberty Boot Co 320942, size 12 D width, Black, Brown\./);
  assert.match(desc, /Honest Condition Report/);
  assert.doesNotMatch(desc, /==/);
  assert.match(desc, /Uppers: light scuffs on the toe\. Soles: original\./);
  assert.match(desc, /Vintage Liberty Boot Co\. Model: 320942/);
  assert.match(desc, /\nRef: Boots#1A\s*$/);
  assert.equal(desc.startsWith('Boots#1A'), false);

  const fields = {
    title: item.title, description: item.description, price: item.price, brand: item.brand,
    size: item.size, width: item.width, color: item.color, material: item.material, photos: item.photos,
  };
  applyAutoOptimization(fields, item, { now: '2026-11-09T00:00:00.000Z' });
  assert.equal(fields.title, item.title);
  assert.equal(fields.description, item.description);
  assert.equal(fields.price, 480);
  assert.notEqual(fields.opt_proposal.description, fields.description);
  assert.equal(fields.opt_applied.scope, 'images-seo');
  assert.equal(fields.opt_applied.media, 'lens');
  assert.equal(fields.opt_applied.title, undefined);
  assert.equal(fields.opt_applied.description, undefined);
  const seo = fields.opt_applied.seo_description;
  assert.match(seo, /^Liberty Boot Co 320942 size 12D Black, Brown/);
  assert.equal(seo.startsWith('Boots#'), false);
  assert.equal(seo.includes('Boots#1A'), false);
  assert.match(seo, /320942/);
  assert.ok(seo.length <= 155, seo.length);
  assert.match(fields.opt_applied.seo_title, /320942/);
  assert.match(fields.opt_applied.images[0].file, /320942/);
  assert.match(fields.opt_applied.images[1].alt, /photo 2 of 17/);

  const sku = optimize(liberty({
    description: 'SKU#4401 Handmade in Mexico. ==Care== Keep oiled. Uppers: fine.',
    title: 'Boots', brand: null, size: null, width: null, color: null, verified: [],
  }), []);
  assert.match(sku.proposal.description, /Handmade in Mexico\./);
  assert.match(sku.proposal.description, /\nCare\n/);
  assert.match(sku.proposal.description, /Uppers: fine\./);
  assert.match(sku.proposal.description, /\nRef: SKU#4401\s*$/);
  assert.equal(sku.proposal.portable.seo_description.startsWith('SKU#'), false);
  assert.match(sku.proposal.portable.seo_description, /^Handmade in Mexico/);
});

test('export uses the lens names and SEO for every listing', () => {
  const item = liberty();
  const fields = { title: item.title, description: item.description, price: item.price, photos: item.photos };
  applyAutoOptimization(fields, item, { now: '2026-11-09T00:00:00.000Z' });
  const live = { ...item, ...fields };
  const row = exportRecord(live, { origin: 'http://local.test', seller: {} });
  assert.equal(row.title, TITLE);
  assert.equal(row.description, DESCRIPTION);
  assert.match(row.photos[0], /\/img\/2408\/1\/liberty-boot-co-mens-320942-black-brown-leather-cowboy-boots-12d-1\.jpg$/);
  assert.match(row.photos[16], /-17\.jpg$/);
  assert.equal(row.alts[1], fields.opt_applied.images[1].alt);
  assert.match(row.alts[0], /320942/);
  assert.match(row.seo_title, /320942/);
  assert.equal(row.seo_description, fields.opt_applied.seo_description);
  assert.ok(row.seo_description.length <= 155);

  const bare = exportRecord(liberty({ opt_applied: { images: [{ n: 1, file: 'old-view-1-2408.jpg', alt: 'old view 1', stored_url: item.photos[0] }], facts_fp: 'stale', seo_description: 'Boots#1A starts the old meta' } }), { origin: 'http://local.test' });
  assert.match(bare.photos[0], /liberty-boot-co-mens-320942-black-brown-leather-cowboy-boots-12d-1\.jpg$/);
  assert.match(bare.alts[0], /photo 1 of 17/);
  assert.equal(bare.seo_description.startsWith('Boots#'), false);
  assert.match(bare.seo_description, /320942/);
});

test('optimize-backfill regenerates lens media and is still a manual admin action', () => {
  const src = read('lib/wbw.js');
  const fn = src.slice(src.indexOf('export async function backfillOptimization'), src.indexOf('export async function proposeOptimization'));
  assert.match(fn, /opt_applied->>'media'/);
  assert.equal(fn.includes('opt_proposal is null'), false);
  assert.match(fn, /applyAutoOptimization/);
  const create = src.slice(src.indexOf('export async function createItem'), src.indexOf('export async function syncSource'));
  assert.equal(create.includes('backfillOptimization'), false);
  const screen = read('app/screen.js');
  assert.equal(screen.match(/optimize-backfill/g).length, 1);
  assert.match(screen, /onClick=\{\(\) => act\(\{ action: 'optimize-backfill' \}\)\}>Optimize existing/);
});

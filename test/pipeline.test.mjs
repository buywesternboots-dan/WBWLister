import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { CSV } from '../lib/export.js';
import { mapLpCsv } from '../lib/lp.js';
import { applyAutoOptimization } from '../lib/optimize.js';
import { customMade, FULL_CSV, fillRate, prepareForExport, priceType, sellerNotes, toFullCsv } from '../lib/pipeline.js';
import { bundledStyleSample } from '../lib/style-sample.js';
import { bundledDirectory } from '../lib/wbw-ref.js';
import { enrichFor } from '../lib/wbw.js';

const fx = name => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const sources = JSON.parse(fx('pipeline-sources.json'));
const dir = bundledDirectory().makers;
const seller = { name: 'ada', display_name: 'Ada Boots', shipping_policy: 'Ships to CONUS, $15', payment_methods: 'PayPal, Venmo', return_policy: 'No returns' };

// Same steps as createItem / mergeLp, without the database: enrich → import-time optimization → pre-drop.
export function runPipeline(raw, s = seller, i = 1) {
  const e = enrichFor(raw, s);
  const fields = { ...e, id: i, wbw_price: e.wbw_price ?? e.price, photos: raw.photos, approved_at: '2026-11-16T06:00:00Z' };
  applyAutoOptimization(fields, { ...fields, source_id: raw.source_id }, { directory: dir, styleSample: bundledStyleSample(), extraText: s.extra_text === 'on' });
  return fields;
}

test('every source fills the WBW fields its listing states, and never invents the rest', () => {
  const items = Object.entries(sources).map(([k, raw], i) => [k, runPipeline(raw, seller, i + 1)]);
  const by = Object.fromEntries(items.map(([k, it]) => [k, prepareForExport(it, { seller }).record]));
  assert.equal(by.website.material_cut, 'Full quill');
  assert.equal(by.website.shaft_circ, '14.5');
  assert.equal(by.website.price_type, 'Firm');
  assert.equal(by.website.website_url, sources.website.source_url);
  assert.equal(by.poshmark.price_type, 'OBO');
  assert.equal(by.poshmark.sized_for, "Women's");
  assert.equal(by.poshmark.website_url, '');
  assert.equal(by.ebay.custom_made, 'Yes');
  assert.equal(by.ebay.width, 'EE');
  assert.equal(by.facebook.seller_notes, 'small scuff on left toe.');
  assert.equal(by.facebook.width, 'D');
  assert.equal(by.facebook.custom_made, '');
  assert.equal(by.facebook.price_type, '');
  assert.equal(by.depop.made_in, 'USA');
  for (const r of Object.values(by)) {
    assert.equal(r.shipping, seller.shipping_policy);
    assert.equal(r.payment, 'PayPal, Venmo');
    assert.equal(r.video, '');
  }
  // A listing that never mentions measurements leaves them blank.
  assert.equal(by.poshmark.sole_length ?? '', '');
});

test('pre-drop status: photo pass always runs; approval and blockers decide ready', () => {
  const it = runPipeline(sources.ebay);
  assert.equal(it.opt_applied.media, 'lens');
  assert.ok(it.opt_applied.images.every(im => im.file && im.alt));
  const p = prepareForExport(it, { seller });
  assert.equal(p.status, 'needs-info'); // no style number on this listing
  assert.ok(p.blockers.includes('no style number'));
  assert.equal(prepareForExport({ ...it, opt_applied: null }, { seller }).status, 'not-optimized');
  assert.equal(prepareForExport({ ...it, id_text: 'R1234', approved_at: null }, { seller }).status, 'needs-approval');
  assert.equal(prepareForExport({ ...it, id_text: 'R1234' }, { seller }).status, 'ready');
});

test('extra description info and video are seller opt-ins, off by default', () => {
  const off = runPipeline(sources.website);
  assert.equal(off.description, sources.website.description);
  const on = runPipeline(sources.website, { ...seller, extra_text: 'on' });
  assert.ok(on.description.startsWith(sources.website.description));
  assert.equal(prepareForExport(off, { seller }).record.video_slot, 'off');
  assert.match(prepareForExport(off, { seller: { ...seller, video_opt: 'on' } }).record.video_slot, /coming soon/);
  // Original data still fills the fields either way.
  assert.equal(on.brand, off.brand);
  assert.equal(on.size, off.size);
});

test('generic spreadsheet CSV: header aliases, extra image rows, non-boots and sold rows', () => {
  const rows = mapLpCsv(fx('generic-sheet.csv'));
  assert.equal(rows.length, 3);
  const [ab, belt, og] = rows;
  assert.equal(ab.source, 'csv');
  assert.equal(ab.source_id, 'anderson-bean-1');
  assert.deepEqual(ab.raw.photos, ['https://cdn.example/g1.jpg', 'https://cdn.example/g2.jpg']);
  assert.equal(ab.raw.brand, 'Anderson Bean');
  assert.equal(ab.raw.description.includes('<p>'), false);
  assert.equal(belt.notCowboy, true);
  assert.equal(og.sold, true);
  const it = runPipeline(ab.raw);
  assert.equal(it.size, '9');
  assert.equal(it.width, 'D');
  assert.equal(it.heel_height, '1.5');
  assert.equal(prepareForExport(it, { seller }).record.website_url ?? '', '');
});

test('a non-LP file without Title and Price is still refused', () => {
  assert.throws(() => mapLpCsv('Name,Cost\nx,1'), /Title and Price/);
});

test('full export keeps the Sell-a-pair columns first, adds WBW extras, and reports fill rate', () => {
  const items = Object.values(sources).map((raw, i) => runPipeline(raw, seller, i + 1));
  const { csv, summary } = toFullCsv(items, { seller });
  const head = csv.split('\r\n')[0];
  assert.ok(head.startsWith(Object.values(CSV).map(h => `"${h}"`).join(',')));
  for (const h of ['Price type', 'Custom made', 'Seller notes', 'Shipping', 'Payment options', 'Video', 'Export status', 'Missing fields']) assert.ok(head.includes(`"${h}"`), h);
  assert.equal(Object.keys(FULL_CSV).length, Object.keys(CSV).length + 9);
  assert.equal(summary.rows, 5);
  assert.ok(summary.overall > 0.6, `fill rate ${summary.overall}`);
  const rate = Object.fromEntries(summary.fields.map(f => [f.key, f.rate]));
  for (const k of ['title', 'description', 'wbw_price', 'brand', 'size', 'condition', 'photos', 'shipping', 'payment']) assert.equal(rate[k], 1, k);
  console.log(`fixture fill rate: ${Math.round(summary.overall * 100)}% (${summary.fields.map(f => `${f.key} ${Math.round(f.rate * 100)}`).join(', ')})`);
});

test('price type, custom made, and seller notes only when stated', () => {
  assert.equal(priceType({ title: 'Boots', description: 'Great shape' }), '');
  assert.equal(priceType({ description: 'or best offer' }), 'OBO');
  assert.equal(customMade({ description: 'Not custom, factory made' }), '');
  assert.equal(customMade({ description: 'Made to order in 2019' }), 'Yes');
  assert.equal(sellerNotes({ description: 'Nice\nNotes: heel replaced' }), 'heel replaced');
  assert.equal(fillRate([]).rows, 0);
});

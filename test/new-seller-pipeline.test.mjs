import assert from 'node:assert/strict';
import test from 'node:test';
import { applyAutoOptimization } from '../lib/optimize.js';
import { prepareForExport } from '../lib/pipeline.js';
import { createSellerFromIntake, useIntakeSql } from '../lib/public-intake-store.js';
import { bundledStyleSample } from '../lib/style-sample.js';
import { bundledDirectory } from '../lib/wbw-ref.js';
import { enrichFor, optedIn } from '../lib/wbw.js';

// Intake → seller row → first import → export, with no seller setup in between.
test('a seller created from the intake form gets a complete WBW export on their first import', async () => {
  const intake = { id: 9, status: 'pending', display_name: 'Ada Boots', username: 'ada_boots', email: 'ada@shop.test', location: 'El Paso, TX',
    shop_links: JSON.stringify({ depop: 'https://www.depop.com/adaboots/' }), terms: 'LL = Lucchese', defaults: 'made_in = USA', brand_context: 'on',
    shipping_policy: 'Ships to CONUS, $15 flat', return_policy: 'No returns', payment_methods: { methods: ['paypal', 'venmo', 'other'], other: 'Zelle' } };
  const saved = [];
  useIntakeSql(async (ss, ...a) => {
    const q = ss.join('?').replace(/\s+/g, ' ').trim();
    if (/^select name, email from sellers/.test(q)) return [];
    if (/^update seller_intake set status/.test(q)) return [{ ...intake, status: a[0], seller_name: a[1] }];
    return [];
  });
  const out = await createSellerFromIntake(9, { row: intake, save: async p => { saved.push(p); return { name: p.name }; } });
  useIntakeSql(null);
  assert.equal(out.seller_name, 'ada_boots');
  const seller = saved[0];
  assert.equal(seller.shipping_policy, 'Ships to CONUS, $15 flat');
  assert.equal(seller.return_policy, 'No returns');
  assert.equal(seller.payment_methods, 'PayPal, Venmo, Zelle');
  assert.equal(optedIn(seller.extra_text), false);
  assert.equal(optedIn(seller.video_opt), false);

  const raw = { source: 'depop', source_id: 'ada-1', source_url: 'https://www.depop.com/products/ada-1/', title: 'LL ostrich cowboy boots 10 D',
    description: 'LL full quill ostrich. Style: E2163. Snip toe, riding heel. Shaft height: 12', price: '400', photos: ['https://cdn.example/a1.jpg', 'https://cdn.example/a2.jpg'] };
  const e = enrichFor(raw, seller);
  const item = { ...e, id: 1, wbw_price: e.price, photos: raw.photos, id_text: 'E2163', approved_at: '2026-11-16T06:00:00Z' };
  applyAutoOptimization(item, { ...item, source_id: raw.source_id }, { directory: bundledDirectory().makers, styleSample: bundledStyleSample(), extraText: optedIn(seller.extra_text) });
  const p = prepareForExport(item, { seller: { ...seller, display_name: 'Ada Boots' } });
  assert.equal(p.status, 'ready');
  assert.equal(p.record.brand, 'Lucchese'); // seller shorthand from intake
  assert.equal(p.record.made_in, 'USA'); // seller default from intake
  assert.equal(p.record.shipping, 'Ships to CONUS, $15 flat');
  assert.equal(p.record.payment, 'PayPal, Venmo, Zelle');
  assert.equal(p.record.returns, 'No returns');
  assert.equal(p.record.description, raw.description); // extra description info is off for a new seller
  assert.equal(p.record.video, '');
  assert.equal(p.record.website_url, '');
  assert.equal(p.record.photos.length, 2);
  assert.ok(p.record.alts.every(Boolean));
});

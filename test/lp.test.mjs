import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { packCsvChunks, parseCsv } from '../lib/csv.js';
import { lpApi } from '../lib/lp-api.js';
import { LP_PRIVATE, lpPhotoUrl, lpSourceId, mapLpCsv, mappedItem, missingFromLp, planLp, runLpImport } from '../lib/lp.js';
import { allowedPhotoUrl } from '../lib/net.js';
import { sessionToken } from '../lib/session.js';
import { enrich } from '../lib/wbw.js';

const fixture = readFileSync(new URL('./fixtures/lp-sample.csv', import.meta.url), 'utf8');
const SECRET = 'NOTE-SECRET-9f3a COGS-SECRET-9f3a SOLDPRICE-SECRET SHIP-SECRET OTHER-SECRET PROFIT-SECRET';
const read = p => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

const HEAD = ['Date', 'Title', 'Main Image', 'Image Gallery', 'UPC', 'Brand', 'Color', 'Size', 'Material', 'SKU', 'Price', 'Notes', 'Quantity', 'Description', 'eBay', 'Etsy', 'Poshmark', 'Mercari', 'Tradesy', 'Amazon', 'Grailed', 'Facebook', 'Depop', 'Kidizen', 'Shopify', 'Vestiaire', 'Whatnot', 'Vinted', 'Reverb', 'SOLD', 'Cost of Goods', 'Sold Price', 'Shipping Cost', 'Other Costs', 'Sold Date', 'Profit'];
const csvOf = rows => [HEAD.join(','), ...rows.map(r => HEAD.map(h => `"${String(r[h] ?? '').replace(/"/g, '""')}"`).join(','))].join('\n');
const row = (over = {}) => ({
  Date: '2024-01-02 03:04:05', Title: 'Lucchese boots 13EE', 'Main Image': 'https://media.listperfectly.com/main.jpeg',
  'Image Gallery': 'https://media.listperfectly.com/b.jpeg', Brand: 'Lucchese', Color: 'Brown', Size: '8.5', Material: 'Leather',
  SKU: 'boot-1', Price: '245', Quantity: '1', Description: 'US Men\'s size:  8.5D\nShaft Circumference:  13 in\nShaft Height:  11 in\nHeel Height:  1.75 in\nSole heel to toe:  12 in\nSole widest part:  3.75 in',
  ...over,
});

function memory(seed = []) {
  const rows = seed.map(r => ({ ...r }));
  let id = rows.reduce((m, r) => Math.max(m, r.id || 0), 0);
  return {
    rows,
    async enrich(raw) { return enrich(raw); },
    async load(ids) {
      const want = new Set(ids);
      return rows.filter(r => want.has(r.source_id)).map(r => ({ ...r }));
    },
    async insert(sourceId, fields) { rows.push({ id: ++id, seller: 'dan', source: 'listperfectly', source_id: sourceId, ...fields }); },
    async update(itemId, fields) { Object.assign(rows.find(r => r.id === itemId), fields); },
  };
}

describe('List Perfectly CSV parser', () => {
  it('reads the sample, including the BOM, quoted newlines, and escaped quotes', () => {
    const rows = parseCsv(`\uFEFF${fixture}`);
    assert.equal(rows.length, 25);
    assert.ok(rows[0]['Image Gallery'].includes('\n'));
    assert.equal(rows[0]['Image Gallery'].includes('https://media.listperfectly.com/'), true);
    const quoted = parseCsv('Title,Notes\n"David ""Eden"" boots","secret"\n');
    assert.equal(quoted[0].Title, 'David "Eden" boots');
    const crlf = parseCsv('A,B\r\n"one\r\ntwo",x\r\n');
    assert.equal(crlf.length, 1);
    assert.equal(crlf[0].A, 'one\r\ntwo');
    assert.equal(crlf[0].B, 'x');
  });

  it('round-trips the sample through chunks a function can accept', () => {
    const titles = parseCsv(fixture).map(r => r.Title);
    const parts = packCsvChunks(fixture, 4000);
    assert.ok(parts.length > 1);
    const again = parts.flatMap(p => parseCsv(p.csv).map(r => r.Title));
    assert.deepEqual(again, titles);
    assert.ok(parts.every(p => p.csv.length < 3_500_000));
  });

  it('parses a few thousand rows without holding one giant request', () => {
    const rows = Array.from({ length: 3600 }, (_, i) => row({ SKU: `sku-${i}`, Title: `Boot ${i}`, Date: `2020-01-01 00:00:${String(i % 60).padStart(2, '0')}` }));
    const text = csvOf(rows);
    const parts = packCsvChunks(text, 200000);
    assert.ok(parts.length > 1);
    assert.equal(parts.reduce((n, p) => n + parseCsv(p.csv).length, 0), 3600);
  });
});

describe('List Perfectly mapping', () => {
  const sample = parseCsv(fixture);

  it('fills LP columns and the labelled measurements, and does not mark those guessed', () => {
    const altos = mappedItem(sample.find(r => r.Brand === 'Los Altos Boots'));
    assert.equal(altos.item.brand, 'Los Altos');
    assert.equal(altos.item.size, '9.5');
    assert.equal(altos.item.width, 'EE');
    assert.equal(altos.item.color, 'Buttercup, Mango');
    assert.equal(altos.item.material, 'Crocodile, Leather');
    assert.equal(altos.item.price, '5000');
    assert.equal(altos.item.shaft_circ, '15');
    assert.equal(altos.item.shaft_height, '12.5');
    assert.equal(altos.item.heel_height, '1.75');
    assert.equal(altos.item.sole_length, '11.35');
    assert.equal(altos.item.sole_width, '4.25');
    assert.equal(altos.item.sized_for, 'Men');
    assert.equal(altos.item.source, 'listperfectly');
    for (const f of ['brand', 'color', 'size', 'material', 'width', 'shaft_circ', 'shaft_height', 'heel_height', 'sole_length', 'sole_width', 'sized_for'])
      assert.equal(altos.item.guessed.includes(f), false, f);
    assert.equal(altos.photos[0], sample.find(r => r.Brand === 'Los Altos Boots')['Main Image']);
    assert.equal(altos.photos.length, 20);
    assert.equal(new Set(altos.photos).size, altos.photos.length);

    const lucchese = mappedItem(sample.find(r => r.Brand === 'Lucchese'));
    assert.equal(lucchese.item.size, '8.5');
    assert.equal(lucchese.item.width, 'D');
    assert.equal(lucchese.item.shaft_circ, '13');
    assert.equal(lucchese.item.shaft_height, '11');
    assert.equal(lucchese.item.heel_height, '1.75');
    assert.equal(lucchese.item.sole_length, '12');
    assert.equal(lucchese.item.sole_width, '3.75');
    assert.equal(lucchese.sold, true);

    const eden = mappedItem(sample.find(r => r.Brand === 'David Eden'));
    assert.equal(eden.item.sole_length, '12.9');
    assert.equal(eden.item.sole_width, '4.5');
    assert.equal(eden.item.color, 'Green');
    assert.equal(eden.item.guessed.includes('color'), false);

    const fraction = mappedItem(sample.find(r => r.Description.includes('2 1/8')));
    assert.equal(fraction.item.heel_height, '2.125');

    const grenson = mappedItem(sample.find(r => r.Brand === 'Grenson'));
    assert.equal(grenson.item.size, '6');
    assert.equal(grenson.item.width, 'F');
    assert.equal(grenson.item.guessed.includes('width'), false);
  });

  it('lets an explicit column beat a different size, brand, color, or material in the text', () => {
    const item = mappedItem(row({
      Title: 'Lucchese black cherry lizard boots 13EE',
      Brand: 'David Eden', Color: 'Green', Size: '8.5', Material: 'Alligator, Lizard',
    })).item;
    assert.equal(item.brand, 'David Eden');
    assert.equal(item.color, 'Green');
    assert.equal(item.size, '8.5');
    assert.equal(item.width, 'D');
    assert.equal(item.material, 'Alligator, Lizard');
    for (const f of ['brand', 'color', 'size', 'width', 'material']) assert.equal(item.guessed.includes(f), false, f);
  });

  it('keys a row by SKU plus the main image filename, so a title or price edit stays the same item', () => {
    const image = 'https://media.listperfectly.com/20261019-153819_b299628f-4e83_CI.jpeg';
    const file = '20261019-153819_b299628f-4e83_CI.jpeg';
    const a = mappedItem(row({ SKU: '_  bin#', Date: '2024-01-01 00:00:01', Title: 'One', Price: '10', 'Main Image': image }));
    const edited = mappedItem(row({ SKU: '_  bin#', Date: '2024-06-01 00:00:02', Title: 'Renamed', Price: '99', 'Main Image': image }));
    const other = mappedItem(row({ SKU: '_  bin#', Title: 'Other photo', 'Main Image': 'https://media.listperfectly.com/other.jpeg' }));
    assert.equal(a.source_id, edited.source_id);
    assert.equal(a.source_id, `_  bin# ${file}`);
    assert.notEqual(a.source_id, other.source_id);
    const blank = mappedItem(row({ SKU: '', 'Main Image': '', Date: '2024-05-01 09:00:00', Title: 'No sku' }));
    assert.equal(blank.source_id, createHash('sha1').update('2024-05-01 09:00:00\nNo sku').digest('hex'));
    assert.equal(lpSourceId({ SKU: 'only-sku' }), 'only-sku');
    assert.equal(lpSourceId({ SKU: '', 'Main Image': image }), file);
  });

  it('keeps marketplace names, drops unsafe photo URLs, and dedupes the main image', () => {
    const main = 'https://media.listperfectly.com/main.jpeg';
    const m = mappedItem(row({
      'Main Image': main,
      'Image Gallery': [main, 'https://media.listperfectly.com/b.jpeg', 'http://media.listperfectly.com/c.jpeg', 'https://127.0.0.1/d.jpeg', 'javascript:alert(1)', 'https://user:pass@media.listperfectly.com/e.jpeg'].join('\n'),
      eBay: 'eBay', Poshmark: 'Poshmark', Etsy: '',
    }));
    assert.deepEqual(m.photos, [main, 'https://media.listperfectly.com/b.jpeg']);
    assert.equal(m.markets, 'eBay, Poshmark');
    assert.equal(lpPhotoUrl('https://media.listperfectly.com/a.jpeg').includes('listperfectly.com'), true);
    assert.equal(allowedPhotoUrl('https://media.listperfectly.com/a.jpeg'), false);
    const many = mappedItem(row({ 'Image Gallery': Array.from({ length: 40 }, (_, i) => `https://media.listperfectly.com/${i}.jpeg`).join('\n') }));
    assert.equal(many.photos.length, 30);
    assert.equal(many.photos[0], main);
  });
});

describe('List Perfectly privacy and sync', () => {
  it('imports every unsold sample row, including ones that share a bin code', async () => {
    const db = memory();
    const opened = await runLpImport(fixture, db);
    assert.equal(opened.new, 20);
    assert.equal(opened.skipped, 5);
    assert.equal(new Set(db.rows.map(r => r.source_id)).size, 20);
    const again = await runLpImport(fixture, db);
    assert.equal(again.new, 0);
    assert.equal(again.updated, 0);
    assert.equal(again.skipped, 25);
    assert.equal(JSON.stringify(db.rows).includes('Cost of Goods'), false);
  });

  it('never stores notes, cost, sold price, shipping, other costs, or profit', async () => {
    const db = memory();
    const text = csvOf([row({
      Notes: 'NOTE-SECRET-9f3a', 'Cost of Goods': 'COGS-SECRET-9f3a', 'Sold Price': 'SOLDPRICE-SECRET',
      'Shipping Cost': 'SHIP-SECRET', 'Other Costs': 'OTHER-SECRET', Profit: 'PROFIT-SECRET', 'Sold Date': '2024-02-02',
    })]);
    await runLpImport(text, db);
    const blob = JSON.stringify(db.rows);
    for (const secret of SECRET.split(' ')) assert.equal(blob.includes(secret), false, secret);
    assert.equal(blob.includes('2024-02-02'), false);
    for (const stored of db.rows) {
      for (const k of Object.keys(stored)) assert.equal(LP_PRIVATE.map(n => n.toLowerCase().replace(/ /g, '_')).includes(k), false, k);
    }
    const mapped = JSON.stringify(mapLpCsv(text));
    for (const secret of SECRET.split(' ')) assert.equal(mapped.includes(secret), false, secret);
  });

  it('imports new rows, skips sold rows the first time, and syncs changes without clobbering verified fields', async () => {
    const db = memory();
    const first = csvOf([
      row({ SKU: 'new-boot', Price: '100' }),
      row({ SKU: 'gone-later', Title: 'Will leave', Date: '2024-03-01 00:00:00' }),
      row({ SKU: 'sold-already', SOLD: 'SOLD', 'Sold Price': 'SOLDPRICE-SECRET' }),
    ]);
    const opened = await runLpImport(first, db);
    assert.deepEqual({ ...opened, sourceIds: opened.sourceIds.length }, { new: 2, updated: 0, sold: 0, skipped: 1, sourceIds: 3 });
    assert.equal(db.rows.length, 2);
    assert.equal(db.rows.every(r => r.photos[0].startsWith('https://media.listperfectly.com/')), true);

    const kept = db.rows.find(r => r.source_id.startsWith('new-boot'));
    kept.verified = ['brand'];
    kept.brand = 'Kept Brand';
    kept.wbw_price = '90';
    kept.price = '100';
    kept.photos = ['https://blob.vercel-storage.com/kept.jpg'];

    const second = csvOf([
      row({ SKU: 'new-boot', Price: '80', Brand: 'Other Brand', eBay: 'eBay' }),
      row({ SKU: 'brand-new', Title: 'Added', Date: '2024-04-01 00:00:00' }),
      row({ SKU: 'sold-already', SOLD: 'SOLD' }),
      row({ SKU: 'qty-zero', Title: 'Empty', Quantity: '0', Date: '2024-04-02 00:00:00' }),
    ]);
    // qty-zero was never imported, so it is skipped rather than created as sold.
    const again = await runLpImport(second, db);
    assert.equal(again.new, 1);
    assert.equal(again.updated, 1);
    assert.equal(again.sold, 0);
    const updated = db.rows.find(r => r.id === kept.id);
    assert.equal(updated.brand, 'Kept Brand');
    assert.equal(updated.price, '80');
    assert.equal(updated.wbw_price, '90');
    assert.equal(updated.markets, 'eBay');
    assert.deepEqual(updated.photos, ['https://blob.vercel-storage.com/kept.jpg']);
    assert.equal(updated.status, 'review');
    assert.ok(updated.changed_at);
    assert.equal(db.rows.some(r => r.title === 'Added'), true);
    assert.equal(db.rows.some(r => String(r.source_id).startsWith('sold-already')), false);

    const live = db.rows.find(r => r.source_id.startsWith('gone-later'));
    live.status = 'published';
    const soldFile = csvOf([row({ SKU: 'gone-later', Title: 'Will leave', Date: '2024-03-01 00:00:00', SOLD: 'SOLD' })]);
    const sold = await runLpImport(soldFile, db);
    assert.equal(sold.sold, 1);
    assert.equal(db.rows.find(r => r.id === live.id).status, 'pending');

    const back = await runLpImport(csvOf([row({ SKU: 'gone-later', Title: 'Will leave', Date: '2024-03-01 00:00:00', Quantity: '1', SOLD: '' })]), db);
    assert.equal(back.updated, 1);
    assert.equal(db.rows.find(r => r.id === live.id).status, 'review');

    const ids = again.sourceIds;
    const missing = missingFromLp(db.rows.map(r => ({ ...r, status: r.id === live.id ? 'review' : r.status })), ids.filter(id => !id.startsWith('gone-later')));
    assert.deepEqual(missing, [live.id]);
    const same = await runLpImport(second, db);
    assert.equal(same.new, 0);
    assert.equal(same.updated, 0);
    const zeroed = db.rows.find(r => r.title === 'Added');
    const zero = await runLpImport(csvOf([row({ SKU: 'brand-new', Title: 'Added', Date: '2024-04-01 00:00:00', Quantity: '0' })]), db);
    assert.equal(zero.sold, 1);
    assert.equal(db.rows.find(r => r.id === zeroed.id).status, 'pending');
  });

  it('does not reopen a sold listing, and an unchanged row is skipped', () => {
    const item = mappedItem(row());
    const existing = [{ id: 7, source_id: item.source_id, status: 'sold', src_hash: item.hash, verified: [], price: '245', wbw_price: '245' }];
    const plan = planLp(existing, [{ ...item, item: item.item }]);
    assert.equal(plan.summary.skipped, 1);
    assert.equal(plan.updates.length, 0);
    const quiet = planLp([{ ...existing[0], status: 'review' }], [{ ...item, item: item.item }]);
    assert.equal(quiet.summary.skipped, 1);
  });
});

describe('List Perfectly upload access', () => {
  const ENV = { NODE_ENV: 'production', ADMIN_PASSWORD: 'staff-secret', APP_PASSWORD: 'signing-secret' };
  const post = (token, body, bearer) => new Request('http://localhost/api/import/lp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-auth': token, ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) },
    body: JSON.stringify(body),
  });

  it('lets a seller upload for themselves', async () => {
    const seller = await sessionToken('seller:ada', 'signing-secret');
    const own = await lpApi(post(seller, { csv: csvOf([row()]) }, 'ada'), {
      async importLp(name) { assert.equal(name, 'ada'); return { new: 1, updated: 0, sold: 0, skipped: 0, sourceIds: ['a'] }; },
      async finishLp() { return 0; },
    }, ENV);
    assert.equal(own.new, 1);
  });

  it('rejects a seller naming someone else and an admin who has not picked a seller', async () => {
    const db = { async importLp() { throw new Error('should not import'); }, async finishLp() { return 0; } };
    const seller = await sessionToken('seller:ada', 'signing-secret');
    const admin = await sessionToken('admin', 'signing-secret');
    await assert.rejects(() => lpApi(post(seller, { csv: csvOf([row()]) }, 'bea'), db, ENV), /own items/);
    await assert.rejects(() => lpApi(post(admin, { csv: csvOf([row()]) }), db, ENV), /Pick a seller/);
    const ok = await lpApi(post(admin, { csv: csvOf([row()]) }, 'dan'), {
      async importLp(name) { assert.equal(name, 'dan'); return { new: 1, updated: 0, sold: 0, skipped: 0, sourceIds: ['a'] }; },
      async finishLp() { return 0; },
    }, ENV);
    assert.equal(ok.new, 1);
    const own = await lpApi(post(seller, { done: true, sourceIds: ['a', 'b'] }), {
      async importLp() { throw new Error('no'); },
      async finishLp(name, ids) { assert.equal(name, 'ada'); return ids.length; },
    }, ENV);
    assert.equal(own.removed, 2);
    const route = read('app/api/import/lp/route.js');
    assert.match(route, /sellerContext/);
    const fn = read('lib/wbw.js');
    const body = fn.slice(fn.indexOf('export async function importLp'), fn.indexOf('export async function finishLp'));
    assert.equal(body.includes('importPhoto'), false);
    assert.match(body, /backfillPhotos/);
    assert.match(read('app/screen.js'), /Import List Perfectly CSV/);
    assert.match(read('app/screen.js'), /sold or removed/);
  });
});

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { sellerSlug } from '../lib/auth.js';
import { CSV } from '../lib/export.js';
import { isMuseumSeller, lpHash, mapLpCsv, MUSEUM_SELLER_SLUG, parseGroupPrice, runLpImport } from '../lib/lp.js';
import { enrich, FIELDS } from '../lib/wbw.js';

const DAN = { name: 'dan-hoffenberg', display_name: 'Dan Hoffenberg' };
const SECRET = 'NOTE-SECRET-9f3a';
const read = p => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

const csv = rows => {
  const heads = ['Date', 'Title', 'SKU', 'Price', 'Notes', 'Comments', 'Description', 'Brand', 'Quantity', 'SOLD'];
  const cell = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  return [heads.join(','), ...rows.map(r => heads.map(h => cell(r[h])).join(','))].join('\n');
};
const boot = (over = {}) => ({
  Date: '2024-01-02 03:04:05', Title: 'Lucchese cowboy boots', SKU: 'boot-1', Price: '245',
  Brand: 'Lucchese', Quantity: '1', Description: 'US Men\'s size:  8.5D', ...over,
});

function memory() {
  const rows = [];
  let id = 0;
  return {
    rows,
    async enrich(raw) { return enrich(raw); },
    async load(ids) {
      const want = new Set(ids);
      return rows.filter(r => want.has(r.source_id)).map(r => ({ ...r }));
    },
    async insert(sourceId, fields) { rows.push({ id: ++id, source_id: sourceId, ...fields }); },
    async update(itemId, fields) { Object.assign(rows.find(r => r.id === itemId), fields); },
  };
}

function legacyHash(item, extra) {
  const parts = FIELDS.map(f => String(item?.[f] ?? '').trim());
  parts.push((extra.photos ?? []).join('|'), extra.markets ?? '', extra.sold ? '1' : '0');
  return createHash('sha1').update(parts.join('\u0001')).digest('hex');
}

describe('museum seller identity', () => {
  it('is Dan Hoffenberg by the registration slug or the display name', () => {
    assert.equal(sellerSlug('Dan Hoffenberg'), MUSEUM_SELLER_SLUG);
    assert.equal(MUSEUM_SELLER_SLUG, 'dan-hoffenberg');
    assert.equal(isMuseumSeller('dan-hoffenberg'), true);
    assert.equal(isMuseumSeller('  Dan-Hoffenberg  '), true);
    assert.equal(isMuseumSeller({ name: 'shoeseum', display_name: 'Dan Hoffenberg' }), true);
    assert.equal(isMuseumSeller({ name: 'dan-hoffenberg', display_name: 'Museum' }), true);
    assert.equal(isMuseumSeller({ seller: 'dan-hoffenberg', display_name: 'Dan-Hoffenberg' }), true);
    assert.equal(isMuseumSeller({ name: 'dan-hoffenberg-2', display_name: '  Dan   Hoffenberg ' }), true);
    assert.equal(isMuseumSeller({ name: 'ada', display_name: 'Ada Boots' }), false);
    assert.equal(isMuseumSeller({ name: 'museum', display_name: 'Dan Hoffenberg Boots' }), false);
    assert.equal(isMuseumSeller({ name: 'danny-hoffenberg', display_name: 'Danny Hoffenberg' }), false);
    assert.equal(isMuseumSeller(null), false);
    assert.equal(isMuseumSeller(''), false);
  });
});

describe('group price in comments', () => {
  it('accepts one unambiguous group price', () => {
    const ok = [
      ['group price $125', '125'],
      ['Group Price: $1,250.50', '1250.50'],
      ['group price = $99', '99'],
      ['the group price is $80.', '80'],
      ['group: $40', '40'],
      ['GROUP = 40', '40'],
      ['group is $0', '0'],
      ['see notes\ngroup price $100\nthanks', '100'],
      ['MSRP $500\ngroup price $100', '100'],
      ['size 10D\ngroup: 80', '80'],
    ];
    for (const [text, price] of ok) assert.deepEqual(parseGroupPrice(text), { price, missing: false }, text);
  });

  it('flags a missing, ambiguous, or repeated price and does not invent one', () => {
    for (const text of [
      '',
      'nice boots',
      'group price',
      'group price TBD',
      'group $100',
      'group price of $100',
      'group price was $100',
      'grouping $100',
      'group price $100 or $150',
      'group price 100 or 150',
      'group price $100-$150',
      'group price $100 to $150',
      'group: $100 and $80',
      'group price $100\ngroup: $90',
      'group price $100\ngroup: $100',
      'about group price $100',
      'group price ~$100',
      'group price $100.999',
      'group price $007',
      'shipping $5, group price 100',
    ]) assert.deepEqual(parseGroupPrice(text), { price: null, missing: true }, text);
  });
});

describe('Dan Hoffenberg List Perfectly import', () => {
  it('uses the group price, keeps the spreadsheet price when comments have none, and hides the notes', async () => {
    const db = memory();
    const text = csv([
      boot({ SKU: 'priced', Date: '2024-02-01 00:00:01', Notes: `bin A\ngroup price $321\n${SECRET}` }),
      boot({ SKU: 'plain', Date: '2024-02-01 00:00:02', Price: '245', Notes: `call the shop ${SECRET}`, Description: 'group price $1' }),
      boot({ SKU: 'range', Date: '2024-02-01 00:00:03', Notes: 'group price $10 or $12' }),
      boot({ SKU: 'same', Date: '2024-02-01 00:00:04', Notes: 'group price $55', Comments: 'group: $55' }),
      boot({ SKU: 'split', Date: '2024-02-01 00:00:05', Notes: 'group price $55', Comments: 'group: $40' }),
    ]);
    const opened = await runLpImport(text, db, DAN);
    assert.equal(opened.missingGroupPrice, 3);
    const byDate = id => db.rows.find(r => r.source_id === id);
    assert.equal(byDate('2024-02-01 00:00:01').price, '321');
    assert.equal(byDate('2024-02-01 00:00:01').wbw_price, '321');
    assert.equal(byDate('2024-02-01 00:00:01').missing_group_price, false);
    assert.equal(byDate('2024-02-01 00:00:02').price, '245');
    assert.equal(byDate('2024-02-01 00:00:02').wbw_price, '245');
    assert.equal(byDate('2024-02-01 00:00:02').missing_group_price, true);
    assert.equal(byDate('2024-02-01 00:00:03').price, '245');
    assert.equal(byDate('2024-02-01 00:00:03').missing_group_price, true);
    assert.equal(byDate('2024-02-01 00:00:04').price, '55');
    assert.equal(byDate('2024-02-01 00:00:04').missing_group_price, false);
    assert.equal(byDate('2024-02-01 00:00:05').price, '245');
    assert.equal(byDate('2024-02-01 00:00:05').missing_group_price, true);
    const blob = JSON.stringify(db.rows);
    assert.equal(blob.includes(SECRET), false);
    assert.equal(blob.includes('bin A'), false);
    assert.equal(blob.includes('call the shop'), false);
    assert.equal(byDate('2024-02-01 00:00:02').description, 'group price $1');
    const mapped = JSON.stringify(mapLpCsv(text, { museum: true }));
    assert.equal(mapped.includes(SECRET), false);
  });

  it('reads a Comments header when Notes is absent', async () => {
    const db = memory();
    const text = 'Title,SKU,Price,Comment\n"Lucchese cowboy boots","c1","10","group: $64"\n';
    const opened = await runLpImport(text, db, { name: 'museum', display_name: 'Dan Hoffenberg' });
    assert.equal(opened.new, 1);
    assert.equal(opened.missingGroupPrice, 0);
    assert.equal(db.rows[0].price, '64');
    assert.equal(db.rows[0].missing_group_price, false);
  });

  it('leaves every other seller on the spreadsheet price with no flag', async () => {
    const notes = `group price $10\n${SECRET}`;
    const text = csv([boot({ Notes: notes, Price: '245' })]);
    for (const seller of ['ada', { name: 'ada', display_name: 'Ada' }, { name: 'museum', display_name: 'Dan Hoffenberg Boots' }, { name: 'danny-hoffenberg', display_name: 'Danny Hoffenberg' }]) {
      const db = memory();
      const opened = await runLpImport(text, db, seller);
      assert.equal(opened.missingGroupPrice, 0, JSON.stringify(seller));
      assert.equal(db.rows[0].price, '245');
      assert.equal(db.rows[0].wbw_price, '245');
      assert.equal(db.rows[0].missing_group_price, undefined);
      assert.equal(JSON.stringify(db.rows).includes(SECRET), false);
      assert.equal(JSON.stringify(db.rows).includes('group price'), false);
    }
    const item = enrich({ title: 'Lucchese cowboy boots', price: '245', description: '', photos: [], source: 'listperfectly', source_id: 'x' });
    const extra = { photos: [], markets: '', sold: false };
    assert.equal(lpHash(item, extra), legacyHash(item, extra));
    assert.equal(lpHash(item, { ...extra, museum: false, missing_group_price: true }), legacyHash(item, extra));
    assert.equal(lpHash(item, { ...extra, museum: true, missing_group_price: false }), legacyHash(item, extra));
    assert.notEqual(lpHash(item, { ...extra, museum: true, missing_group_price: true }), legacyHash(item, extra));
  });

  it('updates a later group price, keeps a verified price, and keeps a seller asking price', async () => {
    const db = memory();
    const date = '2024-03-01 00:00:01';
    await runLpImport(csv([boot({ Date: date, Notes: 'group price $100', Price: '245' })]), db, DAN);
    const row = db.rows[0];
    assert.equal(row.price, '100');
    assert.equal(row.wbw_price, '100');
    const again = await runLpImport(csv([boot({ Date: date, Notes: 'group price $120', Price: '245' })]), db, DAN);
    assert.equal(again.updated, 1);
    assert.equal(row.price, '120');
    assert.equal(row.wbw_price, '120');
    assert.equal(row.missing_group_price, false);

    row.verified = ['price', 'wbw_price'];
    row.price = '77';
    row.wbw_price = '77';
    await runLpImport(csv([boot({ Date: date, Notes: 'group price $130', Price: '245' })]), db, DAN);
    assert.equal(row.price, '77');
    assert.equal(row.wbw_price, '77');

    const open = memory();
    const other = '2024-03-02 00:00:02';
    await runLpImport(csv([boot({ Date: other, SKU: 'ask', Notes: 'group price $100', Price: '245' })]), open, 'dan-hoffenberg');
    const ask = open.rows[0];
    ask.wbw_price = '90';
    ask.price = '100';
    await runLpImport(csv([boot({ Date: other, SKU: 'ask', Notes: 'no group price here', Price: '245' })]), open, 'dan-hoffenberg');
    assert.equal(ask.price, '245');
    assert.equal(ask.wbw_price, '90');
    assert.equal(ask.missing_group_price, true);
  });
});

describe('where the flag is shown', () => {
  it('is a review-list column and an import count, and is not a WBW sell-a-pair column', () => {
    const screen = read('app/screen.js');
    assert.match(screen, /Missing group price/);
    assert.match(screen, /missing a group price/);
    assert.match(screen, /No group price/);
    assert.equal(Object.keys(CSV).includes('missing_group_price'), false);
    assert.equal(Object.values(CSV).includes('Missing group price'), false);
    assert.match(read('lib/export.js'), /Do not add columns/);
  });
});

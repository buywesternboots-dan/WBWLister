import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { askingPrice, priceFlags } from '../lib/price-flag.js';

const row = (id, brand, style, price) => ({ id, brand, id_text: style, price, title: 'Boots' });

test('flags a high price and a low price against an exact brand and style, and does not change the price', () => {
  const items = [
    row(1, 'Lucchese', '0030', 100),
    row(2, 'Lucchese', '0030', 110),
    row(3, 'Lucchese', '0030', 90),
    row(4, 'Lucchese', '0030', 105),
    row(5, 'Lucchese', '0030', 95),
    row(6, 'Lucchese', '0030', 900),
    row(7, 'Lucchese', '0030', 15),
  ];
  const before = items.map(i => i.price);
  const flags = priceFlags(items);
  assert.deepEqual(items.map(i => i.price), before);
  assert.equal(flags.get('6').direction, 'high');
  assert.equal(flags.get('7').direction, 'low');
  assert.equal(flags.get('6').group, 'brand+style');
  assert.equal(flags.get('6').label, 'Lucchese style 0030');
  assert.equal(flags.get('6').count, 7);
  assert.equal(flags.get('1'), undefined);
  assert.equal(flags.get('6').median > 15, true);
});

test('a style number with leading zeros is not the same group as the number without them', () => {
  const padded = Array.from({ length: 6 }, (_, i) => row(i + 1, 'Dan Post', '0030', 200));
  const plain = row(9, 'Dan Post', '30', 20);
  const flags = priceFlags([...padded, plain]);
  assert.equal(flags.get('9').group, 'brand');
  assert.equal(flags.get('9').label, 'Dan Post');
  assert.equal(flags.get('1'), undefined);
});

test('small groups and missing prices produce no flag', () => {
  const few = [row(1, 'Tony Lama', '1047', 80), row(2, 'Tony Lama', '1047', 800), row(3, 'Tony Lama', '1047', 90), row(4, 'Tony Lama', '1047', 85)];
  assert.equal(priceFlags(few).size, 0);
  const missing = [...Array.from({ length: 5 }, (_, i) => row(i + 1, 'Justin', '', 100)), { id: 8, brand: 'Justin', id_text: '', price: null, wbw_price: '' }];
  assert.equal(askingPrice(missing[5]), null);
  assert.equal(priceFlags(missing).has('8'), false);
});

test('falls back to the exact brand when the style group is too small', () => {
  const items = [
    ...Array.from({ length: 5 }, (_, i) => row(i + 1, 'Justin', '', 100)),
    row(6, 'Justin', '999', 100),
    row(7, 'Justin', '', 900),
  ];
  const flags = priceFlags(items);
  assert.equal(flags.get('7').direction, 'high');
  assert.equal(flags.get('7').group, 'brand');
  assert.equal(flags.get('7').label, 'Justin');
  assert.equal(flags.get('7').count, 7);
});

test('similar boots from every seller form one group, and the flag has no other prices', () => {
  const mine = { ...row(1, 'Lucchese', '0030', 900), seller: 'ada' };
  assert.equal(priceFlags([mine]).size, 0);
  const others = Array.from({ length: 6 }, (_, i) => ({ ...row(100 + i, 'Lucchese', '0030', 100 + i), seller: `shop-${i}` }));
  const flags = priceFlags([mine, ...others]);
  const flag = flags.get('1');
  assert.equal(flag.direction, 'high');
  assert.equal(flag.group, 'brand+style');
  assert.equal(flag.label, 'Lucchese style 0030');
  assert.equal(flag.count, 7);
  assert.deepEqual(Object.keys(flag).sort(), ['count', 'direction', 'group', 'label', 'median']);
  assert.equal(JSON.stringify(flag).includes('shop-'), false);
  const src = readFileSync(new URL('../lib/wbw.js', import.meta.url), 'utf8');
  const fn = src.slice(src.indexOf('export async function getItems'), src.indexOf('export const SELLER_FIELDS'));
  assert.match(fn, /select id, brand, id_text, price, wbw_price from items/);
  assert.equal(fn.includes('price, wbw_price from items where seller'), false);
  assert.match(fn, /seller = \$\{seller\} and status/);
});

test('a different brand is not pulled into the group', () => {
  const items = [
    ...Array.from({ length: 6 }, (_, i) => row(i + 1, 'Lucchese', '1', 100)),
    row(8, 'Tony Lama', '1', 10),
  ];
  assert.equal(priceFlags(items).has('8'), false);
});

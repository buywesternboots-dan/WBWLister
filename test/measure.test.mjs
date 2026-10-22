import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readMeasurements, MEASUREMENT_KEYS, MEASUREMENT_LABELS } from '../lib/measure.js';
import { enrich, enrichFor } from '../lib/wbw.js';
import { FIELDS } from '../lib/wbw.js';
import { searchMatch } from '../lib/vocab.js';

const read = text => readMeasurements(text);

test('parses inches, decimals, fractions, and shorthand', () => {
  assert.deepEqual(read('Shaft height: 12 1/2"'), { shaft_height: '12.5' });
  assert.deepEqual(read('shaft height 12.5 in'), { shaft_height: '12.5' });
  assert.deepEqual(read('Shaft height 12-1/2 inches'), { shaft_height: '12.5' });
  assert.deepEqual(read('12½" shaft'), { shaft_height: '12.5' });
  assert.deepEqual(read('shaft 13in'), { shaft_height: '13' });
  assert.deepEqual(read('Shaft ht. 13"'), { shaft_height: '13' });
  assert.deepEqual(read('heel: 2 in'), { heel_height: '2' });
  assert.deepEqual(read('circ 15"'), { shaft_circ: '15' });
  assert.deepEqual(read('Circ: 15 in.'), { shaft_circ: '15' });
  assert.deepEqual(read('14" top'), { shaft_circ: '14' });
  assert.deepEqual(read('Heel height: 1.75"'), { heel_height: '1.75' });
  assert.deepEqual(read('heel height 1 3/8"'), { heel_height: '1.375' });
  assert.deepEqual(read('1/2" heel'), { heel_height: '0.5' });
  assert.deepEqual(read('2" cuban heel'), { heel_height: '2' });
  assert.deepEqual(read('Outsole length: 12.25 in'), { outsole_length: '12.25' });
  assert.deepEqual(read('sole length 12-1/2 inches'), { outsole_length: '12.5' });
  assert.deepEqual(read('outsole width at the ball: 4 1/4"'), { outsole_width: '4.25' });
  assert.deepEqual(read('4.25" at the ball'), { outsole_width: '4.25' });
  assert.deepEqual(read('Insole length 11.5"'), { insole_length: '11.5' });
  assert.deepEqual(read('insole: 11 1/2"'), { insole_length: '11.5' });
  assert.deepEqual(read('Shaft height: 12'), { shaft_height: '12' }); // specific label, no unit
});

test('converts centimeters and leaves shorthand without a unit blank', () => {
  assert.deepEqual(read('Shaft height: 33 cm'), { shaft_height: '12.992' });
  assert.deepEqual(read('heel height 5 cm'), { heel_height: '1.969' });
  assert.deepEqual(read('shaft 13'), {});
  assert.deepEqual(read('heel 2'), {});
  assert.deepEqual(read('circ 15'), {});
  assert.deepEqual(read('shaft 99in'), {}); // out of range — don't store a nonsense height
  assert.deepEqual(read('heel: 10 in'), {});
});

test('a full listing fills every stated measurement and ignores size, price, and year', () => {
  const text = `Lucchese Classics men's cowboy boots, size 10 D. Brand new, never worn. Made in USA.
Black full quill ostrich, square toe, leather sole, 1 1/2" riding heel.
Shaft height 12 1/2", shaft circumference 14.5 in, outsole length 12-1/2 inches,
outsole width at the ball 4.25", insole length 11½".
Price $850. Vintage style, circa 2019.`;
  assert.deepEqual(read(text), {
    shaft_height: '12.5', shaft_circ: '14.5', heel_height: '1.5',
    outsole_length: '12.5', outsole_width: '4.25', insole_length: '11.5',
  });
});

test('does not treat sizes, prices, years, or nearby words as measurements', () => {
  const blanks = [
    'Size 10 D',
    "Men's size 10.5 EE",
    'Price $450',
    'Only $12.50 shipped',
    'Made in 2019',
    'Vintage 1998 Lucchese',
    'Riding heel',
    'Beautiful leather shaft',
    'Call (512) 555-0134',
    'Model 9050',
    'Insole stamp says 10 D',
    'Width D',
    'size 10 in men\'s',
    '12 in stock',
    'ranked top 12 in sales',
    'These boots are 10 years old',
    'heel height',
    'Shaft height size 10 D',
    'Shaft height 10 D',
    '',
    null,
  ];
  for (const text of blanks) assert.deepEqual(read(text), {}, text ?? 'empty');
  assert.deepEqual(read('Size 10 D, $450, made in 2019. Riding heel, leather sole. Width D. Leather shaft.'), {});
});

test('enrich flags pulled measurements as guessed and still reads the rest of the listing', () => {
  const it = enrich({
    title: 'Lucchese men\'s 10 D ostrich cowboy boots',
    price: 850,
    description: `Brand new, never worn. Made in USA. Square toe, 1 1/2" riding heel, leather sole.
Shaft height: 12 1/2". Circ 15". Heel: 2 in. Outsole length 12.5 in. Outsole width at the ball 4.25".
Insole length: 11.5". Price $850. Model 9050. Made in 2019.`,
  });
  assert.equal(it.brand, 'Lucchese');
  assert.equal(it.size, '10');
  assert.equal(it.width, 'D');
  assert.equal(it.sized_for, 'Men');
  assert.equal(it.condition, 'New');
  assert.equal(it.material, 'Ostrich');
  assert.equal(it.toe, 'Square toe');
  assert.equal(it.heel, 'Riding heel');
  assert.equal(it.sole, 'Leather');
  assert.equal(it.shaft_height, '12.5');
  assert.equal(it.shaft_circ, '15');
  assert.equal(it.heel_height, '2');
  assert.equal(it.outsole_length, '12.5');
  assert.equal(it.outsole_width, '4.25');
  assert.equal(it.insole_length, '11.5');
  for (const k of MEASUREMENT_KEYS) assert.ok(it.guessed.includes(k), k);
  assert.equal(it.price, 850);
});

test('a listing with no measurements leaves those fields blank and unflagged', () => {
  const it = enrich({ title: 'Lucchese men\'s 10 D ostrich cowboy boots', description: 'Brand new. Made in USA. Square toe, riding heel, leather sole. Size 10 D. $450. 2019.' });
  for (const k of MEASUREMENT_KEYS) {
    assert.equal(it[k], null, k);
    assert.equal(it.guessed.includes(k), false, k);
  }
  assert.equal(it.size, '10');
  assert.equal(it.width, 'D');
  assert.equal(it.heel, 'Riding heel');
  assert.equal(it.condition, 'New');
});

test('heel: 2 in is a height, and a value already on the item is kept and not re-flagged', () => {
  const fromLabel = enrich({ title: 'Boots', description: 'Heel: 2 in' });
  assert.equal(fromLabel.heel_height, '2');
  assert.equal(fromLabel.heel, null);
  assert.ok(fromLabel.guessed.includes('heel_height'));

  const both = enrich({ title: 'Boots', description: 'Heel: 2" riding heel' });
  assert.equal(both.heel_height, '2');
  assert.equal(both.heel, 'Riding heel');

  const kept = enrich({ title: 'Boots', description: 'shaft 13in', shaft_height: '11' });
  assert.equal(kept.shaft_height, '11');
  assert.equal(kept.guessed.includes('shaft_height'), false);
});

test('seller shorthand still expands, and a default cannot invent a measurement', () => {
  const it = enrichFor(
    { title: 'Lucchese 10 D cowboy boots', description: 'SH: 13in\nRiding heel' },
    { terms: 'SH = shaft height', defaults: 'shaft_height = 12\nmade_in = USA' },
  );
  assert.equal(it.shaft_height, '13');
  assert.ok(it.guessed.includes('shaft_height'));
  assert.equal(it.made_in, 'USA');
  const blank = enrichFor({ title: 'Justin 9 D cowboy boots', description: 'Riding heel' }, { defaults: 'shaft_height = 12\nheel_height = 2' });
  assert.equal(blank.shaft_height, null);
  assert.equal(blank.heel_height, null);
  assert.equal(blank.guessed.includes('shaft_height'), false);
});

test('labeled heel style and sole material still win when they are not measurements', () => {
  const it = enrich({ title: 'Cowboy boots', description: 'Heel: Riding heel\nSole: leather\nSize: 9 D' });
  assert.equal(it.heel, 'Riding heel');
  assert.equal(it.sole, 'leather');
  assert.equal(it.size, '9');
  assert.equal(it.heel_height, null);
});

test('measurement keys are listing fields, and search can find a stored measurement', () => {
  for (const k of MEASUREMENT_KEYS) assert.ok(FIELDS.includes(k), k);
  assert.deepEqual(Object.keys(MEASUREMENT_LABELS), MEASUREMENT_KEYS);
  const item = { title: 'boots', brand: '', material: '', description: 'no numbers here', shaft_height: '12.5' };
  assert.equal(searchMatch(item, '12.5'), true);
  assert.equal(searchMatch({ ...item, shaft_height: null }, '12.5'), false);
});

test('the inventory page shows the fields and appends them to the CSV', () => {
  const page = readFileSync(new URL('../app/page.js', import.meta.url), 'utf8');
  assert.match(page, /MEASUREMENT_LABELS/);
  assert.match(page, /source_id: 'Source ID', \.\.\.MEASUREMENT_LABELS/);
  assert.match(page, /unverified\(i\)\.includes\(f\) \? 'guess'/);
  assert.match(page, /Save \(marks all verified\)/);
});

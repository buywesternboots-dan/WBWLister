import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MEASUREMENT_KEYS, readMeasurements } from '../lib/measure.js';
import { readOrigin } from '../lib/origin.js';
import { CSV } from '../lib/export.js';
import { enrich, enrichFor, FIELDS } from '../lib/wbw.js';

const read = text => readMeasurements(text);

test('parses inches, decimals, fractions, ranges, and shorthand into the WBW fields', () => {
  assert.deepEqual(read('Shaft height: 12 1/2"'), { shaft_height: '12.5' });
  assert.deepEqual(read('shaft height 12.5 in'), { shaft_height: '12.5' });
  assert.deepEqual(read('Shaft height 12-1/2 inches'), { shaft_height: '12.5' });
  assert.deepEqual(read('12½" shaft'), { shaft_height: '12.5' });
  assert.deepEqual(read('shaft 13in'), { shaft_height: '13' });
  assert.deepEqual(read('13-inch shaft'), { shaft_height: '13' });
  assert.deepEqual(read('13 inches tall'), { shaft_height: '13' });
  assert.deepEqual(read('14" tall shaft'), { shaft_height: '14' });
  assert.deepEqual(read('Shaft height: 12-13 in'), { shaft_height: '12-13' });
  assert.deepEqual(read('12-13" shaft'), { shaft_height: '12-13' });
  assert.deepEqual(read('Shaft ht. 13"'), { shaft_height: '13' });
  assert.deepEqual(read('heel: 2 in'), { heel_height: '2' });
  assert.deepEqual(read('circ 15"'), { shaft_circ: '15' });
  assert.deepEqual(read('15" calf'), { shaft_circ: '15' });
  assert.deepEqual(read('Shaft opening 15"'), { shaft_circ: '15' });
  assert.deepEqual(read('Heel height: 1.75"'), { heel_height: '1.75' });
  assert.deepEqual(read('heel height 1 3/8"'), { heel_height: '1.375' });
  assert.deepEqual(read('1/2" heel'), { heel_height: '0.5' });
  assert.deepEqual(read('2" cuban heel'), { heel_height: '2' });
  assert.deepEqual(read('2" stockman heel'), { heel_height: '2' });
  assert.deepEqual(read('Outsole length: 12.25 in'), { sole_length: '12.25' });
  assert.deepEqual(read('sole length 12-1/2 inches'), { sole_length: '12.5' });
  assert.deepEqual(read('heel to toe: 12 in'), { sole_length: '12' });
  assert.deepEqual(read('outsole width at the ball: 4 1/4"'), { sole_width: '4.25' });
  assert.deepEqual(read('4.25" at the ball'), { sole_width: '4.25' });
  assert.deepEqual(read('widest part 4.5"'), { sole_width: '4.5' });
  assert.deepEqual(read('Insole length 11.5"'), { sole_length: '11.5' });
  assert.deepEqual(read('Shaft height: 12'), { shaft_height: '12' });
  assert.deepEqual(read('Sole length 12.25". Insole length 11.5".'), { sole_length: '12.25' });
});

test('converts centimeters and leaves shorthand without a unit blank', () => {
  assert.deepEqual(read('Shaft height: 33 cm'), { shaft_height: '12.992' });
  assert.deepEqual(read('heel height 5 cm'), { heel_height: '1.969' });
  assert.deepEqual(read('shaft 13'), {});
  assert.deepEqual(read('heel 2'), {});
  assert.deepEqual(read('circ 15'), {});
  assert.deepEqual(read('shaft 99in'), {});
  assert.deepEqual(read('heel: 10 in'), {});
});

test('a full listing fills every stated measurement and ignores size, price, year, and style numbers', () => {
  const text = `Lucchese Classics men's cowboy boots, size 10 D. Square toe. Made in USA.
Black full quill ostrich, leather sole, 1 1/2" riding heel.
Shaft height 12 1/2", shaft circumference 14.5 in, outsole length 12-1/2 inches,
outsole width at the ball 4.25".
Price $850. Style #0030. Model 09050. Vintage, circa 2019.`;
  assert.deepEqual(read(text), {
    shaft_height: '12.5', shaft_circ: '14.5', heel_height: '1.5',
    sole_length: '12.5', sole_width: '4.25',
  });
});

test('does not treat sizes, prices, years, style numbers, or nearby words as measurements', () => {
  const blanks = [
    'Size 10 D',
    "Men's size 10.5 EE",
    'Price $450',
    'Only $12.50 shipped',
    'Made in 2019',
    'Vintage 1998 Lucchese',
    'Riding heel',
    'Square toe',
    'Beautiful leather shaft',
    'Call (512) 555-0134',
    'Model 09050',
    'Style #0030',
    'Style: 0030',
    'SKU #00991',
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
  assert.deepEqual(read('Size 10 D, $450, made in 2019. Riding heel, leather sole. Width D. Leather shaft. Style #0030.'), {});
});

test('enrich keeps WBW names, flags free-text measurements, and still reads the rest', () => {
  const it = enrich({
    title: 'Lucchese men\'s 10 D ostrich cowboy boots',
    price: 850,
    description: `Brand new, never worn. Made in USA. Square toe, riding heel, leather sole.
Shaft height 12 1/2". Circ 15". Heel: 2 in. Outsole length 12.5 in. Outsole width at the ball 4.25".
Price $850. Style: 0030. Made in 2019.`,
  });
  assert.equal(it.brand, 'Lucchese');
  assert.equal(it.size, '10');
  assert.equal(it.width, 'D');
  assert.equal(it.toe, 'Square toe');
  assert.equal(it.heel, 'Riding heel');
  assert.equal(it.sole, 'Leather');
  assert.equal(it.made_in, 'USA');
  assert.equal(it.shaft_height, '12.5');
  assert.equal(it.shaft_circ, '15');
  assert.equal(it.heel_height, '2');
  assert.equal(it.sole_length, '12.5');
  assert.equal(it.sole_width, '4.25');
  assert.equal(it.id_text, '0030');
  assert.equal(it.id_text, '0030');
  assert.notEqual(it.id_text, '30');
  for (const k of [...MEASUREMENT_KEYS, 'id_text']) assert.ok(it.guessed.includes(k), k);
  assert.equal(it.guessed.includes('made_in'), true);
});

test('a labeled measurement is kept and not re-flagged, and a saved value wins', () => {
  const labeled = enrich({
    title: 'Boots',
    description: 'Shaft height: 12 1/2\nSole length: 12.1\nStyle: 0030',
  });
  assert.equal(labeled.shaft_height, '12.5');
  assert.equal(labeled.sole_length, '12.1');
  assert.equal(labeled.guessed.includes('shaft_height'), false);
  assert.equal(labeled.id_text, '0030');

  const kept = enrich({ title: 'Boots', description: 'shaft 13in', shaft_height: '11', id_text: '1883' });
  assert.equal(kept.shaft_height, '11');
  assert.equal(kept.id_text, '1883');
  assert.equal(kept.guessed.includes('shaft_height'), false);
  assert.equal(kept.guessed.includes('id_text'), false);
});

test('no measurements leaves those fields blank, and a brand is not an origin', () => {
  const it = enrich({ title: 'Lucchese men\'s 10 D ostrich cowboy boots', description: 'Square toe, riding heel, leather sole. Size 10 D. $450. The pull strap says 0030. 2019.' });
  for (const k of MEASUREMENT_KEYS) {
    assert.equal(it[k], null, k);
    assert.equal(it.guessed.includes(k), false, k);
  }
  assert.equal(it.made_in, null);
  assert.equal(it.id_text, null);
  assert.equal(it.toe, 'Square toe');
  assert.equal(it.heel, 'Riding heel');
});

test('origin is the place the listing states, not shipping or the seller', () => {
  assert.equal(readOrigin('Made in Texas').made, 'Texas');
  assert.equal(readOrigin('handmade in El Paso').made, 'El Paso');
  assert.equal(readOrigin('Hand-made in El Paso, Texas').made, 'El Paso, Texas');
  assert.equal(readOrigin('Made in USA').made, 'USA');
  assert.equal(readOrigin('Hecho en Mexico').made, 'Mexico');
  assert.ok(readOrigin('Leon, Mexico').commas.includes('Leon, Mexico'));
  assert.equal(readOrigin('Ships from Texas').made, null);
  assert.equal(readOrigin('Shipping from El Paso. Made in Mexico').made, 'Mexico');
  assert.equal(readOrigin('Seller location: Texas').made, null);
  assert.equal(readOrigin('Located in Dallas').made, null);
  assert.equal(readOrigin('Made in 2019').made, null);
  assert.equal(enrich({ title: 'Lucchese boots', description: 'Ships from Texas' }).made_in, null);
  assert.equal(enrich({ title: 'Boots', description: 'Hecho en Mexico' }).made_in, 'Mexico');
  assert.equal(enrich({ title: 'Boots', description: 'Leon, Mexico' }).made_in, 'Leon, Mexico');
  assert.equal(enrich({ title: 'Boots', description: 'Made in El Paso, Texas' }).made_in, 'El Paso, Texas');
  assert.equal(enrich({ title: 'Boots', description: 'Made in the U.S.A.' }).made_in, 'USA');
});

test('a seller default can fill where-made and cannot invent a measurement or a style number', () => {
  const it = enrichFor(
    { title: 'Lucchese 10 D cowboy boots', description: 'SH: 13in\nRiding heel' },
    { terms: 'SH = shaft height', defaults: 'shaft_height = 12\nmade_in = USA\nid_text = 0001' },
  );
  assert.equal(it.shaft_height, '13');
  assert.equal(it.made_in, 'USA');
  assert.equal(it.id_text, null);
  const blank = enrichFor({ title: 'Justin 9 D cowboy boots', description: 'Riding heel' }, { defaults: 'sole_length = 12\nheel_height = 2\nid_text = 0030' });
  assert.equal(blank.sole_length, null);
  assert.equal(blank.heel_height, null);
  assert.equal(blank.id_text, null);
});

test('measurement keys are the sell-a-pair columns and are not appended to the CSV', () => {
  for (const k of MEASUREMENT_KEYS) assert.ok(FIELDS.includes(k), k);
  assert.equal(FIELDS.includes('outsole_length'), false);
  assert.equal(FIELDS.includes('insole_length'), false);
  assert.equal(CSV.sole_length, 'Sole length');
  assert.equal(CSV.shaft_height, 'Shaft height');
  assert.equal(CSV.made_in, 'Where made');
  assert.equal(CSV.id_text, 'Model / date codes');
  assert.equal(Object.hasOwn(CSV, 'photo_codes'), false);
  assert.equal(Object.hasOwn(CSV, 'outsole_length'), false);
  const page = readFileSync(new URL('../app/screen.js', import.meta.url), 'utf8');
  assert.match(page, /sole_length: 'Sole length/);
  assert.match(page, /From photos, not verified/);
});

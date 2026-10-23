import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { enrich } from '../lib/wbw.js';

const HEADERS = ['Photos', 'Listing title', 'Asking price', 'Brand', 'Sized for', 'Size', 'Size estimated', 'Condition', 'Width', 'Material type', 'Material / hide', 'Material specifics (cut)', 'Where made', 'Color', 'Keywords', 'Sole length (in)', 'Sole width (in)', 'Heel height (in)', 'Shaft circumference (in)', 'Shaft height (in)', 'Sole', 'Heel', 'Toe', 'Description'];

describe('WBW sell-a-pair fields', () => {
  it('exports every field from the WBW listing form', () => {
    const src = readFileSync(new URL('../app/screen.js', import.meta.url), 'utf8');
    const cols = src.slice(src.indexOf('const CSV = {'), src.indexOf('const cell')).split('\n').join(' ');
    let at = 0;
    for (const h of HEADERS) {
      const i = cols.indexOf(`'${h}'`, at);
      assert.ok(i > at, h);
      at = i;
    }
  });

  it('fills every field the listing actually states', () => {
    const e = enrich({
      title: "Lucchese women's black cherry caiman belly square toe boots",
      price: 450,
      description: `Vintage limited edition, hand-tooled, pre-ban inlay.
Sole length: 12.1
Sole width: 4.25 inches
Heel height: 1.5
Shaft circumference: 15.5
Shaft height: 12.5
Made in Leon, Mexico
Leather sole. Riding heel.`,
    });
    assert.equal(e.brand, 'Lucchese');
    assert.equal(e.sized_for, 'Women');
    assert.equal(e.color, 'Black Cherry');
    assert.equal(e.material, 'Caiman Belly');
    assert.equal(e.material_type, 'Exotic');
    assert.equal(e.material_cut, 'Belly');
    assert.equal(e.toe, 'Square toe');
    assert.equal(e.heel, 'Riding heel');
    assert.equal(e.sole, 'Leather');
    assert.equal(e.made_in, 'Leon');
    assert.equal(e.condition, 'Broken In');
    assert.equal(e.sole_length, '12.1');
    assert.equal(e.sole_width, '4.25');
    assert.equal(e.heel_height, '1.5');
    assert.equal(e.shaft_circ, '15.5');
    assert.equal(e.shaft_height, '12.5');
    assert.equal(e.wbw_price, undefined);
    for (const tag of ['Vintage', 'Exotic', 'Square toe', 'Limited Edition', 'Hand-tooled', 'Pre-ban', 'Inlay / overlay'])
      assert.ok(e.keywords.split(', ').includes(tag), tag);
    assert.equal(e.width, null);
    assert.ok(e.guessed.includes('keywords'));
    assert.ok(e.guessed.includes('material_cut'));
    assert.ok(!e.guessed.includes('sole_length'));
    assert.ok(e.guessed.includes('sized_for'));
  });

  it('keeps a labeled value and reads measurements written in a sentence', () => {
    const e = enrich({
      title: 'Tony Lama boots',
      description: `Size: 10.5
Width: D
Keywords: Vintage
Cut: belly
Asking price: $400
1.5" heel and a 12" shaft. Shaft opening 15".`,
    });
    assert.equal(e.size, '10.5');
    assert.equal(e.width, 'D');
    assert.equal(e.keywords, 'Vintage');
    assert.equal(e.material_cut, 'Belly');
    assert.equal(e.wbw_price, '400');
    assert.equal(e.heel_height, '1.5');
    assert.equal(e.shaft_height, '12');
    assert.equal(e.shaft_circ, '15');
    assert.ok(!e.guessed.includes('keywords'));
    assert.ok(!e.guessed.includes('width'));
    assert.ok(e.guessed.includes('heel_height'));
  });

  it('uses New, Custom Made, or an estimated size only when the listing says so', () => {
    const fresh = enrich({ title: 'Brand new boots', description: 'Deadstock, never worn. Estimated size.' });
    assert.equal(fresh.condition, 'New');
    assert.equal(fresh.size_estimated, 'Yes');
    assert.ok(fresh.keywords.includes('Deadstock'));
    const made = enrich({ title: 'Custom made ropers', description: 'Made to order.' });
    assert.equal(made.condition, 'Custom Made');
    assert.ok(made.keywords.includes('Custom'));
    const quiet = enrich({ title: 'Pair of boots', description: 'Nice pair, worn some.' });
    assert.equal(quiet.condition, 'Broken In');
    assert.equal(quiet.material, null);
    assert.equal(quiet.material_cut, null);
    assert.equal(quiet.keywords, null);
    assert.equal(quiet.sole_length, null);
    assert.equal(quiet.heel_height, null);
    assert.equal(quiet.width, null);
    assert.equal(quiet.sized_for, 'Men');
  });
});

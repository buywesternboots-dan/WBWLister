import assert from 'node:assert/strict';
import test from 'node:test';
import { CSV, exportRecord } from '../lib/export.js';
import { applyAutoOptimization } from '../lib/optimize.js';
import { exportReadiness } from '../lib/readiness.js';
import { bundledStyleSample } from '../lib/style-sample.js';
import { displayWidth } from '../lib/vocab.js';
import { bundledDirectory } from '../lib/wbw-ref.js';

const dir = bundledDirectory().makers;
const sample = bundledStyleSample();
const photos = ['https://cdn.example/first.jpg', 'https://cdn.example/second.jpg'];

test('exact brand, style, and material are filled and the title is not rewritten', () => {
  const original = 'Style: 0030\nWorn.';
  const fields = {
    title: 'Dan Post boots', description: original, brand: 'dan post', size: '9', width: 'AAA',
    material: '', id_text: null, price: 100, photos: [...photos], guessed: ['brand'],
  };
  applyAutoOptimization(fields, { ...fields, source_id: 'dp-1', verified: [] }, { directory: dir, styleSample: sample });
  assert.equal(fields.brand, 'Dan Post');
  assert.equal(fields.guessed.includes('brand'), false);
  assert.equal(fields.id_text, '0030');
  assert.equal(fields.width, 'AAA');
  assert.equal(fields.title, 'Dan Post boots');
  assert.equal(fields.description.slice(0, original.length), original);
  assert.deepEqual(fields.photos, photos);
  assert.equal(fields.opt_applied.photo_order, 'source');
  assert.equal(fields.opt_applied.first_photo, 1);
  assert.equal(fields.opt_applied.media, 'lens');
  assert.ok(fields.opt_applied.seo_title);
  assert.equal(exportRecord({ ...fields, id: 9 }).width, 'A');
  assert.equal(displayWidth('N'), 'N');
  assert.equal(Object.values(CSV).includes('Export readiness'), false);
  const ready = exportReadiness(fields);
  assert.equal(ready.ready, true);
  assert.deepEqual(ready.missing, []);
  assert.notEqual(fields.opt_proposal.title, fields.title);
});

test('catalog material is used only when the card text is that material', () => {
  const fields = {
    title: 'Tony Lama boots', description: 'Worn.', brand: 'Tony Lama', size: '10', width: 'D',
    material: '', id_text: '1047 12928507', price: 80, photos: [...photos], guessed: ['material'],
    verified: ['id_text', 'brand'],
  };
  applyAutoOptimization(fields, { ...fields, source_id: 'tl-1' }, { directory: dir, styleSample: sample });
  assert.equal(fields.material, 'Caiman');
  assert.equal(fields.description.includes('Caiman'), false);
  assert.equal(fields.id_text, '1047 12928507');
  assert.equal(exportReadiness(fields).ready, true);

  const conflict = {
    title: 'Tony Lama boots', description: 'Worn.', brand: 'Tony Lama', size: '10', width: 'D',
    material: 'Leather', id_text: '1047 12928507', price: 80, photos: [...photos], guessed: [],
    verified: ['id_text', 'brand', 'material'],
  };
  applyAutoOptimization(conflict, { ...conflict, source_id: 'tl-2' }, { directory: dir, styleSample: sample });
  assert.equal(conflict.material, 'Leather');
  assert.equal(exportReadiness(conflict).ready, true);
  assert.equal(exportReadiness(conflict).missing.includes('material needs a human'), false);
});

test('readiness names the gaps and does not invent a style', () => {
  const fields = {
    title: 'Mystery boots', description: 'Worn.', brand: 'Nope', size: '', width: '',
    material: '', id_text: null, price: 10, photos: [...photos], guessed: [],
  };
  applyAutoOptimization(fields, { ...fields, source_id: 'no-1' }, { directory: dir, styleSample: sample });
  assert.equal(fields.brand, 'Nope');
  assert.equal(fields.id_text, null);
  assert.equal(fields.title, 'Mystery boots');
  const missing = exportReadiness(fields).missing;
  for (const gap of ['no style number', 'missing size', 'missing width']) assert.ok(missing.includes(gap), gap);
  assert.equal(missing.includes('no brand'), false);
  assert.equal(missing.includes('title rewrite pending Apply'), false);
  assert.equal(missing.includes('description rewrite pending Apply'), false);
  const offered = exportReadiness({
    ...fields, opt_proposal: { title: 'A different title', description: 'A different description' },
  });
  assert.equal(offered.missing.includes('title rewrite pending Apply'), false);
  const bare = exportReadiness({ title: 'Boots', description: 'Worn.', photos: [] });
  for (const gap of ['no brand', 'no style number', 'missing size', 'missing width', 'no price', 'too few photos'])
    assert.ok(bare.missing.includes(gap), gap);
});

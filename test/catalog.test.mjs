import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import test from 'node:test';
import { CATALOG_SHA256, bundledStyleSample, matchStyleSample } from '../lib/style-sample.js';

const catalog = bundledStyleSample();
const item = (brand, id_text, description = '') => ({
  brand, verified: id_text ? ['id_text'] : [], id_text, description, photos: ['https://cdn.example/a.jpg'],
});

test('the full catalog is the exact-match source', () => {
  const file = readFileSync(new URL('../data/wbw-reference/models.csv', import.meta.url));
  assert.equal(createHash('sha256').update(file).digest('hex'), CATALOG_SHA256);
  assert.ok(statSync(new URL('../data/wbw-reference/models.csv', import.meta.url)).size < 4_000_000);
  assert.equal(catalog.partial_sample, false);
  assert.equal(catalog.snapshot_date, '2026-11-08');
  assert.equal(catalog.sample_records, 12487);
  assert.equal(catalog.errors.length, 0);
  assert.equal(catalog.records.filter(r => r.style_number == null).length, 1262);
  assert.equal(new Set(catalog.records.map(r => r.maker_slug)).size, 87);
  const started = Date.now();
  for (let i = 0; i < 2000; i++) matchStyleSample(item('Dan Post', '0030'), catalog, 'Dan Post');
  assert.ok(Date.now() - started < 500);
});

test('real rows hit, keep leading zeros, skip blanks, and refuse conflicts', () => {
  const hit = matchStyleSample(item('Dan Post', '0030'), catalog, 'Dan Post');
  assert.equal(hit.status, 'candidate');
  assert.equal(hit.matches[0].style_number, '0030');
  assert.equal(hit.matches[0].record_url, 'https://www.westernbootworld.com/lookup/record/66d43cb9-9b85-4db9-8812-ab1033610987');
  assert.equal(matchStyleSample(item('Dan Post', '30'), catalog, 'Dan Post').status, 'none');

  const zero = matchStyleSample(item('Acme Boots', '03122'), catalog, 'Acme Boots');
  assert.equal(zero.status, 'candidate');
  assert.equal(zero.matches[0].style_number, '03122');
  assert.notEqual(zero.matches[0].style_number, '3122');
  assert.equal(matchStyleSample(item('Acme Boots', '3122'), catalog, 'Acme Boots').status, 'none');

  const blank = catalog.records.find(r => r.maker_slug === 'abraham-rios-boot-company' && r.style_number == null);
  assert.ok(blank);
  const missed = matchStyleSample(item(blank.maker_name, ''), catalog, blank.maker_name);
  assert.equal(missed.status, 'none');
  assert.equal(JSON.stringify(missed).includes(blank.record_url), false);

  const clash = matchStyleSample(item('Lucchese', 'M4842'), catalog, 'Lucchese');
  assert.equal(clash.status, 'ambiguous');
  assert.equal(clash.matches.length, 0);
  assert.equal(matchStyleSample(item('Tony Lama', '1047'), catalog, 'Tony Lama').status, 'none');
  const whole = matchStyleSample(item('Tony Lama', '1047 12928507'), catalog, 'Tony Lama');
  assert.equal(whole.matches[0].other_card_text, 'Caiman');
  assert.equal(whole.matches[0].style_number, '1047 12928507');
});

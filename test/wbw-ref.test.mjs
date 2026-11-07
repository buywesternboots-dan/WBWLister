import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { optimize } from '../lib/optimize.js';
import { assertLookupUnavailable, parseMakerDirectory, parseMakerSamples, suggestMaker } from '../lib/wbw-ref.js';

const read = name => readFileSync(new URL(`../data/wbw-reference/${name}`, import.meta.url), 'utf8');

describe('maker directory snapshot', () => {
  const parsed = parseMakerDirectory(read('makers.csv'));
  const samples = parseMakerSamples(read('maker_samples.json'));
  const lookup = assertLookupUnavailable(read('lookup_notes.md'));

  it('parses 258 unique makers and keeps blurbs off the listing', () => {
    assert.equal(parsed.errors.length, 0);
    assert.equal(parsed.makers.length, 258);
    assert.equal(parsed.counts.manufacturers, 91);
    assert.equal(parsed.counts.bootmakers, 167);
    assert.equal(parsed.fetched_at, '2026-11-07T15:35:00-05:00');
    assert.equal(read('makers.csv').includes('\uFFFD'), false);
    assert.equal(parsed.makers.every(m => m.applies_to_boot === false && m.source_url && m.url), true);
    const lucchese = suggestMaker('LUCCHESE', parsed.makers);
    assert.equal(lucchese.name, 'Lucchese');
    assert.equal(lucchese.applies_to_boot, false);
    assert.equal(lucchese.use_in_listing, 'spelling');
    assert.equal(Object.hasOwn(lucchese, 'location'), false);
    assert.equal(Object.hasOwn(lucchese, 'search_blurb'), false);
    assert.equal(suggestMaker('Not A Real Boot Co', parsed.makers), null);
    assert.equal(suggestMaker('Black Jack', parsed.makers), null);
  });

  it('treats the eight samples as excerpts and does not publish them or invent a model', () => {
    assert.equal(samples.length, 8);
    assert.ok(samples.every(s => s.excerpt === true && s.product_fact === false && Object.keys(s.fields).length === 0));
    assert.equal(lookup.available, false);
    const item = {
      id: 9, source_id: 'listing-a', title: 'Lucchese cowboy boots', description: 'Size 9 D. Black calf. Worn some.',
      brand: 'Lucchese', sized_for: 'Men', size: '9', width: 'D', material: 'Calf', color: 'Black', condition: 'Broken In',
      boot: 'boot', photos: ['https://cdn.example/a.jpg'], guessed: [], verified: ['brand', 'sized_for', 'size', 'width', 'material', 'color', 'condition'],
    };
    const out = optimize(item, [], { directory: parsed.makers, fetched_at: parsed.fetched_at, samples });
    const prose = `${out.proposal.title}\n${out.proposal.description}\n${out.proposal.facts}`;
    assert.equal(prose.includes('Sicilian'), false);
    assert.equal(prose.includes('Somerset'), false);
    assert.equal(JSON.stringify(out.proposal).includes('search_blurb'), false);
    assert.equal(out.proposal.directory.model_lookup, false);
    assert.equal(out.proposal.directory.live, false);
    assert.equal(out.proposal.directory.sample_used, false);
    assert.equal(out.proposal.directory.suggestion.name, 'Lucchese');
    assert.equal(out.proposal.directory.suggestion.applies_to_boot, false);
    assert.match(out.proposal.title, /^Lucchese\b/);
  });
});

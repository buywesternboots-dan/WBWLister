import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { factsFingerprint } from '../lib/facts.js';
import { optimize, sourceRefreshPlan, importOriginal } from '../lib/optimize.js';
import { CSV } from '../lib/export.js';
import { acceptedStyleRef, explicitStyles, matchStyleSample, parseStyleSample } from '../lib/style-sample.js';

const sample = parseStyleSample(readFileSync(new URL('../data/wbw-reference/models_sample.normalized.json', import.meta.url), 'utf8'));
const item = (over = {}) => ({
  id: 4, brand: 'Dan Post', title: 'Dan Post boots', description: 'Worn some.', boot: 'boot',
  verified: ['brand', 'id_text'], id_text: '0030', guessed: [], photos: ['https://cdn.example/a.jpg'], ...over,
});

describe('partial style snapshot', () => {
  it('keeps leading zeros and refuses missing, coerced, and cross-maker styles', () => {
    assert.equal(sample.errors.length, 0);
    assert.equal(sample.sample_records, 100);
    assert.equal(sample.displayed_records, 3058);
    assert.equal(sample.records.filter(r => r.style_number == null).length, 2);
    assert.equal(sample.records.filter(r => typeof r.style_number === 'string' && r.style_number.startsWith('0')).length, 33);
    assert.equal(sample.ambiguous_keys.length, 0);
    const hit = matchStyleSample(item(), sample, 'Dan Post');
    assert.equal(hit.status, 'candidate');
    assert.equal(hit.matches[0].style_number, '0030');
    assert.equal(hit.matches[0].record_url, 'https://www.westernbootworld.com/lookup/record/66d43cb9-9b85-4db9-8812-ab1033610987');
    assert.equal(matchStyleSample(item({ id_text: '30' }), sample, 'Dan Post').status, 'none');
    assert.equal(matchStyleSample(item({ id_text: '0030 ' }), sample, 'Dan Post').matches[0].style_number, '0030');
    assert.equal(matchStyleSample(item({ verified: ['brand'], id_text: '0030' }), sample, 'Dan Post').status, 'none');
    assert.equal(matchStyleSample(item({ brand: 'Lucchese', id_text: '0030' }), sample, 'Lucchese').status, 'none');
    assert.equal(matchStyleSample(item({ verified: ['brand'], id_text: '', description: 'The number 0030 is on the pull strap.' }), sample, 'Dan Post').status, 'none');
    const labeled = matchStyleSample(item({ verified: ['brand'], id_text: '', description: 'Style: 0030\nWorn some.' }), sample, 'Dan Post');
    assert.equal(labeled.matches[0].style_number, '0030');
    assert.equal(matchStyleSample(item({ brand: 'Frye', id_text: "1940's FRYE Boot Company Vintage" }), sample, 'Frye').matches.length, 0);
    const compound = matchStyleSample(item({ brand: 'Tony Lama', id_text: '1047' }), sample, 'Tony Lama');
    assert.equal(compound.matches.length, 0);
    const whole = matchStyleSample(item({ brand: 'Tony Lama', id_text: '1047 12928507' }), sample, 'Tony Lama');
    assert.equal(whole.matches.length, 1);
    assert.equal(whole.matches[0].other_card_text, 'Caiman');
    assert.equal(whole.matches[0].other_card_text_unverified, true);
    const out = optimize(item({ brand: 'Tony Lama', id_text: '1047 12928507', material: null, guessed: [] }), [], { styleSample: sample });
    assert.equal(out.proposal.facts.includes('Caiman'), false);
    assert.equal(out.proposal.description.includes('Caiman'), false);
    assert.equal(out.proposal.style_sample.matches[0].style_number, '1047 12928507');
    assert.equal(JSON.stringify(out.proposal.facts).includes(whole.matches[0].record_url), false);
  });

  it('rejects unsafe links, stays ambiguous, and stores only the reference', () => {
    const bad = parseStyleSample({ partial_sample: true, coverage: [], records: [{ maker_name: 'Dan Post', maker_slug: 'dan-post', record_title: '0030', style_number: '0030', record_url: 'javascript:alert(1)', candidate_match_eligible: true, provenance: { source_url: 'https://www.westernbootworld.com/library/maker/dan-post/catalog' } }] });
    assert.equal(bad.records.length, 0);
    const raw = { maker_name: 'Dan Post', maker_slug: 'dan-post', record_title: '0030', style_number: '0030', candidate_match_eligible: true, record_url: 'https://www.westernbootworld.com/lookup/record/66d43cb9-9b85-4db9-8812-ab1033610987', provenance: { source_url: 'https://www.westernbootworld.com/library/maker/dan-post/catalog' } };
    const dup = parseStyleSample({
      partial_sample: true, coverage: [{ catalog_total_displayed: 1 }],
      records: [raw, { ...raw, record_url: 'https://www.westernbootworld.com/lookup/record/11111111-1111-1111-1111-111111111111' }],
    });
    assert.equal(dup.errors.length, 0);
    assert.equal(matchStyleSample({ verified: ['id_text'], id_text: '0030' }, dup, 'Dan Post').status, 'ambiguous');
    const match = matchStyleSample(item(), sample, 'dan post');
    const kept = acceptedStyleRef(match, match.matches[0].record_url, '2026-11-07T00:00:00Z');
    assert.equal(kept.adds_listing_facts, false);
    assert.equal(kept.style_number, '0030');
    assert.throws(() => acceptedStyleRef(match, 'https://www.westernbootworld.com/lookup/record/00000000-0000-0000-0000-000000000000'), /not a candidate/);
    const before = factsFingerprint(item());
    assert.equal(factsFingerprint({ ...item(), style_ref: kept }), before);
    const refreshed = sourceRefreshPlan({ src_hash: 'a', opt_original: { title: 'T', description: 'Style: 0030' }, style_ref: kept }, 'b', importOriginal({ title: 'T', description: 'no style' }, [], 't'));
    assert.equal(refreshed.style_ref, null);
    assert.equal(explicitStyles(item({ verified: ['brand'], description: 'Style: 0507R' })).join(), '0507R');
    assert.equal(Object.values(CSV).includes('Catalog record'), false);
  });
});

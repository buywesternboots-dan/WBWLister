import assert from 'node:assert/strict';
import test from 'node:test';
import { appendMakerNote, exactMaker, makerSnippet, withoutMakerNote } from '../lib/maker-note.js';
import { applyAutoOptimization } from '../lib/optimize.js';
import { bundledStyleSample, matchStyleSample, normStyle, parseStyleSample, styleIndex } from '../lib/style-sample.js';
import { bundledDirectory } from '../lib/wbw-ref.js';

const dir = bundledDirectory();
const lucchese = exactMaker('Lucchese', dir.makers);
const GLUE = new Set('about the this maker directory lists listed is in for says listing there as page location'.split(' '));

function outsideFacts(note, maker) {
  let rest = note;
  for (const bit of [maker.name, maker.location, maker.search_blurb, maker.url]) rest = rest.split(bit).join(' ');
  return rest.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean);
}

test('maker notes vary by listing and stay fixed for one listing', () => {
  assert.equal(lucchese.name, 'Lucchese');
  assert.equal(exactMaker('lucchese', dir.makers).name, 'Lucchese');
  assert.equal(exactMaker('Tony Lama', dir.makers).url.endsWith('/tony-lama'), true);
  assert.equal(exactMaker('Tony Lama Sr.', dir.makers).name, 'Tony Lama Sr.');
  assert.equal(exactMaker('Not A Maker', dir.makers), null);
  const notes = [];
  for (let i = 0; i < 20; i++) notes.push(makerSnippet(lucchese, `pair-${i}`));
  assert.ok(new Set(notes).size >= 8, `distinct ${new Set(notes).size}`);
  assert.equal(makerSnippet(lucchese, 'pair-3'), makerSnippet(lucchese, 'pair-3'));
  for (const note of notes) {
    const sentences = note.split('\n')[1].split(/(?<=\.)\s/).filter(Boolean);
    assert.ok(sentences.length >= 1 && sentences.length <= 3, note);
    for (const word of outsideFacts(note, lucchese)) assert.ok(GLUE.has(word), `${word} in ${note}`);
    assert.doesNotMatch(note, /founded|legendary|handmade|this pair/i);
    assert.match(note, /Lucchese/);
  }
});

test('import appends the maker note and keeps the original description as a prefix', () => {
  const original = 'Size 9 AAA. Old heel.';
  const fields = { title: 'Lucchese boots', description: original, brand: 'Lucchese', price: 80, photos: ['https://cdn.example/a.jpg'] };
  applyAutoOptimization(fields, { ...fields, source_id: 'sku-9' }, { directory: dir.makers, now: '2026-11-09T00:00:00.000Z' });
  assert.equal(fields.opt_original.description, original);
  assert.equal(fields.description.slice(0, original.length), original);
  assert.equal(fields.description.startsWith(`${original}\n\n`), true);
  assert.equal(withoutMakerNote(fields.description, original, fields.opt_applied.maker_note), original);
  assert.equal(fields.opt_proposal.maker_note, fields.opt_applied.maker_note);
  const again = { ...fields, description: original };
  applyAutoOptimization(again, { ...again, source_id: 'sku-9' }, { directory: dir.makers });
  assert.equal(again.description, fields.description);

  const quiet = { title: 'Boots', description: original, brand: 'Not A Maker', price: 1, photos: ['https://cdn.example/a.jpg'] };
  applyAutoOptimization(quiet, quiet, { directory: dir.makers });
  assert.equal(quiet.description, original);
});

test('style match is exact on maker and the full style number', () => {
  const sample = bundledStyleSample();
  assert.equal(normStyle('  0030  '), '0030');
  assert.notEqual(normStyle('0030'), normStyle('30'));
  const hit = matchStyleSample({ verified: ['id_text'], id_text: '0030', description: '' }, sample, 'DAN POST');
  assert.equal(hit.status, 'candidate');
  assert.equal(hit.matches[0].style_number, '0030');
  const spaced = matchStyleSample({ verified: ['id_text'], id_text: '  0030 ', description: '' }, sample, 'dan-post');
  assert.equal(spaced.matches[0].style_number, '0030');
  assert.equal(matchStyleSample({ verified: ['id_text'], id_text: '30', description: '' }, sample, 'Dan Post').status, 'none');
  assert.equal(matchStyleSample({ verified: ['id_text'], id_text: '003', description: '' }, sample, 'Dan Post').status, 'none');
  assert.equal(matchStyleSample({ verified: [], id_text: '', description: 'Style:\n' }, sample, 'Dan Post').status, 'none');
  assert.equal(matchStyleSample({ verified: ['brand'], description: 'Model: 0030 extra', id_text: '' }, sample, 'Dan Post').matches[0].style_number, '0030');

  const card = 'https://www.westernbootworld.com/lookup/record/11111111-1111-1111-1111-111111111111';
  const other = 'https://www.westernbootworld.com/lookup/record/22222222-2222-2222-2222-222222222222';
  const src = 'https://www.westernbootworld.com/library/maker/dan-post/catalog';
  const row = (style, title, url, text) => ({
    maker_name: 'Dan Post', maker_slug: 'dan-post', record_title: title, style_number: style,
    other_card_text: text, candidate_match_eligible: true, record_url: url, provenance: { source_url: src },
  });
  const mini = parseStyleSample({ records: [row('AbC', 'AbC', card, 'Caiman'), row('', 'blank', other, null)] });
  assert.equal(styleIndex(mini.records).has('dan-post\n'), false);
  const cased = matchStyleSample({ verified: ['id_text'], id_text: 'abc', description: '' }, mini, 'Dan Post');
  assert.equal(cased.matches[0].style_number, 'AbC');
  assert.equal(cased.matches[0].other_card_text, 'Caiman');
  const fields = { title: 'Dan Post', description: 'Worn.', brand: 'Dan Post', photos: ['https://cdn.example/a.jpg'] };
  applyAutoOptimization(fields, { ...fields, source_id: 'dp', verified: ['id_text'], id_text: 'abc' }, { directory: dir.makers, styleSample: mini });
  assert.equal(fields.description.includes('Caiman'), false);
  assert.equal(fields.description.includes(card), false);
  assert.equal(fields.opt_proposal.style_sample.matches[0].record_url, card);
  assert.equal(fields.description.startsWith('Worn.'), true);

  const ambiguous = parseStyleSample({ records: [row('0030', 'One', card, 'A'), row('0030', 'Two', other, 'B')] });
  assert.equal(matchStyleSample({ verified: ['id_text'], id_text: '0030', description: '' }, ambiguous, 'Dan Post').status, 'ambiguous');
  const started = Date.now();
  for (let i = 0; i < 2000; i++) matchStyleSample({ verified: ['id_text'], id_text: '0030', description: '' }, sample, 'Dan Post');
  assert.ok(Date.now() - started < 500);
  assert.equal(appendMakerNote('Worn.', fields.opt_applied.maker_note).startsWith('Worn.\n\n'), true);
});

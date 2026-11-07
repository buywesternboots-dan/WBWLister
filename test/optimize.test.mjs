import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { itemsResponse } from '../lib/items-api.js';
import { applyOptimization, cleanText, copyNames, editProposal, optimize, structureVariant } from '../lib/optimize.js';
import { CSV, exportRecord, toCsv } from '../lib/export.js';
import { matchReferences, parseReferenceTable, referenceFromFields, REFERENCE_NOTE } from '../lib/references.js';
import { photoUrl } from '../lib/seo.js';
import { sessionToken } from '../lib/session.js';
import { applyReturnsToReview } from '../lib/publish.js';
import { displayWidth } from '../lib/vocab.js';

const read = p => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const HEADERS = ['Photos', 'Listing title', 'Asking price', 'Brand', 'Sized for', 'Size', 'Size estimated', 'Condition', 'Width', 'Material type', 'Material / hide', 'Material specifics (cut)', 'Where made', 'Color', 'Keywords', 'Sole length', 'Sole width', 'Heel height', 'Shaft circumference', 'Shaft height', 'Sole', 'Heel', 'Toe', 'Description', 'WBW Seller Name', 'Source price', 'Model / date codes', 'Category', 'Seller Website Link', 'Image Alt Text', 'Brand Context', 'Brand Page Link', 'Seller Context', 'Source ID'];

const boot = (over = {}) => ({
  id: 9,
  seller: 'ada',
  source: 'facebook',
  source_id: 'listing-a',
  source_url: 'https://facebook.com/marketplace/item/9',
  title: 'Lucchese cowboy boots',
  description: 'Size 9 AAA. Black caiman. Worn some. Style 1883.',
  price: 400,
  wbw_price: 380,
  brand: 'Lucchese',
  sized_for: 'Men',
  size: '9',
  width: 'AAA',
  material: 'Caiman',
  material_type: 'Exotic',
  material_cut: 'Belly',
  color: 'Black',
  condition: 'Broken In',
  made_in: 'Mexico',
  toe: 'Square toe',
  heel: 'Riding heel',
  sole: 'Leather',
  sole_length: '12.1',
  boot: 'boot',
  photos: ['https://cdn.example/a.jpg', 'https://cdn.example/b.jpg'],
  guessed: [],
  verified: ['brand', 'sized_for', 'size', 'width', 'material', 'material_cut', 'color', 'condition', 'made_in', 'toe', 'heel', 'sole', 'sole_length'],
  ...over,
});

const ctx = { origin: 'https://app.test', seller: { display_name: 'Ada Boots', location: 'El Paso, TX' }, brands: {} };

describe('factual optimization', () => {
  it('keeps imported facts, exact width, and the original row', () => {
    const item = boot();
    const snapshot = structuredClone(item);
    const out = optimize(item, [], { now: '2026-11-07T00:00:00.000Z' });
    assert.deepEqual(item, snapshot);
    assert.equal(out.original.title, 'Lucchese cowboy boots');
    assert.equal(out.original.description, item.description);
    assert.deepEqual(out.original.photos, item.photos);
    assert.equal(out.original.price, 400);
    assert.equal(out.proposal.title.includes('AAA'), true);
    assert.equal(out.proposal.title.includes(' A '), false);
    assert.equal(out.proposal.description.includes('AAA'), true);
    assert.equal(out.proposal.facts.includes('12.1'), true);
    assert.equal(out.proposal.facts.includes('Mexico'), true);
    assert.equal(out.proposal.seller_notes.includes('Style 1883'), true);
    assert.equal(out.proposal.width_exact, 'AAA');
    assert.equal(displayWidth(out.proposal.width_exact), 'A');
    const again = optimize(item, [], { now: '2026-11-07T00:00:00.000Z' });
    assert.deepEqual(again, out);
  });

  it('does not invent material, model, size, or gender when they are missing or only guessed', () => {
    const quiet = optimize(boot({
      title: 'Nice pair',
      description: 'Ships tomorrow.',
      brand: null,
      sized_for: 'Men',
      size: null,
      width: null,
      material: 'Alligator',
      material_cut: null,
      color: null,
      condition: 'Broken In',
      made_in: null,
      toe: null,
      heel: null,
      sole: null,
      sole_length: null,
      boot: 'unsure',
      guessed: ['material', 'sized_for', 'condition'],
      verified: [],
      photos: ['https://cdn.example/a.jpg'],
    }), []);
    const prose = `${quiet.proposal.title}\n${quiet.proposal.facts}`;
    for (const word of ['Alligator', 'alligator', 'leather', 'size', 'Mexico', 'Lucchese', '1883', 'Men'])
      assert.equal(prose.toLowerCase().includes(word.toLowerCase()), false, word);
    assert.equal(quiet.proposal.description.includes('Ships tomorrow.'), true);
    assert.ok(quiet.proposal.omitted.some(o => o.field === 'material'));
    assert.equal(quiet.proposal.title_from, 'original');
  });

  it('strips markup and varies structure without spinning synonyms', () => {
    const dirty = boot({
      description: '<script>alert(1)</script><b>Worn some.</b> Size 9 AAA.\n\n\nStyle 1883.',
    });
    assert.equal(cleanText(dirty.description).includes('<'), false);
    assert.equal(cleanText(dirty.description).includes('Worn some.'), true);
    const out = optimize(dirty, []);
    assert.equal(out.proposal.description.includes('<'), false);
    assert.equal(out.proposal.seller_notes.includes('alert(1)'), false);
    const seedFor = n => {
      for (let i = 0; i < 300; i++) if (structureVariant(`id-${i}`) === n) return `id-${i}`;
      throw new Error(`no seed for variant ${n}`);
    };
    assert.ok(new Set([0, 1, 2, 3, 4, 5].map(i => structureVariant(`id-${i}`))).size > 1);
    const first = optimize(boot({ source_id: seedFor(0) }), []);
    const second = optimize(boot({ source_id: seedFor(1) }), []);
    assert.notEqual(first.proposal.description, second.proposal.description);
    assert.notEqual(first.proposal.fact_sentences.join(' '), second.proposal.fact_sentences.join(' '));
    assert.deepEqual([...first.proposal.fact_sentences].sort(), [...second.proposal.fact_sentences].sort());
    for (const word of ['stunning', 'gorgeous', 'beautiful', 'must-see', 'wow', 'rare find'])
      assert.equal(first.proposal.description.toLowerCase().includes(word), false, word);
  });

  it('keeps a second pass anchored to the preserved import', () => {
    const item = boot();
    const first = optimize(item, []);
    const applied = applyOptimization(item, first, { now: '2026-11-07T00:00:00.000Z' });
    const again = optimize({ ...item, ...applied }, []);
    assert.equal(again.original.description, item.description);
    assert.equal(again.proposal.seller_notes.includes('Style 1883'), true);
    assert.equal(again.proposal.seller_notes.includes('From the seller:'), false);
  });
});

describe('photo copy names', () => {
  it('makes unique descriptive names without renaming stored or source files', () => {
    const item = boot();
    const names = copyNames(item);
    assert.equal(names.length, 2);
    assert.equal(new Set(names.map(n => n.file)).size, 2);
    assert.equal(names[0].stored_url, item.photos[0]);
    assert.equal(names[0].source_renamed, false);
    assert.equal(names[0].pixels, 'unchanged');
    assert.match(names[0].file, /aaa/);
    assert.match(names[0].alt, /AAA width/);
    assert.match(names[0].file, /-1-9\.jpg$/);
    assert.match(names[1].file, /-2-9\.jpg$/);
    const other = copyNames(boot({ id: 10, source_id: 'listing-b' }));
    assert.notEqual(names[0].file, other[0].file);
    const long = 'Lucchese '.repeat(40);
    const left = copyNames(boot({ id: 1, brand: long }));
    const right = copyNames(boot({ id: 2, brand: long }));
    assert.notEqual(left[0].file, right[0].file);
    assert.match(left[0].file, /-1-1\.jpg$/);
    assert.match(right[0].file, /-1-2\.jpg$/);
  });
});

describe('seller reference notes', () => {
  it('states that the maker library is not connected and separates confirmed from candidate', () => {
    assert.match(REFERENCE_NOTE, /not connected/i);
    assert.equal(read('lib/optimize.js').includes('fetch('), false);
    assert.equal(read('lib/references.js').includes('fetch('), false);
    assert.equal(read('lib/optimize.js').includes('@google/genai'), false);
    assert.equal(read('lib/optimize.js').includes('brandinfo'), false);
    const confirmed = referenceFromFields({ maker: 'Lucchese', model: '1883', status: 'confirmed', provenance: 'Insole stamp read by the seller' });
    const candidate = referenceFromFields({ maker: 'Lucchese', model: '1883', status: 'candidate', provenance: 'Guessed from a catalog photo' });
    const absent = referenceFromFields({ maker: 'Lucchese', model: 'ZZTOP', status: 'confirmed', provenance: 'A different pair' });
    const otherMaker = referenceFromFields({ maker: 'Tony Lama', model: '1883', status: 'confirmed', provenance: 'Wrong maker' });
    assert.throws(() => referenceFromFields({ maker: 'Lucchese', model: '1883', status: 'confirmed', provenance: '  ' }), /where this note came from/i);
    const parsed = parseReferenceTable('maker | model | status | provenance\nLucchese | 1883 | confirmed | Insole stamp\nTony Lama | 1 | candidate |\n');
    assert.equal(parsed.rows.length, 1);
    assert.equal(parsed.rows[0].model, '1883');
    assert.equal(parsed.errors.length, 1);

    const item = boot();
    const matched = matchReferences(item, [confirmed, candidate, absent, otherMaker]);
    assert.equal(matched.connected, false);
    assert.match(matched.note, /not connected/i);
    assert.equal(matched.matches.filter(m => m.use).length, 1);
    assert.equal(matched.matches.find(m => m.model === 'ZZTOP').use, false);
    assert.equal(matched.matches.find(m => m.status === 'candidate').use, false);
    assert.equal(matched.matches.some(m => m.maker === 'Tony Lama' && m.use), false);

    const out = optimize(item, [confirmed, candidate, absent, otherMaker]);
    assert.equal(out.proposal.references_connected, false);
    assert.match(out.proposal.facts, /1883/);
    assert.match(out.proposal.facts, /Insole stamp read by the seller/);
    assert.equal(out.proposal.facts.includes('Guessed from a catalog photo'), false);
    assert.equal(out.proposal.facts.includes('ZZTOP'), false);
    assert.equal(out.proposal.facts.includes('Tony Lama'), false);
    assert.equal(out.proposal.description.includes('ZZTOP'), false);
    assert.equal(out.proposal.description.includes('Tony Lama'), false);
  });
});

describe('approved export mapping', () => {
  it('keeps the sell-a-pair columns and consumes applied copy only', () => {
    assert.deepEqual(Object.values(CSV), HEADERS);
    const item = boot();
    const proposed = { ...item, opt_proposal: { title: 'SHOULD NOT EXPORT', description: 'NOPE', images: [{ n: 1, file: 'nope.jpg', alt: 'nope' }] } };
    const draft = exportRecord(proposed, ctx);
    assert.equal(draft.title, item.title);
    assert.equal(draft.description, item.description);
    assert.equal(draft.width, 'A');
    assert.equal(draft.photos[0], photoUrl(ctx.origin, item, 1));
    assert.match(draft.photos[0], /aaa-width/);
    assert.match(draft.alts[0], /AAA width/);
    assert.equal(draft.website_url, '');
    assert.equal(draft.sized_for, "Men's");
    assert.equal(draft.category, 'Boots');
    assert.equal(draft.wbw_price, 380);

    const prepared = optimize(item, []);
    const applied = applyOptimization(item, prepared, { now: '2026-11-07T00:00:00.000Z' });
    assert.equal(applied.photos, undefined);
    assert.deepEqual(item.photos, boot().photos);
    const live = { ...item, ...applied };
    const row = exportRecord(live, ctx);
    assert.equal(row.title, applied.title);
    assert.match(row.title, /AAA/);
    assert.equal(row.title.includes(' A '), false);
    assert.equal(row.width, 'A');
    assert.equal(row.description, applied.description);
    assert.match(row.photos[0], new RegExp(`${applied.opt_applied.images[0].file}$`));
    assert.equal(row.alts[0], applied.opt_applied.images[0].alt);
    assert.equal(Object.values(CSV).includes('SEO description'), false);
    assert.equal(prepared.proposal.portable.seo_description_exported, false);
    assert.ok(prepared.proposal.portable.seo_description.length > 0);
    assert.ok(prepared.proposal.portable.seo_description.length <= 170);

    const narrow = exportRecord(boot({ width: 'N', title: 'Boots width N' }), ctx);
    assert.equal(narrow.width, 'N');
    assert.equal(displayWidth('N'), 'N');
    const formula = exportRecord(boot({ title: '=HYPERLINK("http://evil")', description: '- worn in' }), ctx);
    const csv = toCsv([boot({ title: '=HYPERLINK("http://evil")', description: '- worn in' })], ctx);
    assert.equal(csv.split('\r\n')[0], HEADERS.map(h => `"${h}"`).join(','));
    assert.match(csv, /"'=HYPERLINK/);
    assert.match(csv, /"- worn in"/);
    assert.equal(formula.title.startsWith('='), true);
    const edited = editProposal(prepared.proposal, { title: '<script>alert(1)</script>Lucchese size 9 AAA', description: '<img src=x onerror=alert(1)>Worn AAA' });
    assert.equal(edited.title.includes('<'), false);
    assert.equal(edited.description.includes('<'), false);
    assert.match(edited.title, /AAA/);
  });
});

describe('optimize api', () => {
  it('prepares one owned listing without applying it', async () => {
    const secret = 'signing-secret';
    const ENV = { NODE_ENV: 'production', ADMIN_PASSWORD: 'staff-secret', APP_PASSWORD: secret };
    const ada = await sessionToken('seller:ada', secret);
    const item = { id: 1, seller: 'ada', title: 'Original', description: 'Keep', photos: ['https://cdn.example/a.jpg'], width: 'AAA' };
    let applied = 0;
    const db = {
      async getByIds() { return [item]; },
      async proposeOptimization(seller, id) {
        assert.equal(seller, 'ada');
        assert.equal(id, 1);
        return { item: { ...item, opt_proposal: { title: 'Proposed AAA' } } };
      },
      async applyOptimization() { applied += 1; },
    };
    const res = await itemsResponse(new Request('http://localhost/api/items', {
      method: 'PATCH', headers: { 'x-auth': ada, 'content-type': 'application/json' },
      body: JSON.stringify({ ids: [1], action: 'optimize' }),
    }), db, ENV);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.item.title, 'Original');
    assert.equal(applied, 0);
    db.getByIds = async () => [{ id: 2, seller: 'bea' }];
    const denied = await itemsResponse(new Request('http://localhost/api/items', {
      method: 'PATCH', headers: { 'x-auth': ada, 'content-type': 'application/json' },
      body: JSON.stringify({ ids: [2], action: 'optimize' }),
    }), db, ENV);
    assert.equal(denied.status, 403);
  });
});

describe('apply review', () => {
  it('sends a seller back through approval and lets staff keep a live listing', () => {
    assert.equal(applyReturnsToReview('seller'), true);
    assert.equal(applyReturnsToReview('admin'), false);
    assert.match(read('lib/wbw.js'), /applyReturnsToReview\(role\)/);
  });
});

describe('private shell stays private', () => {
  it('keeps noindex and the bug button on the root layout', () => {
    assert.match(read('app/layout.js'), /<BugReporter \/>/);
    assert.match(read('app/layout.js'), /robots: \{ index: false, follow: false \}/);
    assert.match(read('next.config.mjs'), /noindex, nofollow/);
    assert.match(read('public/robots.txt'), /Disallow: \//);
    assert.match(read('app/screen.js'), /OptimizePanel/);
    assert.match(read('app/seller/page.js'), /<Screen \/>/);
    assert.match(read('app/login/page.js'), /BootLister/);
  });
});

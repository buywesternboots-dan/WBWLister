import test from 'node:test';
import assert from 'node:assert/strict';
import { exportRecord } from '../lib/export.js';
import { mergeLp } from '../lib/lp.js';
import { applyAutoOptimization, applyOptimization, autoOptimizeFields, optimize } from '../lib/optimize.js';
import { applyOptimizationToItem, createItem, useSql } from '../lib/wbw.js';

const photo = 'https://cdn.example/boot.jpg';
const item = {
  id: 7, source_id: 'sku-1', seller: 'ada', title: 'Lucchese cowboy boots', description: 'Size 9 AAA. Old heel.',
  brand: 'Lucchese', price: 120, size: '9', width: 'AAA', condition: 'Broken In', photos: [photo], boot: 'boot',
};

test('import optimization proposes copy and keeps the imported fields', () => {
  const fields = { title: item.title, description: item.description, price: 42, brand: item.brand, size: item.size, width: item.width, condition: item.condition, photos: item.photos };
  applyAutoOptimization(fields, item, { now: '2026-11-09T00:00:00.000Z' });
  assert.equal(fields.title, 'Lucchese cowboy boots');
  assert.equal(fields.description, 'Size 9 AAA. Old heel.');
  assert.equal(fields.price, 42);
  assert.equal(fields.width, 'AAA');
  assert.equal(typeof fields.opt_proposal.title, 'string');
  assert.notEqual(fields.opt_proposal.description, fields.description);
  assert.equal(fields.opt_applied.scope, 'images-seo');
  assert.equal(fields.opt_applied.images[0].stored_url, photo);
  assert.equal(fields.opt_applied.images[0].pixels, 'unchanged');
  assert.ok(fields.opt_applied.seo_title);
  assert.ok(fields.opt_applied.seo_description);
  assert.equal(fields.opt_error, null);
  const live = { ...item, ...fields, price: 42 };
  const row = exportRecord(live, { origin: 'http://local.test', seller: {} });
  assert.equal(row.title, item.title);
  assert.equal(row.description, item.description);
  assert.match(row.photos[0], new RegExp(`${fields.opt_applied.images[0].file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`));
  assert.equal(row.alts[0], fields.opt_applied.images[0].alt);
  assert.equal(row.seo_title, fields.opt_applied.seo_title);
  assert.equal(row.seo_description, fields.opt_applied.seo_description);
  const manual = applyOptimization(live, { original: fields.opt_original, proposal: fields.opt_proposal }, { now: '2026-11-09T00:00:00.000Z' });
  assert.equal(manual.title, fields.opt_proposal.title);
  assert.notEqual(manual.title, item.title);
});

test('the same source hash does not rewrite and a changed source regenerates', () => {
  const base = { hash: 'h1', photos: [photo], markets: '', raw: { title: 'Boots', description: 'old heel', brand: 'Lucchese' }, item: { ...item, title: 'Boots', description: 'old heel' } };
  const created = mergeLp({}, base);
  assert.equal(created.description, 'old heel');
  assert.ok(created.opt_proposal);
  const changed = mergeLp({ src_hash: 'h1', opt_original: created.opt_original, verified: [] }, { ...base, hash: 'h2', raw: { ...base.raw, description: 'Heel < 1.5 now' }, item: { ...base.item, description: 'Heel < 1.5 now' } });
  assert.equal(changed.description, 'Heel < 1.5 now');
  assert.match(changed.opt_proposal.seller_notes, /1\.5/);
  assert.equal(changed.opt_proposal.seller_notes.includes('old heel'), false);
  const same = mergeLp({ src_hash: 'h2', opt_original: changed.opt_original, opt_proposal: { facts_fp: 'keep' }, verified: [] }, { ...base, hash: 'h2' });
  assert.equal(same.opt_proposal, undefined);
});

function memorySql(rows, refsFor) {
  const sql = (strings, ...vals) => {
    const text = strings.join(' ');
    if (text.includes('insert into items')) {
      const id = rows.size + 1;
      const row = { id, seller: vals[0], boot: vals[1], source: vals[2], source_id: vals[3], status: 'review' };
      rows.set(id, row);
      return Promise.resolve([{ id }]);
    }
    if (text.includes('source_id')) {
      const [seller, source, sourceId] = vals;
      return Promise.resolve([...rows.values()].filter(r => r.seller === seller && r.source === source && r.source_id === sourceId));
    }
    if (text.includes('from boot_references where seller')) return Promise.resolve(refsFor());
    if (text.includes('where id')) {
      const row = rows.get(Number(vals[0]));
      return Promise.resolve(row && row.seller === vals[1] ? [row] : []);
    }
    return Promise.resolve([]);
  };
  sql.query = async (q, vals) => {
    if (!String(q).includes('update items set')) return [];
    const row = rows.get(Number(vals[0]));
    if (!row) return [];
    for (const m of String(q).matchAll(/(\w+) = \$(\d+)(?:::jsonb)?/g)) {
      let v = vals[Number(m[2]) - 1];
      if (m[0].includes('::jsonb') && typeof v === 'string') v = JSON.parse(v);
      row[m[1]] = v;
    }
    return [row];
  };
  return sql;
}

test('a source change that fails optimization clears the proposal and Apply refuses', async () => {
  const bad = {};
  Object.defineProperty(bad, 'maker', { get() { throw new Error('match failed'); } });
  const rows = new Map();
  let fail = false;
  useSql(memorySql(rows, () => (fail ? [bad] : [])));
  const photo = 'https://cdn.blob.vercel-storage.com/boot.jpg';
  const base = { title: 'Lucchese cowboy boots', description: 'Size 9 AAA. Old heel.', price: 80, brand: 'Lucchese', photos: [photo], source: 'facebook', source_id: 'fb-1' };
  const created = await createItem('ada', base);
  assert.equal(typeof created.opt_proposal, 'object');
  assert.equal(created.title, base.title);
  fail = true;
  const changed = await createItem('ada', { ...base, description: 'Heel < 1.5 now.' });
  assert.equal(changed.updated, true);
  assert.equal(changed.opt_proposal, null);
  assert.equal(changed.opt_applied, null);
  assert.match(changed.opt_error, /match failed/);
  assert.match(changed.description, /1\.5/);
  await assert.rejects(() => applyOptimizationToItem('ada', created.id, { title: 'Stale', description: 'Stale copy' }, 'admin'), /Prepare an optimization/);
  assert.match(rows.get(created.id).description, /1\.5/);
  assert.equal(rows.get(created.id).title, base.title);

  const lpPhoto = 'https://cdn.example/boot.jpg';
  const lp = { hash: 'h1', photos: [lpPhoto], markets: '', raw: { title: 'Lucchese cowboy boots', description: 'old heel', brand: 'Lucchese' }, item: { title: 'Lucchese cowboy boots', description: 'old heel', brand: 'Lucchese', price: 80, guessed: [], boot: 'boot', boot_score: 1 } };
  const inserted = mergeLp({}, lp);
  assert.equal(typeof inserted.opt_proposal.title, 'string');
  const refreshed = mergeLp({ src_hash: 'h1', title: 'Lucchese cowboy boots', description: 'old heel', opt_original: inserted.opt_original, opt_proposal: { title: 'STALE TITLE', description: 'STALE' }, opt_applied: { title: 'STALE APPLIED', facts_fp: 'x' }, verified: [] }, {
    ...lp, hash: 'h2', refs: [bad], raw: { ...lp.raw, description: 'Heel < 1.5 now' }, item: { ...lp.item, description: 'Heel < 1.5 now' },
  });
  assert.equal(refreshed.description, 'Heel < 1.5 now');
  assert.equal(refreshed.title, 'Lucchese cowboy boots');
  assert.equal(refreshed.opt_proposal, null);
  assert.equal(refreshed.opt_applied, null);
  assert.match(refreshed.opt_error, /match failed/);
  const lpRows = new Map([[1, { id: 1, seller: 'ada', status: 'review', title: refreshed.title, description: refreshed.description, opt_proposal: null, opt_applied: null }]]);
  useSql(memorySql(lpRows, () => []));
  await assert.rejects(() => applyOptimizationToItem('ada', 1, { title: 'STALE TITLE', description: 'STALE' }, 'seller'), /Prepare an optimization/);
  assert.equal(lpRows.get(1).title, 'Lucchese cowboy boots');
  assert.equal(lpRows.get(1).description, 'Heel < 1.5 now');
});

test('a failed optimization does not change the import', () => {
  const boom = { title: 'Lucchese cowboy boots', description: 'western boots', price: 10 };
  Object.defineProperty(boom, 'photos', { get() { throw new Error('photo names failed'); } });
  const out = autoOptimizeFields(boom, []);
  assert.equal(out.ok, false);
  const fields = { title: 'Lucchese cowboy boots', description: 'western boots', price: 10, photos: [photo] };
  applyAutoOptimization(fields, { title: fields.title, description: fields.description, photos: [photo] }, { refs: { not: 'a list' } });
  assert.equal(fields.title, 'Lucchese cowboy boots');
  assert.equal(fields.price, 10);
  assert.equal(fields.opt_proposal, undefined);
  assert.match(fields.opt_error, /./);
  const prepared = optimize(item, []);
  assert.equal(prepared.proposal.images[0].pixels, 'unchanged');
});

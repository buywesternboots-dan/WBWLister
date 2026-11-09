// Real PostgreSQL 16 smoke test. Not part of `npm test` (that glob is test/*.test.mjs).
// Run: npm run test:pg
// Expects a local cluster and a superuser socket login for the current OS user:
//   sudo -u postgres createuser -s "$USER"
//   pg_ctl start with Debian's config_file if the service manager will not start it.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, describe, it } from 'node:test';
import pg from 'pg';
import { exportRecord } from '../../lib/export.js';
import { pgSql } from '../../lib/pg-sql.js';
import { acceptStyleCandidate, addReference, applyOptimizationToItem, claimImportWrite, createItem, proposeOptimization, saveSeller, useSql } from '../../lib/wbw.js';

const socket = process.env.PGHOST || '/var/run/postgresql';
const photo = 'https://abc.public.blob.vercel-storage.com/photos/a.jpg';
const base = {
  title: 'Lucchese cowboy boots', description: 'Size 9 AAA. Old heel.', price: 120, brand: 'Lucchese',
  photos: [photo], source: 'facebook', source_id: 'listing-a',
};

describe('postgres smoke', () => {
  let admin, pool;

  after(async () => { await pool?.end(); await admin?.end(); });

  it('migrates an old schema, stores jsonb objects, and refreshes a changed source', async () => {
    admin = new pg.Client({ host: socket, database: 'postgres' });
    await admin.connect();
    await admin.query('DROP DATABASE IF EXISTS bootlister_smoke');
    await admin.query('CREATE DATABASE bootlister_smoke');
    pool = new pg.Pool({ host: socket, database: 'bootlister_smoke', max: 2 });
    const raw = pgSql(pool);
    await raw.query(`create table items (
      id serial primary key, seller text not null, status text not null default 'review', boot text not null,
      source text, source_id text, title text, price numeric, description text, size text, condition text, brand text,
      photos text[] not null default '{}', created_at timestamptz default now(), unique (seller, source, source_id))`);
    await raw.query(`create table boot_references (
      id serial primary key, seller text not null, maker text not null, model text not null default '',
      status text not null, provenance text not null, notes text not null default '', created_at timestamptz default now())`);
    await raw.query(`insert into boot_references (seller, maker, model, status, provenance) values
      ('ada', 'Lucchese', '1883', 'candidate', 'first note'),
      ('ada', 'lucchese', '1883', 'confirmed', 'later duplicate')`);

    useSql(raw);
    const created = await createItem('ada', base);
    assert.ok(created?.id);
    const cols = await raw.query(`select column_name from information_schema.columns where table_name = 'items' and column_name like 'opt_%' order by 1`);
    assert.deepEqual(cols.map(r => r.column_name), ['opt_applied', 'opt_original', 'opt_proposal']);
    const kept = await raw.query(`select id, provenance from boot_references order by id`);
    assert.deepEqual(kept, [{ id: 1, provenance: 'first note' }]);
    const index = await raw.query(`select indexdef from pg_indexes where indexname = 'boot_references_maker_model'`);
    assert.match(index[0].indexdef, /UNIQUE/);

    const stored = await raw.query(`select jsonb_typeof(opt_original) as kind, opt_original->>'description' as description from items where id = $1`, [created.id]);
    assert.equal(stored[0].kind, 'object');
    assert.match(stored[0].description, /Old heel/);

    await saveSeller({ name: 'ada', display_name: 'Ada' });
    const proposal = await proposeOptimization('ada', created.id);
    assert.match(proposal.proposal.description, /Old heel|AAA/);
    await raw.query(`update items set status = 'published', approved_at = now(), approved_by = 'ada@shop.test', changed_at = '2020-01-01T00:00:00Z' where id = $1`, [created.id]);
    const applied = await applyOptimizationToItem('ada', created.id, { title: proposal.proposal.title, description: proposal.proposal.description }, 'admin');
    assert.equal(applied.item.status, 'review');
    assert.equal(applied.item.approved_at, null);
    assert.equal(new Date(applied.item.changed_at).toISOString().slice(0, 10), '2020-01-01');
    assert.equal(typeof applied.item.opt_applied, 'object');
    const exported = exportRecord(applied.item, { origin: 'http://smoke.local', seller: { display_name: 'Ada' } });
    assert.equal(exported.title, applied.item.title);
    if (applied.item.width === 'AAA' || applied.item.width === 'AA' || applied.item.width === 'AAAA') assert.equal(exported.width, 'A');
    assert.equal(exported.alts[0], applied.item.opt_applied.images[0].alt);
    assert.ok(exported.photos[0].endsWith('/' + applied.item.opt_applied.images[0].file));
    const verifiedBrand = { ...applied.item, brand: 'Tony Lama', guessed: (applied.item.guessed ?? []).filter(f => f !== 'brand'), verified: [...new Set([...(applied.item.verified ?? []), 'brand'])] };
    const staleFacts = exportRecord(verifiedBrand, { origin: 'http://smoke.local', seller: { display_name: 'Ada' } });
    assert.equal(staleFacts.photos[0].includes(applied.item.opt_applied.images[0].file), false);
    assert.match(staleFacts.alts[0], /Tony Lama/);

    const described = await createItem('ada', { ...base, description: 'Size 9 AAA. Heel < 1.5 now.' });
    assert.equal(described.updated, true);
    const afterDesc = await raw.query(`select jsonb_typeof(opt_original) as kind, opt_original->>'description' as description, opt_original->'first'->>'description' as first, opt_proposal, opt_applied from items where id = $1`, [created.id]);
    assert.equal(afterDesc[0].kind, 'object');
    assert.match(afterDesc[0].description, /1\.5/);
    assert.match(afterDesc[0].first, /Old heel/);
    assert.equal(afterDesc[0].opt_proposal, null);
    assert.equal(afterDesc[0].opt_applied, null);

    const branded = await createItem('ada', { ...base, description: 'Size 9 AAA. Heel < 1.5 now.', brand: 'Tony Lama' });
    assert.equal(branded.updated, true);
    const afterBrand = await raw.query(`select opt_original->>'brand' as brand, opt_original->'first'->>'description' as first from items where id = $1`, [created.id]);
    assert.equal(afterBrand[0].brand, 'Tony Lama');
    assert.match(afterBrand[0].first, /Old heel/);
    assert.equal(await createItem('ada', { ...base, description: 'Size 9 AAA. Heel < 1.5 now.', brand: 'Tony Lama' }), null);

    const lp = `Title,SKU,Price,Description,Brand,Main Image
Lucchese cowboy boots,sku-9,80,LP old heel,Lucchese,${photo}
`;
    const { importLp } = await import('../../lib/wbw.js');
    const firstLp = await importLp('ada', lp);
    assert.equal(firstLp.new, 1);
    const lpRow = await raw.query(`select id, jsonb_typeof(opt_original) as kind, opt_original->>'description' as description from items where source = 'listperfectly'`);
    assert.equal(lpRow[0].kind, 'object');
    assert.match(lpRow[0].description, /LP old heel/);
    const secondLp = await importLp('ada', lp.replace('LP old heel', 'LP heel < 2 in'));
    assert.equal(secondLp.updated, 1);
    const lpAfter = await raw.query(`select jsonb_typeof(opt_original) as kind, opt_original->>'description' as description, opt_original->'first'->>'description' as first, opt_proposal from items where id = $1`, [lpRow[0].id]);
    assert.equal(lpAfter[0].kind, 'object');
    assert.match(lpAfter[0].description, /< 2/);
    assert.match(lpAfter[0].first, /LP old heel/);
    assert.equal(lpAfter[0].opt_proposal, null);

    await addReference('ada', { maker: 'Hyer', model: 'H1', status: 'candidate', provenance: 'Insole stamp' });
    await assert.rejects(() => addReference('ada', { maker: 'Hyer', model: 'H1', status: 'confirmed', provenance: 'Again' }), /already saved/);
    const notes = await raw.query(`select count(*)::int as n from boot_references where seller = 'ada' and lower(model) = 'h1'`);
    assert.equal(notes[0].n, 1);

    const styled = await createItem('ada', { title: 'Dan Post boots', description: 'Style: 0030\nWorn some.', price: 80, brand: 'Dan Post', photos: [photo], source: 'facebook', source_id: 'dp-0030' });
    await raw.query(`update items set verified = array['brand','id_text'], id_text = '0030' where id = $1`, [styled.id]);
    const prepared = await proposeOptimization('ada', styled.id);
    assert.equal(prepared.proposal.style_sample.matches[0].style_number, '0030');
    assert.equal(prepared.proposal.description.includes('Cow'), false);
    const keptRef = await acceptStyleCandidate('ada', styled.id, prepared.proposal.style_sample.matches[0].record_url);
    const refRow = await raw.query(`select jsonb_typeof(style_ref) as kind, style_ref->>'style_number' as style, description, title from items where id = $1`, [styled.id]);
    assert.equal(refRow[0].kind, 'object');
    assert.equal(refRow[0].style, '0030');
    assert.equal(refRow[0].description, keptRef.item.description);
    assert.match(refRow[0].description, /Style: 0030/);
    const cleared = await createItem('ada', { title: 'Dan Post boots', description: 'Worn some.', price: 80, brand: 'Dan Post', photos: [photo], source: 'facebook', source_id: 'dp-0030' });
    assert.equal(cleared.updated, true);
    const gone = await raw.query(`select style_ref from items where id = $1`, [styled.id]);
    assert.equal(gone[0].style_ref, null);

    const job = crypto.randomUUID();
    assert.equal(await claimImportWrite('ada', job, 2), 1);
    assert.equal(await claimImportWrite('ada', job, 2), 2);
    await assert.rejects(() => claimImportWrite('ada', job, 2), /2 listing writes/);
    const wide = crypto.randomUUID();
    assert.equal(await claimImportWrite('ada', wide, 100), 1);
    assert.equal(await claimImportWrite('ada', wide, 100), 2);
    assert.equal(await claimImportWrite('ada', wide, 100), 3);
    const writes = await raw.query(`select n from import_writes where seller = 'ada' and job = $1`, [job]);
    assert.equal(writes[0].n, 2);

    const nft = JSON.parse(readFileSync(new URL('../../.next/server/app/api/items/route.js.nft.json', import.meta.url), 'utf8'));
    assert.ok(nft.files.some(f => f.endsWith('data/wbw-reference/makers.csv')));
    assert.ok(nft.files.some(f => f.endsWith('data/wbw-reference/models_sample.normalized.json')));
  });
});

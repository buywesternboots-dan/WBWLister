import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { rescanLink, rescanSource } from '../lib/rescan.js';
import { cronAllowed, deltaCounts, deltaCsv, fromPrimary, syncDelta, syncState } from '../lib/sync.js';

const base = { seller: 'ada', source: 'depop', title: 'Lucchese boots 10D', description: 'Nice', brand: 'Lucchese', size: '10', width: 'D', sized_for: 'Men',
  condition: 'Broken In', price: 300, wbw_price: 300, photos: ['https://cdn.example/1.jpg'], approved_at: '2026-11-16T06:00:00Z', id_text: 'L1' };
const item = (id, over = {}) => ({ ...base, id, source_id: `s${id}`, status: 'published', ...over });
const applied = it => ({ ...it, wbw_state: syncState(it) });

test('delta: new, price, details, mark sold, held, unchanged, back for sale', () => {
  const rows = [
    item(1),                                                     // never applied → new
    { ...applied(item(2)), wbw_price: 250 },                     // price drop
    { ...applied(item(3)), description: 'Resoled' },             // details
    { ...applied(item(4)), status: 'pending' },                  // gone from source
    { ...applied(item(5)), status: 'review', changed_at: 'x' },  // changed, waiting for approval
    applied(item(6)),                                            // unchanged → no row
    { ...applied({ ...item(7), status: 'sold' }), status: 'published' }, // relisted
    item(8, { status: 'review', approved_at: null }),            // not approved yet, never on WBW → no row
  ];
  const d = syncDelta(rows);
  assert.deepEqual(d.map(r => [r.id, r.action]), [[1, 'new'], [2, 'price'], [3, 'update'], [4, 'mark-sold'], [5, 'held'], [7, 'new']]);
  assert.deepEqual(d[2].changed, ['description']);
  assert.equal(d[1].from_price, 300);
  assert.equal(d[1].to_price, 250);
  assert.deepEqual(deltaCounts(d), { new: 2, price: 1, update: 1, 'mark-sold': 1, held: 1 });
  const csv = deltaCsv(d, { seller: { shipping_policy: 'CONUS' } }).split('\r\n');
  assert.equal(csv.length, 6); // header + 5 (held is not exported)
  assert.match(csv[0], /^"Action","Changed","Old price","Photos"/);
  assert.match(csv[2], /^"price","price","300"/);
  assert.match(csv[4], /^"mark-sold","gone from source"/);
  // A sold row that was already marked sold on WBW is not repeated.
  const sold = applied({ ...item(9), status: 'sold' });
  assert.equal(syncDelta([sold]).length, 0);
});

test('primary source filters the delta', () => {
  assert.equal(fromPrimary({ source: 'texasbootco.com' }, 'website'), true);
  assert.equal(fromPrimary({ source: 'depop' }, 'website'), false);
  assert.equal(fromPrimary({ source: 'listperfectly' }, 'csv'), true);
  assert.equal(syncDelta([item(1), item(2, { source: 'facebook' })], { primary: 'facebook' }).map(r => r.id).join(), '2');
});

test('re-scan: website runs server-side; partial runs never mark sold; eBay, Depop, Facebook, CSV are refused', async () => {
  const calls = [];
  const db = { createItem: async (s, it) => (calls.push(it.source_id), it.source_id === 'b' ? { updated: true } : it.source_id === 'c' ? null : { id: 1 }),
    syncSource: async (s, source, ids) => (calls.push(`sync:${source}:${ids.join('|')}`), 1), stampScan: async () => calls.push('stamp') };
  const list = async () => ({ urls: ['https://shop.test/products/a', 'https://shop.test/products/b', 'https://shop.test/products/c', 'https://shop.test/products/d'] });
  const read = async url => url.endsWith('/d') ? null : { source: 'shop.test', source_id: url.split('/').pop(), title: 'x' };
  const r = await rescanSource('ada', { website: 'https://shop.test', primary_source: 'website' }, db, { list, read });
  assert.deepEqual([r.added, r.updated, r.unchanged, r.sold, r.removed, r.partial], [1, 1, 1, 1, 1, false]);
  assert.ok(calls.includes('sync:shop.test:a|b|c'));
  assert.ok(calls.includes('stamp'));
  let t = 0;
  const slow = await rescanSource('ada', { website: 'https://shop.test' }, { ...db, syncSource: async () => { throw new Error('must not run'); } }, { list, read, budgetMs: 1, now: () => (t += 1) });
  assert.equal(slow.partial, true);
  assert.equal(slow.removed, 0);
  for (const [s, re] of [[{ primary_source: 'ebay', website: 'https://ebay.com/usr/x' }, /eBay/], [{ website: 'https://www.ebay.com/usr/x' }, /eBay/],
    [{ primary_source: 'depop' }, /extension/], [{ primary_source: 'facebook' }, /extension/], [{ primary_source: 'csv' }, /CSV/], [{}, /no website/]])
    assert.throws(() => rescanLink(s), re);
});

test('scheduled sync is off: flag + secret required, no cron in vercel.json, gate still needs a session', () => {
  const req = auth => ({ headers: new Headers(auth ? { authorization: auth } : {}) });
  assert.equal(cronAllowed(req('Bearer s'), {}).ok, false);
  assert.equal(cronAllowed(req('Bearer s'), { SYNC_CRON_ENABLED: '1' }).ok, false);
  assert.equal(cronAllowed(req('Bearer nope'), { SYNC_CRON_ENABLED: '1', CRON_SECRET: 's' }).ok, false);
  assert.equal(cronAllowed(req('Bearer s'), { SYNC_CRON_ENABLED: '1', CRON_SECRET: 's' }).ok, true);
  const vj = new URL('../vercel.json', import.meta.url);
  assert.equal(existsSync(vj) && /crons/.test(readFileSync(vj, 'utf8')), false);
  assert.equal(readFileSync(new URL('../lib/gate.js', import.meta.url), 'utf8').includes('/api/cron'), false);
});

test('sync API is admin only', () => {
  const src = readFileSync(new URL('../app/api/sync/route.js', import.meta.url), 'utf8');
  assert.match(src, /who\.role !== 'admin'/);
});

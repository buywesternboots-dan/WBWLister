import test from 'node:test';
import assert from 'node:assert/strict';
import { GATE_VERSION } from '../extension/boot-gate.mjs';
import { REJECT_WRITE_CAP } from '../lib/known.js';
import { knownImports, saveRejects, useSql } from '../lib/wbw.js';

function memoryDb() {
  const log = [];
  const sellers = [{ name: 'ada' }, { name: 'bob' }];
  const items = [
    { seller: 'ada', source: 'depop', source_id: 'boot-a', source_url: 'https://www.depop.com/products/boot-a' },
    { seller: 'bob', source: 'depop', source_id: 'boot-b', source_url: 'https://www.depop.com/products/boot-b' },
  ];
  const rejects = [
    { seller: 'ada', source: 'depop', source_id: 'ada-bag', source_url: 'https://www.depop.com/products/ada-bag', reason: 'non-footwear', gate_version: GATE_VERSION },
    { seller: 'ada', source: 'depop', source_id: 'stale-bag', source_url: 'https://www.depop.com/products/stale-bag', reason: 'non-footwear', gate_version: GATE_VERSION - 1 },
    { seller: 'bob', source: 'depop', source_id: 'bob-bag', source_url: 'https://www.depop.com/products/bob-bag', reason: 'other-footwear', gate_version: GATE_VERSION },
  ];
  const answer = (text, vals) => {
    if (/insert into import_rejects/i.test(text)) {
      const [seller, source, source_id, source_url, reason, gate_version] = vals;
      const row = { seller, source, source_id, source_url, reason, gate_version };
      const at = rejects.findIndex(r => r.seller === seller && r.source === source && r.source_id === source_id);
      if (at >= 0) rejects[at] = row;
      else rejects.push(row);
      return [];
    }
    if (/from import_rejects/i.test(text)) {
      const [seller, source, gate, ids, urls] = vals;
      return rejects.filter(r => r.seller === seller && r.source === source && r.gate_version === gate
        && ((ids || []).includes(r.source_id) || (urls || []).includes(r.source_url)));
    }
    if (/from items/i.test(text) && /seller =/i.test(text)) {
      const [seller, source, ids, urls] = vals;
      return items.filter(r => r.seller === seller && r.source === source
        && ((ids || []).includes(r.source_id) || (urls || []).includes(r.source_url)));
    }
    if (/from sellers where name/i.test(text)) return sellers.filter(s => s.name === vals[0]);
    if (/from sellers/i.test(text)) return sellers;
    return [];
  };
  const sql = (strings, ...vals) => {
    const text = Array.isArray(strings) ? strings.join(' ') : String(strings);
    log.push({ text, vals });
    return Promise.resolve(answer(text, vals));
  };
  sql.query = async (text, vals) => {
    log.push({ text: String(text), vals });
    return answer(String(text), vals || []);
  };
  return { sql, log, items, rejects };
}

const touchesItems = text => /\b(insert into|update|delete from)\s+items\b/i.test(text);

test('saveRejects and knownImports stay on import_rejects and filter by seller and gate version', async () => {
  const db = memoryDb();
  useSql(db.sql);
  const extra = Array.from({ length: REJECT_WRITE_CAP + 1 }, (_, i) => ({ source_id: `bag-${i}`, source_url: `https://www.depop.com/products/bag-${i}`, reason: 'non-footwear' }));
  extra.push({ source_id: 'maybe', reason: 'uncertain' });
  const before = db.log.length;
  const saved = await saveRejects('ada', 'depop', extra);
  const rejectWrites = db.log.slice(before).filter(q => /insert into import_rejects/i.test(q.text));
  assert.equal(saved.saved, REJECT_WRITE_CAP);
  assert.equal(rejectWrites.length, REJECT_WRITE_CAP);
  assert.equal(rejectWrites.some(q => touchesItems(q.text)), false);
  assert.equal(db.log.some(q => /insert into items|delete from items/i.test(q.text)), false);
  assert.equal(db.items.some(r => String(r.source_id).startsWith('bag-')), false);
  assert.equal(rejectWrites.every(q => q.vals[0] === 'ada' && q.vals[1] === 'depop' && q.vals.at(-1) === GATE_VERSION), true);
  assert.equal(db.rejects.some(r => r.source_id === 'maybe'), false);

  const seen = await knownImports('ada', 'depop', [
    { id: 'boot-a', url: 'https://www.depop.com/products/boot-a' },
    { id: 'boot-b', url: 'https://www.depop.com/products/boot-b' },
    { id: 'ada-bag', url: 'https://www.depop.com/products/ada-bag' },
    { id: 'stale-bag', url: 'https://www.depop.com/products/stale-bag' },
    { id: 'bob-bag', url: 'https://www.depop.com/products/bob-bag' },
    { id: 'bag-0', url: 'https://www.depop.com/products/bag-0' },
  ]);
  assert.deepEqual(seen.known.map(r => r.source_id), ['boot-a']);
  assert.deepEqual(seen.rejected.map(r => r.source_id).sort(), ['ada-bag', 'bag-0']);
  const rejectSql = db.log.filter(q => /from import_rejects/i.test(q.text));
  assert.ok(rejectSql.length >= 1);
  for (const q of rejectSql) {
    assert.match(q.text, /seller =/);
    assert.match(q.text, /gate_version =/);
    assert.equal(q.vals[0], 'ada');
    assert.equal(q.vals[2], GATE_VERSION);
  }
  const itemSql = db.log.filter(q => /from items/i.test(q.text) && /seller =/i.test(q.text));
  assert.equal(itemSql.some(q => /\b(insert into|update|delete from)\s+items\b/i.test(q.text)), false);
});

test('init creates import_rejects with if not exists on every fresh boot', async () => {
  const db = memoryDb();
  useSql(db.sql);
  await knownImports('ada', 'depop', []);
  useSql(db.sql);
  await knownImports('ada', 'depop', []);
  const creates = db.log.filter(q => /create table if not exists import_rejects/i.test(q.text));
  assert.equal(creates.length, 2);
  assert.equal(creates.every(q => /if not exists/i.test(q.text)), true);
});

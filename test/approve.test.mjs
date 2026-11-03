import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { itemsResponse } from '../lib/items-api.js';
import { sessionToken } from '../lib/session.js';
import { approvePlan } from '../lib/wbw.js';

const ENV = { NODE_ENV: 'production', ADMIN_PASSWORD: 'staff-secret', APP_PASSWORD: 'signing-secret' };
const ready = { id: 1, seller: 'ada', price: 100, title: 'Boot', brand: 'Ariat', sized_for: 'Men', condition: 'New', status: 'review' };

function db(seed) {
  const rows = seed.map(r => ({ ...r }));
  const calls = [];
  return {
    rows, calls,
    async getByIds(ids) {
      const want = new Set(ids.map(String));
      return rows.filter(r => want.has(String(r.id))).map(r => ({ ...r }));
    },
    async approveItems(seller, ids, fields, role) {
      calls.push({ seller, ids, role });
      const mine = rows.filter(r => r.seller === seller && ids.map(String).includes(String(r.id)));
      const stamp = approvePlan(role, { email: 'Ada@Shop.TEST' }, mine, ids, fields);
      for (const row of mine) Object.assign(row, stamp);
      return { approved: ids.length };
    },
  };
}

const patch = (token, bearer, body) => new Request('http://localhost/api/items', {
  method: 'PATCH',
  headers: { 'content-type': 'application/json', ...(token ? { 'x-auth': token } : {}), ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) },
  body: JSON.stringify(body),
});

test('staff can approve the seller they are viewing; a seller cannot approve someone else', async () => {
  const admin = await sessionToken('admin', ENV.APP_PASSWORD);
  const ada = await sessionToken('seller:ada', ENV.APP_PASSWORD);
  const items = db([ready, { ...ready, id: 2, seller: 'bea', title: 'Bea boot' }]);

  const staff = await itemsResponse(patch(admin, 'ada', { ids: [1], action: 'approve' }), items, ENV);
  assert.equal(staff.status, 200);
  assert.equal(items.calls[0].seller, 'ada');
  assert.equal(items.calls[0].role, 'admin');
  assert.equal(items.rows[0].approved_by, 'staff');
  assert.equal(items.rows[0].status, 'published');
  assert.equal(items.rows[1].approved_by, undefined);

  const other = await itemsResponse(patch(ada, 'bea', { ids: [2], action: 'approve' }), items, ENV);
  assert.equal(other.status, 403);
  const ownIds = await itemsResponse(patch(ada, 'ada', { ids: [2], action: 'approve' }), items, ENV);
  assert.equal(ownIds.status, 403);
  assert.equal(items.calls.length, 1);
  assert.equal(items.rows[1].status, 'review');

  const own = await itemsResponse(patch(ada, 'ada', { ids: [1], action: 'approve' }), db([ready]), ENV);
  assert.equal(own.status, 200);
  assert.equal((await own.json()).approved, 1);

  const loggedOut = await itemsResponse(patch('', '', { ids: [1], action: 'approve' }), db([ready]), ENV);
  assert.equal(loggedOut.status, 401);

  const screen = readFileSync(new URL('../app/screen.js', import.meta.url), 'utf8');
  assert.match(screen, /Approve for seller/);
  assert.match(screen, /Approve selected/);
});

test('missing required fields still block staff and the seller', async () => {
  const bare = { id: 3, seller: 'ada', title: 'Boot', status: 'review' };
  const admin = await sessionToken('admin', ENV.APP_PASSWORD);
  const blocked = await itemsResponse(patch(admin, 'ada', { ids: [3], action: 'approve' }), db([bare]), ENV);
  assert.equal(blocked.status, 400);
  assert.match((await blocked.json()).error, /Still missing: price, brand, sized_for, condition/);
  assert.throws(() => approvePlan('admin', {}, [bare], [3], {}), /Still missing: price, brand, sized_for, condition/);
  assert.throws(() => approvePlan('seller', { email: 'ada@shop.test' }, [bare], [3], { price: '10' }), /Still missing: brand, sized_for, condition/);
  const stamp = approvePlan('admin', {}, [{ ...ready }], [1], {});
  assert.equal(stamp.approved_by, 'staff');
  assert.equal(stamp.status, 'published');
  const seller = approvePlan('seller', { email: 'Ada@Shop.TEST' }, [{ ...ready }], [1], {});
  assert.equal(seller.approved_by, 'ada@shop.test');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { matchSeller, registerSeller } from '../lib/auth';
import { CLOSED } from '../lib/gate';
import { itemsResponse } from '../lib/items-api';
import { loginResponse, registerResponse } from '../lib/login-api';

const ENV = { NODE_ENV: 'production', ADMIN_PASSWORD: 'staff-secret', APP_PASSWORD: 'signing-secret' };

function accounts() {
  const records = [];
  return {
    records,
    async register(input) {
      const { row, claim } = await registerSeller(records, input);
      if (claim) Object.assign(records.find(r => r.name === row.name), row);
      else records.push(row);
      return { name: row.name, display_name: row.display_name, email: row.email, phone: row.phone };
    },
    async authenticate(id, password) { return matchSeller(records, id, password); },
  };
}

const post = (url, body, headers = {}) => new Request(url, {
  method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body),
});

function memory(items) {
  const rows = items.map(i => ({ ...i }));
  const want = ids => new Set(ids.map(String));
  return {
    rows,
    async getItems(seller, status) { return rows.filter(i => i.seller === seller && i.status === status).map(i => ({ ...i })); },
    async getSourceIds(seller, source) { return rows.filter(i => i.seller === seller && i.source === source).map(i => i.source_id); },
    async createItem(seller, raw) {
      const row = { id: Math.max(0, ...rows.map(r => r.id)) + 1, status: 'review', ...raw, seller };
      rows.push(row);
      return row;
    },
    async getByIds(ids) { const ids_ = want(ids); return rows.filter(r => ids_.has(String(r.id))).map(r => ({ ...r })); },
    async updateItems(seller, ids, fields) {
      const ids_ = want(ids);
      for (const r of rows) if (r.seller === seller && ids_.has(String(r.id))) Object.assign(r, fields);
    },
    async deleteItems(seller, ids) {
      const ids_ = want(ids);
      for (const r of rows) if (r.seller === seller && ids_.has(String(r.id))) r.deleted = true;
      return ids.length;
    },
    async moveItems() { throw new Error('move should not run for a seller'); },
    async lowerPrice() { return; },
    async approveItems() { return { approved: 0 }; },
    async setStatus() { return {}; },
    async syncSource(seller, source, ids) { return { seller, source, n: ids.length }; },
  };
}

const authed = (url, token, bearer, method = 'GET', body) => new Request(url, {
  method,
  headers: { 'content-type': 'application/json', 'x-auth': token, ...(bearer ? { authorization: `Bearer ${bearer}` } : {}), 'x-session-seller': 'bea' },
  body: body && JSON.stringify(body),
});

test('admin login, seller register and login by email and by phone, and a wrong password', async () => {
  const db = accounts();
  const emailReg = await registerResponse(post('http://localhost/api/register', {
    display_name: 'Ada Boots', email: 'Ada@Shop.TEST', password: 'ada-secret',
  }), db, ENV);
  assert.equal(emailReg.status, 200);
  const emailBody = await emailReg.json();
  assert.equal(emailBody.role, 'seller');
  assert.equal(emailBody.seller, 'ada-boots');
  assert.equal(JSON.stringify(emailBody).includes('ada-secret'), false);
  assert.equal(JSON.stringify(emailBody).includes(db.records[0].hash), false);
  assert.match(db.records[0].hash, /^scrypt\$/);

  const emailLogin = await loginResponse(post('http://localhost/api/login', { email: 'ada@shop.test', password: 'ada-secret' }), db, ENV);
  assert.equal(emailLogin.status, 200);
  assert.equal((await emailLogin.json()).role, 'seller');
  const emailWrong = await loginResponse(post('http://localhost/api/login', { email: 'ada@shop.test', password: 'wrong-password' }), db, ENV);
  assert.equal(emailWrong.status, 401);
  const emailWrongBody = await emailWrong.json();
  assert.equal(emailWrongBody.error.includes('wrong-password'), false);

  const phoneReg = await registerResponse(post('http://localhost/api/register', {
    display_name: 'Bea Boots', phone: '(555) 222-3333', password: 'bea-secret',
  }), db, ENV);
  assert.equal(phoneReg.status, 200);
  assert.equal((await phoneReg.json()).seller, 'bea-boots');
  for (const id of ['5552223333', '+1 555 222 3333', '(555) 222-3333']) {
    const res = await loginResponse(post('http://localhost/api/login', { email: id, password: 'bea-secret' }), db, ENV);
    assert.equal(res.status, 200, id);
    assert.equal((await res.json()).seller, 'bea-boots');
  }
  const phoneWrong = await loginResponse(post('http://localhost/api/login', { phone: '5552223333', password: 'ada-secret' }), db, ENV);
  assert.equal(phoneWrong.status, 401);

  const admin = await loginResponse(post('http://localhost/api/login', { email: 'admin', password: 'staff-secret' }), db, ENV);
  assert.equal(admin.status, 200);
  const adminBody = await admin.json();
  assert.equal(adminBody.role, 'admin');
  assert.equal(adminBody.seller, null);
  const adminWrong = await loginResponse(post('http://localhost/api/login', { email: 'admin', password: 'ada-secret' }), db, ENV);
  assert.equal(adminWrong.status, 401);
  // The staff password does not sign a seller in, and a seller password is not staff.
  const notStaff = await loginResponse(post('http://localhost/api/login', { email: 'ada@shop.test', password: 'staff-secret' }), db, ENV);
  assert.equal(notStaff.status, 401);

  const onlyApp = { NODE_ENV: 'production', APP_PASSWORD: 'app-only-secret' };
  const appAdmin = await loginResponse(post('http://localhost/api/login', { email: 'admin', password: 'app-only-secret' }), accounts(), onlyApp);
  assert.equal((await appAdmin.json()).role, 'admin');
  const closed = await loginResponse(post('http://localhost/api/login', { email: 'admin', password: 'staff-secret' }), db, { NODE_ENV: 'production' });
  assert.equal(closed.status, 503);
  assert.equal((await closed.json()).error, CLOSED);
  const closedReg = await registerResponse(post('http://localhost/api/register', { display_name: 'X', email: 'x@y.co', password: 'long-enough' }), db, { VERCEL_ENV: 'preview' });
  assert.equal(closedReg.status, 503);
});

test('seller A cannot read or modify seller B through the items API', async () => {
  const dbAccounts = accounts();
  const regA = await (await registerResponse(post('http://localhost/api/register', { display_name: 'Ada Boots', email: 'ada@shop.test', password: 'ada-secret' }), dbAccounts, ENV)).json();
  const regB = await (await registerResponse(post('http://localhost/api/register', { display_name: 'Bea Boots', phone: '5553334444', password: 'bea-secret' }), dbAccounts, ENV)).json();
  const tokenA = (await (await loginResponse(post('http://localhost/api/login', { email: 'ada@shop.test', password: 'ada-secret' }), dbAccounts, ENV)).json()).token;
  const tokenB = (await (await loginResponse(post('http://localhost/api/login', { email: '5553334444', password: 'bea-secret' }), dbAccounts, ENV)).json()).token;
  const adminToken = (await (await loginResponse(post('http://localhost/api/login', { email: 'admin', password: 'staff-secret' }), dbAccounts, ENV)).json()).token;
  const items = memory([
    { id: 1, seller: regA.seller, status: 'review', title: 'Ada boot' },
    { id: 2, seller: regB.seller, status: 'review', title: 'Bea boot' },
  ]);

  const read = await itemsResponse(authed('http://localhost/api/items?status=review', tokenA), items, ENV);
  assert.equal(read.status, 200);
  const readBody = await read.json();
  assert.deepEqual(readBody.map(i => i.seller), [regA.seller]);
  assert.equal(readBody.some(i => i.title === 'Bea boot'), false);

  const named = await itemsResponse(authed('http://localhost/api/items?status=review', tokenA, regB.seller), items, ENV);
  assert.equal(named.status, 403);
  assert.match((await named.json()).error, /own items/);

  const cookieRead = await itemsResponse(new Request('http://localhost/api/items?status=review', {
    headers: { cookie: `auth=${tokenA}`, 'x-session-seller': regB.seller },
  }), items, ENV);
  assert.deepEqual((await cookieRead.json()).map(i => i.id), [1]);

  const edit = await itemsResponse(authed('http://localhost/api/items', tokenA, regB.seller, 'PATCH', { ids: [2], action: 'edit', title: 'stolen' }), items, ENV);
  assert.equal(edit.status, 403);
  assert.equal(items.rows[1].title, 'Bea boot');

  const both = await itemsResponse(authed('http://localhost/api/items', tokenA, '', 'PATCH', { ids: [1, 2], action: 'edit', title: 'both' }), items, ENV);
  assert.equal(both.status, 403);
  assert.equal(items.rows[0].title, 'Ada boot');
  assert.equal(items.rows[1].title, 'Bea boot');

  const own = await itemsResponse(authed('http://localhost/api/items', tokenA, regA.seller, 'PATCH', { ids: [1], action: 'edit', title: 'Ada edited' }), items, ENV);
  assert.equal(own.status, 200);
  assert.equal(items.rows[0].title, 'Ada edited');
  assert.equal(items.rows[1].title, 'Bea boot');

  const blockedCreate = await itemsResponse(authed('http://localhost/api/items', tokenA, regB.seller, 'POST', { title: 'Stolen', seller: regB.seller }), items, ENV);
  assert.equal(blockedCreate.status, 403);
  const created = await itemsResponse(authed('http://localhost/api/items', tokenA, '', 'POST', { title: 'New', seller: regB.seller }), items, ENV);
  assert.equal(created.status, 200);
  assert.equal((await created.json()).item.seller, regA.seller);

  const remove = await itemsResponse(authed('http://localhost/api/items', tokenA, regA.seller, 'PATCH', { ids: [1], action: 'delete' }), items, ENV);
  assert.equal(remove.status, 403);
  assert.equal(items.rows[0].deleted, undefined);

  const beaRead = await itemsResponse(authed('http://localhost/api/items?status=review', tokenB), items, ENV);
  assert.deepEqual((await beaRead.json()).map(i => i.seller), [regB.seller]);

  const adminRead = await itemsResponse(authed('http://localhost/api/items?status=review', adminToken, regB.seller), items, ENV);
  assert.deepEqual((await adminRead.json()).map(i => i.title), ['Bea boot']);
  const adminEdit = await itemsResponse(authed('http://localhost/api/items', adminToken, regA.seller, 'PATCH', { ids: [2], action: 'edit', title: 'nope' }), items, ENV);
  assert.equal(adminEdit.status, 403);
  assert.equal(items.rows[1].title, 'Bea boot');

  const forged = `bootlister.${Buffer.from(JSON.stringify({ w: 'seller:' + regB.seller, e: Date.now() + 864e5, v: 0 })).toString('base64url')}.${tokenA.split('.')[2]}`;
  const forgedRead = await itemsResponse(new Request('http://localhost/api/items?status=review', { headers: { cookie: `auth=${forged}` } }), items, ENV);
  assert.equal(forgedRead.status, 401);

  const anon = await itemsResponse(new Request('http://localhost/api/items?status=review'), items, ENV);
  assert.equal(anon.status, 401);
  const shut = await itemsResponse(authed('http://localhost/api/items?status=review', tokenA, regB.seller), items, { NODE_ENV: 'production' });
  assert.equal(shut.status, 503);
  assert.equal((await shut.json()).error, CLOSED);

  const dev = await itemsResponse(new Request('http://localhost/api/items?status=review', { headers: { authorization: `Bearer ${regA.seller}` } }), items, { NODE_ENV: 'development' });
  assert.equal(dev.status, 200);
  const devBody = await dev.json();
  assert.equal(devBody.every(i => i.seller === regA.seller), true);
  assert.equal(devBody.some(i => i.title === 'Bea boot'), false);
});

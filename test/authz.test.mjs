import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { sellersApi } from '../app/api/sellers/route.js';
import { decide } from '../lib/gate.js';
import { itemsResponse } from '../lib/items-api.js';
import { sessionToken } from '../lib/session.js';

const ENV = { NODE_ENV: 'production', ADMIN_PASSWORD: 'staff-secret', APP_PASSWORD: 'signing-secret' };
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

const routeFiles = () => {
  const root = fileURLToPath(new URL('../app/api', import.meta.url));
  const files = [];
  const walk = dir => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (name === 'route.js') files.push(p);
    }
  };
  walk(root);
  return files;
};

test('logged out, every API route returns 401 and / redirects to /login', async () => {
  const prev = { NODE_ENV: process.env.NODE_ENV, ADMIN_PASSWORD: process.env.ADMIN_PASSWORD, APP_PASSWORD: process.env.APP_PASSWORD };
  Object.assign(process.env, ENV);
  try {
    const files = routeFiles();
    assert.ok(files.length >= 10);
    for (const file of files) {
      const rel = file.replace(/\\/g, '/');
      const path = '/' + rel.slice(rel.indexOf('app/')).replace(/^app\//, '').replace(/\/route\.js$/, '');
      const signIn = path === '/api/login' || path === '/api/register';
      const decision = await decide(path, '', ENV);
      if (signIn) assert.equal(decision.type, 'next', path);
      else assert.deepEqual(decision, { type: 'json', status: 401, error: 'Please log in.' }, path);
      if (path === '/api/register' || path === '/api/public-intake') continue;
      const mod = await import(pathToFileURL(file).href);
      for (const method of METHODS) {
        if (typeof mod[method] !== 'function') continue;
        const res = await mod[method](new Request(`http://localhost${path}`, {
          method, headers: { 'content-type': 'application/json' }, body: method === 'GET' ? undefined : '{}',
        }));
        assert.equal(res.status, 401, `${method} ${path}`);
      }
    }
    assert.deepEqual(await decide('/', '', ENV), { type: 'redirect', to: '/login' });
    const matcher = readFileSync(new URL('../proxy.js', import.meta.url), 'utf8');
    for (const skipped of ['api/me', 'api/sellers', 'api/items', 'api/import', 'api/posted', 'api/brand', 'api/backfill', 'api/idcheck'])
      assert.equal(matcher.includes(skipped), false, skipped);
    assert.equal(readFileSync(new URL('../app/page.js', import.meta.url), 'utf8').includes("redirect('/login')"), true);
    assert.equal(readFileSync(new URL('../lib/access.js', import.meta.url), 'utf8').includes("'team'"), false);
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});

test('a seller cannot read another seller or the seller list; an admin can', async () => {
  const secret = ENV.APP_PASSWORD;
  const rows = [{ seller: 'ada', name: 'ada' }, { seller: 'bea', name: 'bea' }];
  const db = {
    async getSellers(only) { return rows.filter(s => !only || s.seller === only); },
    async saveSeller() { return { saved: true }; },
    async deleteSeller() { return { deleted: true }; },
  };
  const ada = await sessionToken('seller:ada', secret);
  const admin = await sessionToken('admin', secret);
  const req = (method, token) => new Request('http://localhost/api/sellers', {
    method, headers: { 'x-auth': token, 'content-type': 'application/json' }, body: method === 'GET' ? undefined : '{}',
  });
  await assert.rejects(() => sellersApi(new Request('http://localhost/api/sellers'), db, ENV), /log in/);
  assert.deepEqual((await sellersApi(req('GET', ada), db, ENV)).map(s => s.seller), ['ada']);
  await assert.rejects(() => sellersApi(req('POST', ada), db, ENV), /admin/);
  await assert.rejects(() => sellersApi(req('DELETE', ada), db, ENV), /admin/);
  assert.deepEqual((await sellersApi(req('GET', admin), db, ENV)).map(s => s.seller), ['ada', 'bea']);
  assert.deepEqual(await sellersApi(req('POST', admin), db, ENV), { saved: true });

  const items = {
    rows: [{ id: 1, seller: 'ada', status: 'review', title: 'Ada boot' }, { id: 2, seller: 'bea', status: 'review', title: 'Bea boot' }],
    async getItems(seller, status) { return this.rows.filter(i => i.seller === seller && i.status === status); },
    async getSourceIds() { return []; },
    async getByIds() { return []; },
  };
  const own = await itemsResponse(new Request('http://localhost/api/items?status=review', { headers: { 'x-auth': ada } }), items, ENV);
  assert.deepEqual((await own.json()).map(i => i.seller), ['ada']);
  const all = await itemsResponse(new Request('http://localhost/api/items?status=review', { headers: { 'x-auth': admin, authorization: 'Bearer bea' } }), items, ENV);
  assert.deepEqual((await all.json()).map(i => i.title), ['Bea boot']);
});

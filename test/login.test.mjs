import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isAdminId, isEmail, loginId, matchAdmin, matchSeller, normEmail, normPhone, registerSeller, sessionWho } from '../lib/auth';
import { sellerFor } from '../lib/access';
import { CLOSED, decide, siteMode } from '../lib/gate';
import { ADMIN_ACTIONS, guardAction } from '../lib/http';
import { homeFor, redirectFor } from '../lib/home';
import { hashPassword, verifyPassword } from '../lib/passwords';
import { readSession, sessionToken } from '../lib/session';

const SECRET = 'test-signing-secret';
const read = p => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const headers = h => ({ headers: new Headers(h) });

test('email and phone are normalized; admin is not a seller id', () => {
  assert.equal(normEmail('  Ada@Shop.TEST '), 'ada@shop.test');
  assert.equal(isEmail('ada@shop.test'), true);
  assert.equal(isEmail('ada'), false);
  assert.equal(normPhone('(555) 123-4567'), '+15551234567');
  assert.equal(normPhone('5551234567'), '+15551234567');
  assert.equal(normPhone('+1 555 123 4567'), '+15551234567');
  assert.equal(normPhone('123'), '');
  assert.deepEqual(loginId('Ada@Shop.test'), { kind: 'email', value: 'ada@shop.test' });
  assert.deepEqual(loginId('555-123-4567'), { kind: 'phone', value: '+15551234567' });
  assert.equal(loginId('admin'), null);
  assert.equal(isAdminId(' Admin '), true);
});

test('a seller password is stored as scrypt, never as the password', async () => {
  const a = await hashPassword('correct-horse'), b = await hashPassword('correct-horse');
  assert.equal(a.hash.includes('correct-horse'), false);
  assert.match(a.hash, /^scrypt\$16384\$8\$1\$/);
  assert.notEqual(a.salt, b.salt);
  assert.equal(await verifyPassword('correct-horse', a.salt, a.hash), true);
  assert.equal(await verifyPassword('wrong-horse', a.salt, a.hash), false);
  assert.equal(await verifyPassword('correct-horse', a.salt, 'sha256$abc'), false);
});

test('staff sign in with the admin password; a seller password is not a staff login', async () => {
  const env = { NODE_ENV: 'production', ADMIN_PASSWORD: 'staff-secret', APP_PASSWORD: SECRET };
  assert.deepEqual(await matchAdmin('admin', 'staff-secret', env), { role: 'admin' });
  assert.deepEqual(await matchAdmin(' Admin ', 'staff-secret', env), { role: 'admin' });
  assert.equal(await matchAdmin('admin', 'nope', env), null);
  assert.equal(await matchAdmin('ada@shop.test', 'staff-secret', env), null);
  assert.equal(await matchAdmin('admin', 'staff-secret', { NODE_ENV: 'production' }), null);
  assert.deepEqual(await matchAdmin('admin', 'only-app', { NODE_ENV: 'production', APP_PASSWORD: 'only-app' }), { role: 'admin' });
});

test('register and sign in by email or by phone; a wrong password does not', async () => {
  const records = [];
  const add = async input => {
    const { row, claim } = await registerSeller(records, input);
    if (claim) Object.assign(records.find(r => r.name === row.name), row);
    else records.push(row);
    return row;
  };
  const ada = await add({ display_name: "Ada's Boots", email: 'Ada@Shop.TEST', password: 'ada-secret' });
  const bea = await add({ display_name: 'Bea Boots', phone: '(555) 222-3333', password: 'bea-secret' });
  assert.equal(ada.name, 'adas-boots');
  assert.equal(ada.hash.includes('ada-secret'), false);
  assert.match(ada.hash, /^scrypt\$/);
  assert.equal(bea.phone, '+15552223333');
  assert.deepEqual(await matchSeller(records, 'ada@shop.test', 'ada-secret'), { role: 'seller', seller: 'adas-boots', version: 0 });
  assert.deepEqual(await matchSeller(records, '5552223333', 'bea-secret'), { role: 'seller', seller: 'bea-boots', version: 0 });
  assert.deepEqual(await matchSeller(records, '+1 555 222 3333', 'bea-secret'), { role: 'seller', seller: 'bea-boots', version: 0 });
  assert.equal(await matchSeller(records, 'ada@shop.test', 'wrong-password'), null);
  assert.equal(await matchSeller(records, '5552223333', 'ada-secret'), null);
  assert.equal(await matchSeller(records, 'other@shop.test', 'bea-secret'), null);
  await assert.rejects(() => add({ display_name: 'Other', email: 'ada@shop.test', password: 'another-secret' }), /already on a seller/);
  await assert.rejects(() => add({ display_name: 'Nope', password: 'long-enough' }), /email or a phone/);
  await assert.rejects(() => add({ display_name: 'Nope', email: 'a@b.co', password: 'short' }), /at least 8/);
});

test('registering does not claim a seller that has no password yet', async () => {
  const records = [{ name: 'ada', email: 'ada@shop.test', phone: null, hash: 'old-sha', salt: 's', display_name: 'Ada' }];
  await assert.rejects(() => registerSeller(records, { display_name: 'Ada Boots', email: 'ADA@shop.test', password: 'new-secret' }), /already on a seller/);
  assert.equal(records[0].hash, 'old-sha');
  assert.equal(records[0].name, 'ada');
  const phone = [{ name: 'bea', email: null, phone: '+15552223333', hash: '', salt: '', display_name: 'Bea' }];
  await assert.rejects(() => registerSeller(phone, { display_name: 'Bea', phone: '5552223333', password: 'bea-secret' }), /already on a seller/);
  assert.equal(phone[0].hash, '');
});

test('the session token carries the seller name and rejects a forged name or secret', async () => {
  assert.equal(sessionWho({ role: 'seller', seller: 'ada' }), 'seller:ada');
  assert.equal(sessionWho({ role: 'admin' }), 'admin');
  const token = await sessionToken('seller:ada', SECRET);
  assert.equal(token.startsWith('bootlister.'), true);
  assert.deepEqual(await readSession(token, SECRET), { role: 'seller', seller: 'ada', version: 0 });
  assert.equal(await readSession(token, 'other-secret'), null);
  const forged = `bootlister.${btoa(JSON.stringify({ w: 'seller:bob', e: Date.now() + 1000, v: 0 }))}.${token.split('.')[2]}`;
  assert.equal(await readSession(forged, SECRET), null);
  assert.deepEqual(await readSession(await sessionToken('admin', SECRET), SECRET), { role: 'admin', version: 0 });
  assert.equal(await readSession('%%%', SECRET), null);
  assert.equal(await readSession('bootlister.@@@.nope', SECRET), null);
});

test('a seller session stays on that seller; a different Bearer name is rejected', () => {
  const seller = { role: 'seller', seller: 'ada' }, admin = { role: 'admin' };
  assert.throws(() => sellerFor(seller, headers({ authorization: 'Bearer bob', 'x-session-seller': 'bob' })), /own items/);
  assert.equal(sellerFor(seller, headers({ 'x-session-seller': 'bob' })), 'ada');
  assert.throws(() => sellerFor(seller, headers({ authorization: 'Bearer bea' })), /own items/);
  assert.equal(sellerFor(seller, headers({})), 'ada');
  assert.equal(sellerFor(admin, headers({ authorization: 'Bearer Bob' })), 'bob');
  assert.throws(() => sellerFor(admin, headers({})), /Pick a seller first/);
});

test('a seller session cannot run admin actions; their own edit and sync can', () => {
  const seller = { role: 'seller', seller: 'ada' }, admin = { role: 'admin' };
  for (const action of ['delete', 'move', 'sellers', 'idcheck', 'backfill']) {
    assert.equal(ADMIN_ACTIONS.includes(action), true);
    assert.throws(() => guardAction(seller, action), /Only an admin can do that/);
    assert.equal(guardAction(admin, action), undefined);
  }
  for (const action of ['edit', 'sync', 'publish', 'remove', 'price']) assert.equal(guardAction(seller, action), undefined);
});

test('sign-in sends each role to its own screen, and the server keeps them there', () => {
  assert.equal(homeFor('admin'), '/');
  assert.equal(homeFor('seller'), '/seller');
  assert.equal(redirectFor('seller', '/'), '/seller');
  assert.equal(redirectFor('seller', '/seller'), null);
  assert.equal(redirectFor('admin', '/seller'), '/');
  assert.equal(redirectFor('admin', '/'), null);
  assert.equal(redirectFor('seller', '/api/items'), null);
  assert.match(read('app/page.js'), /<Screen admin \/>/);
  assert.match(read('app/seller/page.js'), /<Screen \/>/);
  assert.equal(read('app/seller/page.js').includes('<Screen admin'), false);
  assert.match(read('app/login/page.js'), /homeFor\(j\.role\)/);
  assert.match(read('app/login/page.js'), /api\/register/);
  assert.match(read('app/login/page.js'), /BootLister/);
  assert.match(read('app/layout.js'), /title: 'BootLister'/);
  assert.match(read('extension/manifest.json'), /"name": "BootLister"/);
  assert.equal(read('app/login/page.js').includes('WBW Lister'), false);
  assert.equal(read('app/layout.js').includes('WBW Inventory'), false);
  assert.equal(read('package.json').includes('wbwlister'), false);
  assert.match(read('lib/gate.js'), /redirectFor/);
  assert.match(read('proxy.js'), /decision\.type === 'redirect'/);
  assert.match(read('app/screen.js'), /admin && <button onClick=\{\(\) => \{ const to = prompt\('Move the selected items/);
  assert.match(read('app/screen.js'), /admin && <button onClick=\{\(\) => confirm\(`Delete/);
  assert.equal(read('app/screen.js').includes('login_password'), false);
});

test('deployed with no admin password is closed; local dev with none stays open', () => {
  assert.equal(siteMode({ NODE_ENV: 'production' }), 'closed');
  assert.equal(siteMode({ NODE_ENV: 'production', VERCEL_ENV: 'production' }), 'closed');
  assert.equal(siteMode({ VERCEL_ENV: 'preview' }), 'closed');
  assert.equal(siteMode({ NODE_ENV: 'development' }), 'dev-open');
  assert.equal(siteMode({}), 'dev-open');
  assert.equal(siteMode({ NODE_ENV: 'production', ADMIN_PASSWORD: 'x' }), 'on');
  assert.equal(siteMode({ NODE_ENV: 'production', APP_PASSWORD: 'x' }), 'on');
  assert.equal(siteMode({ NODE_ENV: 'production', ADMIN_PASSWORD: '   ' }), 'closed');
  assert.match(read('proxy.js'), /decide\(/);
  assert.match(read('proxy.js'), /api\/register/);
  assert.equal(read('proxy.js').includes('if (!secret) return NextResponse.next'), false);
  assert.equal(read('lib/wbw.js').includes('TEAM_PIN'), false);
  assert.equal(read('lib/wbw.js').includes('ensureTeamLogin'), false);
  assert.match(read('lib/publish.js'), /pushStub/);
});

test('every /api route checks the signed session or the site gate', () => {
  const dir = fileURLToPath(new URL('../app/api', import.meta.url));
  const files = [];
  const walk = d => { for (const name of readdirSync(d)) { const p = join(d, name); if (statSync(p).isDirectory()) walk(p); else if (name === 'route.js') files.push(p); } };
  walk(dir);
  assert.ok(files.length >= 10);
  for (const f of files) assert.match(readFileSync(f, 'utf8'), /actorFrom|sellerContext|itemsResponse|loginResponse|registerResponse/, f);
});

test('the proxy fails closed in production without an admin password and stays open in local dev', async () => {
  const closedApi = await decide('/api/items', '', { NODE_ENV: 'production' });
  const closedPage = await decide('/', '', { VERCEL_ENV: 'preview' });
  assert.equal(closedApi.status, 503);
  assert.equal(closedApi.error, CLOSED);
  assert.equal(closedPage.type, 'closed');
  assert.deepEqual(await decide('/', '', { NODE_ENV: 'development' }), { type: 'next' });
  const locked = { NODE_ENV: 'production', ADMIN_PASSWORD: 'staff-secret' };
  assert.deepEqual(await decide('/api/items', '', locked), { type: 'json', status: 401, error: 'Please log in.' });
  assert.deepEqual(await decide('/', '', locked), { type: 'redirect', to: '/login' });
  const seller = await sessionToken('seller:ada', 'staff-secret');
  assert.equal((await decide('/', seller, locked)).to, '/seller');
  assert.equal((await decide('/api/items', seller, locked)).who.seller, 'ada');
  const proxy = read('proxy.js');
  assert.match(proxy, /decide\(/);
  assert.match(proxy, /status: 503/);
  assert.match(proxy, /decision\.type === 'closed'/);
});

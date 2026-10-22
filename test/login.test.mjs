import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isEmail, matchLogin, newPinRecord, normEmail, pinHash, sessionWho } from '../lib/auth';
import { readSession, sessionToken } from '../lib/session';
import { sellerOf, teamOnly } from '../lib/http';
import { HOME, TOOLS, toolsFor } from '../lib/home';

const SECRET = 'test-signing-secret';
const rec = async (email, pin, extra) => ({ email, ...await newPinRecord(pin), ...extra });
const headers = h => ({ headers: new Headers(h) });

test('email is trimmed and lowercased; anything else is not an email', () => {
  assert.equal(normEmail('  Ada@Shop.TEST '), 'ada@shop.test');
  assert.equal(isEmail('ada@shop.test'), true);
  assert.equal(isEmail('ada'), false);
  assert.equal(isEmail(''), false);
  assert.equal(isEmail('ada @shop.test'), false);
});

test('PIN is stored as a salted hash, never as the PIN itself', async () => {
  const a = await newPinRecord('1234'), b = await newPinRecord('1234');
  assert.notEqual(a.hash, '1234');
  assert.equal(a.hash, await pinHash(a.salt, '1234'));
  assert.notEqual(a.salt, b.salt);
  assert.equal(await pinHash(a.salt, ' 1234 '), a.hash);
});

test('admin and seller sign in with email + PIN; a wrong PIN, unknown email, or seller name does not', async () => {
  const admin = await rec('admin@shop.test', '1', { role: 'admin' });
  const seller = await rec('Ada@Shop.test', '4321', { role: 'seller', seller: 'ada' });
  assert.deepEqual(await matchLogin('admin@shop.test', '1', [admin, seller]), { role: 'admin' });
  assert.deepEqual(await matchLogin('ada@shop.test', '4321', [admin, seller]), { role: 'seller', seller: 'ada' });
  assert.equal(await matchLogin('ada@shop.test', 'nope', [admin, seller]), null);
  assert.equal(await matchLogin('other@shop.test', '4321', [admin, seller]), null);
  assert.equal(await matchLogin('ada', '4321', [admin, seller]), null);
  assert.equal(await matchLogin('  ', '4321', [admin, seller]), null);
  assert.equal(await matchLogin('ada@shop.test', '   ', [admin, seller]), null);
});

test('two sellers sharing an email and PIN cannot sign in; the one PIN that matches still can', async () => {
  const ada = await rec('a@b.co', '1111', { role: 'seller', seller: 'ada' });
  const bea = await rec('a@b.co', '2222', { role: 'seller', seller: 'bea' });
  const same = await rec('a@b.co', '1111', { role: 'seller', seller: 'bea' });
  assert.equal(await matchLogin('a@b.co', '1111', [ada, same]), null);
  assert.deepEqual(await matchLogin('a@b.co', '2222', [ada, bea]), { role: 'seller', seller: 'bea' });
});

test('a matching admin login wins when a seller uses the same email and PIN', async () => {
  const admin = await rec('a@b.co', '1111', { role: 'admin' });
  const seller = await rec('a@b.co', '1111', { role: 'seller', seller: 'ada' });
  const other = await rec('a@b.co', '2222', { role: 'seller', seller: 'ada' });
  assert.deepEqual(await matchLogin('A@B.co', '1111', [seller, admin]), { role: 'admin' });
  assert.deepEqual(await matchLogin('a@b.co', '2222', [admin, other]), { role: 'seller', seller: 'ada' });
});

test('the session token carries the seller name and rejects a forged name or secret', async () => {
  const who = await matchLogin('ada@shop.test', '1234', [await rec('ada@shop.test', '1234', { role: 'seller', seller: 'ada' })]);
  assert.equal(sessionWho(who), 'seller:ada');
  assert.equal(sessionWho({ role: 'admin' }), 'admin');
  assert.equal((await readSession(await sessionToken('admin', SECRET), SECRET)).seller, undefined);
  const token = await sessionToken(sessionWho(who), SECRET);
  assert.deepEqual(await readSession(token, SECRET), { role: 'seller', seller: 'ada' });
  assert.equal(await readSession(token, 'other-secret'), null);
  const forged = `${encodeURIComponent('seller:bob')}.${token.split('.')[1]}`;
  assert.equal(await readSession(forged, SECRET), null);
  assert.deepEqual(await readSession(await sessionToken('admin', SECRET), SECRET), { role: 'admin' });
});

test('a seller session stays on that seller; admin actions reject it', () => {
  assert.equal(sellerOf(headers({ 'x-session-seller': 'ada', authorization: 'Bearer bob' })), 'ada');
  assert.throws(() => sellerOf(headers({})), /Pick a seller first/);
  assert.throws(() => teamOnly(headers({ 'x-session-seller': 'ada' })), /Only an admin can do that/);
  assert.equal(teamOnly(headers({})), undefined);
  assert.equal(sellerOf(headers({ authorization: 'Bearer Bob' })), 'bob');
});

test('an admin and a seller share one screen; the admin gets every tool', () => {
  assert.equal(HOME, '/');
  assert.deepEqual(toolsFor('admin'), TOOLS);
  assert.deepEqual(TOOLS, ['sellers', 'import', 'review', 'export', 'sync', 'settings']);
  assert.deepEqual(toolsFor('seller'), ['import', 'review', 'export', 'sync']);
  assert.deepEqual(toolsFor('team'), []);
  const page = readFileSync(new URL('../app/page.js', import.meta.url), 'utf8');
  const login = readFileSync(new URL('../app/login/page.js', import.meta.url), 'utf8');
  assert.match(page, /toolsFor\(me\?\.role\)/);
  assert.match(login, /location\.assign\(HOME\)/);
  assert.equal(page.includes("location.assign('/admin')"), false);
  assert.equal(login.includes("location.assign('/admin')"), false);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { applyPassword, claimWithInvite, newInvite, registerSeller } from '../lib/auth.js';
import { actorFrom } from '../lib/access.js';
import { csvCell } from '../lib/csv.js';
import { decide } from '../lib/gate.js';
import { loginResponse } from '../lib/login-api.js';
import { bump, MAX_ATTEMPTS, underLimit } from '../lib/login-limit.js';
import { allowedPhotoUrl, imageType, isPrivateAddress, safeFetch } from '../lib/net.js';
import { readSession, sessionToken, sha256 } from '../lib/session.js';

const SECRET = 'test-signing-secret';
const ENV = { NODE_ENV: 'production', ADMIN_PASSWORD: 'staff-secret', APP_PASSWORD: SECRET };
const read = p => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const day = 24 * 60 * 60 * 1000;

test('an invite is one-time and hashed, and a password bumps the session version', async () => {
  const inv = newInvite();
  assert.equal(inv.code.includes(inv.hash), false);
  assert.match(inv.hash, /^[0-9a-f]{64}$/);
  const records = [{ name: 'ada', email: 'ada@shop.test', hash: '', salt: '', session_v: 0, invite_hash: inv.hash, invite_expires: inv.expires }];
  const row = await claimWithInvite(records, inv.code, 'new-secret');
  assert.equal(row.name, 'ada');
  assert.match(row.hash, /^scrypt\$/);
  assert.equal(row.session_v, 1);
  assert.equal(row.invite_hash, null);
  await assert.rejects(() => claimWithInvite(records, inv.code, 'new-secret'), /not valid/);
  const expired = newInvite(Date.now() - 8 * day);
  const old = [{ name: 'bea', invite_hash: expired.hash, invite_expires: expired.expires, session_v: 2 }];
  await assert.rejects(() => claimWithInvite(old, expired.code, 'long-enough'), /expired/);
  assert.equal(old[0].invite_hash, expired.hash);
  const bumped = applyPassword({ session_v: 3, invite_hash: 'abc' }, { salt: 's', hash: 'scrypt$x' });
  assert.equal(bumped.session_v, 4);
  assert.equal(bumped.invite_hash, null);
  await assert.rejects(() => registerSeller([{ name: 'ada', email: 'ada@shop.test', phone: null }], { display_name: 'Ada', email: 'ada@shop.test', password: 'long-enough' }), /already on a seller/);
});

test('sessions expire, keep one old cookie readable, and a bad cookie is not a session', async () => {
  const token = await sessionToken('seller:ada', SECRET, { version: 2 });
  assert.equal((await readSession(token, SECRET)).version, 2);
  const stale = await sessionToken('seller:ada', SECRET, { now: Date.now() - 31 * day });
  assert.equal(await readSession(stale, SECRET), null);
  const who = 'seller:ada';
  const legacy = `${encodeURIComponent(who)}.${await sha256(`wbwlister:${SECRET}:${who}`)}`;
  const old = await readSession(legacy, SECRET);
  assert.equal(old.seller, 'ada');
  assert.equal(old.version, 0);
  assert.equal(old.legacy, true);
  assert.equal(await readSession('not a cookie', SECRET), null);
  assert.equal(await readSession('bootlister.%%% .nope', SECRET), null);
  assert.equal(await readSession('', SECRET), null);
  const locked = { NODE_ENV: 'production', ADMIN_PASSWORD: 'staff-secret' };
  assert.deepEqual(await decide('/api/items', '%%%', locked), { type: 'json', status: 401, error: 'Please log in.' });
  const fresh = await sessionToken('seller:ada', SECRET, { version: 0 });
  const headers = token => ({ headers: new Headers({ 'x-auth': token }) });
  await assert.rejects(() => actorFrom(headers(fresh), { ...ENV, sessionVersions: { ada: 1 } }), /log in/);
  assert.equal((await actorFrom(headers(fresh), { ...ENV, sessionVersions: { ada: 0 } })).seller, 'ada');
  assert.match(read('proxy.js'), /status: 401/);
  assert.match(read('lib/session.js'), /bootlister:/);
});

test('login attempts are limited per IP and per account', async () => {
  const rows = new Map();
  const attempts = {
    async read(ip, account) { return [`ip:${ip}`, `acct:${account}`].map(k => rows.get(k)).filter(Boolean); },
    async fail(ip, account) { for (const k of [`ip:${ip}`, `acct:${account}`]) rows.set(k, bump(rows.get(k))); },
  };
  const db = { attempts, async authenticate() { return null; } };
  const post = (ip, email) => new Request('http://localhost/api/login', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify({ email, password: 'wrong-password' }),
  });
  for (let i = 0; i < MAX_ATTEMPTS; i++) assert.equal((await loginResponse(post('1.2.3.4', 'ada@shop.test'), db, ENV)).status, 401);
  assert.equal((await loginResponse(post('1.2.3.4', 'ada@shop.test'), db, ENV)).status, 429);
  assert.equal((await loginResponse(post('1.2.3.4', 'bea@shop.test'), db, ENV)).status, 429);
  assert.equal((await loginResponse(post('5.6.7.8', 'ada@shop.test'), db, ENV)).status, 429);
  assert.equal((await loginResponse(post('9.9.9.9', 'cy@shop.test'), db, ENV)).status, 401);
  assert.equal(underLimit([{ n: MAX_ATTEMPTS, start: Date.now() }]), false);
  assert.equal(underLimit([{ n: MAX_ATTEMPTS - 1, start: Date.now() }]), true);
});

test('photo hosts are checked by hostname, and private addresses are not fetched', async () => {
  assert.equal(allowedPhotoUrl('https://evil.example/?x=blob.vercel-storage.com'), false);
  assert.equal(allowedPhotoUrl('https://blob.vercel-storage.com.evil.example/a.jpg'), false);
  assert.equal(allowedPhotoUrl('https://abc.public.blob.vercel-storage.com/a.jpg'), true);
  assert.equal(allowedPhotoUrl('https://cdn.example/a.jpg', { R2_PUBLIC_BASE: 'https://cdn.example' }), true);
  assert.equal(allowedPhotoUrl('https://cdn.example.evil/a.jpg', { R2_PUBLIC_BASE: 'https://cdn.example' }), false);
  for (const ip of ['127.0.0.1', '10.1.2.3', '192.168.0.5', '172.16.0.1', '169.254.1.1', '0.0.0.1', '::1', 'fe80::1', 'fc00::1'])
    assert.equal(isPrivateAddress(ip), true, ip);
  assert.equal(isPrivateAddress('8.8.8.8'), false);
  assert.equal(isPrivateAddress('::ffff:127.0.0.1'), true);
  assert.equal(isPrivateAddress('::ffff:7f00:1'), true);
  assert.equal(isPrivateAddress('[::ffff:a9fe:a9fe]'), true);
  assert.equal(isPrivateAddress('::ffff:808:808'), false);
  await assert.rejects(() => safeFetch('http://127.0.0.1/'), /not allowed/);
  await assert.rejects(() => safeFetch('http://[::1]/'), /not allowed/);
  await assert.rejects(() => safeFetch('http://[::ffff:7f00:1]/'), /not allowed/);
  await assert.rejects(() => safeFetch('file:///etc/passwd'), /http/);
  await assert.rejects(() => safeFetch('http://user:pass@example.com/a'), /not allowed/);
  assert.throws(() => imageType('text/html'), /not an image/);
  assert.equal(imageType('image/jpeg; charset=binary'), 'image/jpeg');
  assert.match(read('lib/wbw.js'), /safeFetch\(src, \{ image: true \}\)/);
  assert.match(read('lib/sites.js'), /safeFetch\(url\)/);
  assert.match(read('app/img/[id]/[n]/[name]/route.js'), /allowedPhotoUrl\(src\)/);
  assert.match(read('lib/wbw.js'), /ENRICH_V = 11/);
});

test('the extension only talks to the saved BootLister hosts and does not store the password', () => {
  const manifest = JSON.parse(read('extension/manifest.json'));
  const hosts = ['https://bootlister.vercel.app/*', 'https://wbw-lister.vercel.app/*', 'http://localhost/*', 'http://127.0.0.1/*'];
  assert.deepEqual(manifest.content_scripts[0].matches, hosts);
  for (const host of hosts) assert.equal(manifest.host_permissions.includes(host), true);
  assert.equal(manifest.host_permissions.includes('https://*.vercel.app/*'), false);
  const bg = read('extension/background.js');
  assert.match(bg, /sameOrigin\(saved\.server, server\)/);
  assert.equal(bg.includes("'x-auth': token"), false);
  const popup = read('extension/popup.js');
  assert.match(popup, /remove\('pin'\)/);
  assert.equal(/storage\.sync\.set\(\{[^}]*\bpin\b/.test(popup), false);
});

test('csv cells that start with a formula character are quoted as text', () => {
  assert.equal(csvCell('=1+1'), `"'=1+1"`);
  assert.equal(csvCell('+1'), `"'+1"`);
  assert.equal(csvCell('-1'), `"'-1"`);
  assert.equal(csvCell('@cmd'), `"'@cmd"`);
  assert.equal(csvCell('Lucchese'), '"Lucchese"');
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
});

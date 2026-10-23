import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { applyPassword, claimWithInvite, newInvite, registerSeller } from '../lib/auth.js';
import { actorFrom } from '../lib/access.js';
import { csvCell } from '../lib/csv.js';
import { decide } from '../lib/gate.js';
import { loginResponse, registerResponse } from '../lib/login-api.js';
import { bump, MAX_ATTEMPTS, underLimit } from '../lib/login-limit.js';
import { allowedPhotoUrl, imageType, isPrivateAddress, safeFetch } from '../lib/net.js';
import { LEGACY_UNTIL, readSession, sessionToken, sha256 } from '../lib/session.js';

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
  const old = await readSession(legacy, SECRET, LEGACY_UNTIL - 1);
  assert.equal(old.seller, 'ada');
  assert.equal(old.version, 0);
  assert.equal(old.legacy, true);
  assert.equal(await readSession(legacy, SECRET, LEGACY_UNTIL), null);
  const adminLegacy = `${encodeURIComponent('admin')}.${await sha256(`wbwlister:${SECRET}:admin`)}`;
  assert.equal(await readSession(adminLegacy, SECRET, LEGACY_UNTIL - day), null);
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
  const keys = (ip, account) => [`ip:${ip}`, account ? `acct:${account}` : ''].filter(Boolean);
  const attempts = {
    async read(ip, account) { return keys(ip, account).map(k => rows.get(k)).filter(Boolean); },
    async fail(ip, account) { for (const k of keys(ip, account)) rows.set(k, bump(rows.get(k))); },
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
  await loginResponse(post('7.7.7.7', 'Ada@Shop.TEST'), db, ENV);
  assert.equal(rows.has('acct:ada@shop.test'), true);
  await loginResponse(post('7.7.7.8', '(555) 123-4567'), db, ENV);
  assert.equal(rows.has('acct:+15551234567'), true);
  const reg = ip => new Request('http://localhost/api/register', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify({ display_name: 'Shop', email: 'new@shop.test', password: 'long-enough' }),
  });
  const regDb = { attempts, async register() { return { name: 'shop', version: 0 }; } };
  for (let i = 0; i < MAX_ATTEMPTS; i++) assert.equal((await registerResponse(reg('4.4.4.4'), regDb, ENV)).status, 200);
  assert.equal((await registerResponse(reg('4.4.4.4'), regDb, ENV)).status, 429);
  assert.equal((await registerResponse(reg('4.4.4.5'), regDb, ENV)).status, 200);
});

test('photo hosts are checked by hostname, and private addresses are not fetched', async () => {
  const blobEnv = { BLOB_READ_WRITE_TOKEN: 'vercel_blob_rw_abc123_secret' };
  assert.equal(allowedPhotoUrl('https://evil.example/?x=blob.vercel-storage.com'), false);
  assert.equal(allowedPhotoUrl('https://blob.vercel-storage.com.evil.example/a.jpg'), false);
  assert.equal(allowedPhotoUrl('https://abc123.public.blob.vercel-storage.com/a.jpg', blobEnv), true);
  assert.equal(allowedPhotoUrl('https://other.public.blob.vercel-storage.com/a.jpg', blobEnv), false);
  assert.equal(allowedPhotoUrl('https://photos.example/a.jpg', { BLOB_PUBLIC_HOST: 'https://photos.example' }), true);
  assert.equal(allowedPhotoUrl('https://cdn.example/a.jpg', { R2_PUBLIC_BASE_URL: 'https://cdn.example' }), true);
  assert.equal(allowedPhotoUrl('https://cdn.example.evil/a.jpg', { R2_PUBLIC_BASE_URL: 'https://cdn.example' }), false);
  for (const ip of ['127.0.0.1', '10.1.2.3', '192.168.0.5', '172.16.0.1', '169.254.1.1', '0.0.0.1', '100.64.0.1', '100.127.255.255', '224.0.0.1', '239.255.255.255', '::1', 'fe80::1', 'fc00::1', 'ff02::1'])
    assert.equal(isPrivateAddress(ip), true, ip);
  assert.equal(isPrivateAddress('8.8.8.8'), false);
  assert.equal(isPrivateAddress('100.128.0.1'), false);
  assert.equal(isPrivateAddress('223.0.0.1'), false);
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
  assert.throws(() => imageType('image/svg+xml'), /not an image/);
  assert.throws(() => imageType('image/bmp'), /not an image/);
  assert.equal(imageType('image/jpeg; charset=binary'), 'image/jpeg');
  assert.equal(imageType('image/png'), 'image/png');
  assert.equal(imageType('image/webp'), 'image/webp');
  assert.equal(imageType('image/gif'), 'image/gif');
  assert.equal(imageType('image/avif'), 'image/avif');
  await assert.rejects(() => safeFetch('http://192.0.2.1/', { timeout: 50, resolve: async () => ['192.0.2.1'] }), /timed out/);
  assert.match(read('lib/wbw.js'), /safeFetch\(src, \{ image: true \}\)/);
  assert.match(read('lib/sites.js'), /safeFetch\(url\)/);
  const img = read('app/img/[id]/[n]/[name]/route.js');
  assert.match(img, /safeFetch\(src, \{ image: true \}\)/);
  assert.match(img, /X-Content-Type-Options': 'nosniff'/);
  assert.match(img, /default-src 'none'; sandbox/);
  assert.equal(img.includes('!allowedPhotoUrl'), false);
  assert.match(read('lib/wbw.js'), /ENRICH_V = 12/);
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
  assert.equal(csvCell('\t=1'), '"\'\t=1"');
  assert.equal(csvCell('\r+1'), '"\'\r+1"');
  assert.equal(csvCell('- Handmade in Texas'), '"- Handmade in Texas"');
  assert.equal(csvCell('Lucchese'), '"Lucchese"');
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SIGNED_OUT } from '../extension/import-job.mjs';

const popupSource = readFileSync(new URL('../extension/popup.js', import.meta.url), 'utf8');
const runPopup = new Function('document', 'chrome', popupSource.replace(/loadSession\(\);\s*$/, 'return loadSession();'));
const ORIGIN = 'https://bootlister.vercel.app';
const SECRET = 'site-session-secret';

function element(id) {
  return {
    id, hidden: true, href: '', value: '', textContent: '', disabled: false, checked: false, style: {}, children: [],
    replaceChildren() { this.children = []; },
    append(child) { this.children.push(child); },
  };
}

function popupDocument() {
  const ids = ['status', 'signin', 'seller', 'profileUrl', 'limit', 'recheck', 'shopMode', 'log', 'bar', 'barLabel', 'profile', 'sync', 'listing', 'ver'];
  const nodes = Object.fromEntries(ids.map(id => [id, element(id)]));
  return {
    getElementById: id => nodes[id],
    createElement(tag) {
      if (tag !== 'option') throw new Error(`unexpected element ${tag}`);
      return { value: '', textContent: '' };
    },
    nodes,
  };
}

function installChrome() {
  const listeners = [];
  const removed = [];
  const cookieReads = [];
  const jar = new Map();
  let tabs = [{ id: 1, url: 'https://example.test/', active: true }];
  const syncStore = {};
  const chrome = {
    action: { setBadgeText() {} },
    contextMenus: { create() {}, onClicked: { addListener() {} } },
    webNavigation: { onErrorOccurred: { addListener() {}, removeListener() {} } },
    cookies: {
      async get({ url, name }) {
        cookieReads.push(`${url} ${name}`);
        return jar.get(`${url} ${name}`) || null;
      },
    },
    storage: {
      sync: {
        remove(keys) { removed.push(...[].concat(keys)); },
        async get(key) { return { [key]: syncStore[key] }; },
        async set(obj) { Object.assign(syncStore, obj); },
      },
      local: {
        get(key, cb) {
          const value = {};
          if (cb) cb(value);
          return Promise.resolve(value);
        },
        async set() {},
      },
      onChanged: { addListener() {} },
    },
    tabs: {
      query(_q, cb) {
        const result = tabs.map(t => ({ ...t }));
        if (cb) cb(result);
        return Promise.resolve(result);
      },
    },
    runtime: {
      getManifest: () => ({ version: '0.9' }),
      onInstalled: { addListener() {} },
      onMessage: { addListener(fn) { listeners.push(fn); } },
      sendMessage(message) {
        assert.equal(listeners.length, 1);
        return new Promise((resolve, reject) => {
          const keep = listeners[0](message, {}, response => {
            try { resolve(structuredClone(response)); }
            catch (e) { reject(e); }
          });
          assert.equal(keep, true);
        });
      },
    },
  };
  return {
    chrome, removed, cookieReads, syncStore,
    setCookie(origin, value) { jar.set(`${origin}/ auth`, { value }); },
    clearCookies() { jar.clear(); },
    setTabs(next) { tabs = next; },
  };
}

const world = installChrome();
const rawSend = world.chrome.runtime.sendMessage.bind(world.chrome.runtime);
globalThis.chrome = world.chrome;
await import('../extension/background.js');

async function openPopup() {
  const doc = popupDocument();
  let reply;
  world.chrome.runtime.sendMessage = async message => {
    assert.equal(message.type, 'who');
    reply = await rawSend(message);
    return reply;
  };
  await runPopup(doc, world.chrome);
  return { doc, reply };
}

test('popup session init uses the real onMessage reply for admin, seller, and signed-out', async () => {
  const seen = [];
  let meBody = { role: 'admin' };
  const sellersBody = [
    { name: 'ada boots', display_name: 'Ada Boots', fb_profile: 'https://www.facebook.com/marketplace/profile/1661843737/' },
    { name: 'other', display_name: 'Other' },
  ];
  globalThis.fetch = async (url, opts) => {
    seen.push({ url: String(url), auth: opts?.headers?.['x-auth'] });
    const path = new URL(url).pathname;
    if (path === '/api/me')
      return { status: 200, ok: true, json: async () => meBody };
    if (path === '/api/sellers')
      return { status: 200, ok: true, json: async () => sellersBody };
    return { status: 404, ok: false, json: async () => ({ error: 'not found' }) };
  };

  assert.deepEqual([...world.removed].sort(), ['email', 'password', 'pin', 'server', 'token']);
  world.setTabs([{ id: 1, url: `${ORIGIN}/inventory`, active: true }]);
  world.setCookie(ORIGIN, SECRET);
  world.syncStore.seller = 'ada boots';

  const admin = await openPopup();
  assert.deepEqual(admin.reply, { ok: true, role: 'admin', seller: '', sellers: sellersBody, origin: ORIGIN });
  assert.equal(JSON.stringify(admin.reply).includes(SECRET), false);
  assert.equal(admin.doc.nodes.status.textContent, '');
  assert.equal(admin.doc.nodes.signin.hidden, true);
  assert.equal(admin.doc.nodes.seller.disabled, false);
  assert.equal(admin.doc.nodes.seller.value, 'ada boots');
  assert.deepEqual(admin.doc.nodes.seller.children.map(o => o.value), ['', 'ada boots', 'other']);
  assert.equal(seen.some(c => c.url === `${ORIGIN}/api/sellers` && c.auth === SECRET), true);
  admin.doc.nodes.profileUrl.value = 'https://www.depop.com/nuclear_nostalgia/';
  admin.doc.nodes.seller.value = '';
  admin.doc.nodes.profile.onclick();
  assert.equal(admin.doc.nodes.status.textContent, 'Pick a seller first.');

  seen.length = 0;
  meBody = { role: 'seller', seller: 'Ada' };
  world.syncStore.seller = 'someone-else';
  const seller = await openPopup();
  assert.deepEqual(seller.reply, {
    ok: true, role: 'seller', seller: 'Ada', origin: ORIGIN,
    sellers: [{ name: 'Ada', display_name: 'Ada' }],
  });
  assert.equal(JSON.stringify(seller.reply).includes(SECRET), false);
  assert.equal(seller.doc.nodes.seller.disabled, true);
  assert.equal(seller.doc.nodes.seller.value, 'Ada');
  assert.deepEqual(seller.doc.nodes.seller.children.map(o => o.value), ['', 'Ada']);
  assert.equal(seen.some(c => c.url.includes('/api/sellers')), false);
  assert.equal(seen.every(c => c.auth === SECRET && c.url === `${ORIGIN}/api/me`), true);
  seller.doc.nodes.profileUrl.value = 'https://www.depop.com/nuclear_nostalgia/';
  seller.doc.nodes.seller.value = '';
  seller.doc.nodes.profile.onclick();
  assert.equal(seller.doc.nodes.status.textContent, 'Pick a seller first.');

  seen.length = 0;
  world.clearCookies();
  world.setTabs([{ id: 1, url: 'https://www.facebook.com/', active: true }]);
  const signedOut = await openPopup();
  assert.deepEqual(signedOut.reply, { error: SIGNED_OUT, signIn: `${ORIGIN}/login` });
  assert.equal(signedOut.doc.nodes.status.textContent, SIGNED_OUT);
  assert.equal(signedOut.doc.nodes.signin.hidden, false);
  assert.equal(signedOut.doc.nodes.signin.href, `${ORIGIN}/login`);
  assert.equal(seen.length, 0);
  signedOut.doc.nodes.seller.value = 'ada';
  signedOut.doc.nodes.profileUrl.value = 'https://www.depop.com/nuclear_nostalgia/';
  signedOut.doc.nodes.profile.onclick();
  assert.equal(signedOut.doc.nodes.status.textContent, SIGNED_OUT);

  const hostileReads = world.cookieReads.length;
  const hostile = await rawSend({ type: 'who', server: 'https://evil.example/phish' });
  assert.match(hostile.error, /not a BootLister site/);
  assert.equal(hostile.signIn, undefined);
  assert.equal(hostile.ok, undefined);
  assert.equal(world.cookieReads.length, hostileReads);
  assert.equal(JSON.stringify(hostile).includes(SECRET), false);
});

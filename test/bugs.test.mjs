import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { bugLimitDecision, bugReportResponse, escapeHtml, filterReports, MAX_BODY_BYTES, priorityFilter, renderAnalysis, REPORT_PAGE, reportWindow, validateImage, ANON_MAX, ANON_MAX_IMAGE_BYTES, MAX_IMAGE_BYTES } from '../lib/bugs.js';
import { isSensitiveControl, redactClone } from '../components/bug-reporter/redact.js';
import { redactPageUrl, sensitiveQuery } from '../lib/report-url.js';
import { decide } from '../lib/gate.js';
import { sessionToken } from '../lib/session.js';
import { captureScale } from '../components/bug-reporter/capture.js';
import { clampPosition, movedPastThreshold, parseStoredPosition, snapPosition } from '../components/bug-reporter/position.js';

const SECRET = 'test-signing-secret';
const ENV = { NODE_ENV: 'production', ADMIN_PASSWORD: 'staff-secret', APP_PASSWORD: SECRET };
const read = p => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const jpeg = (n = 32) => {
  const buf = Buffer.alloc(n, 0);
  buf[0] = 0xff; buf[1] = 0xd8; buf[2] = 0xff; buf[n - 1] = 0xd9;
  return `data:image/jpeg;base64,${buf.toString('base64')}`;
};
const png = () => `data:image/png;base64,${Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]).toString('base64')}`;
const webp = () => {
  const buf = Buffer.alloc(16);
  buf.write('RIFF', 0); buf.writeUInt32LE(8, 4); buf.write('WEBP', 8);
  return `data:image/webp;base64,${buf.toString('base64')}`;
};

function memory() {
  const reports = [];
  const limits = new Map();
  let chain = Promise.resolve();
  let id = 1;
  return {
    reports,
    async list(priority, window = {}) {
      const filtered = filterReports(reports, priority);
      const offset = Math.max(0, Number(window.offset) || 0);
      const limit = window.limit == null ? filtered.length : Math.max(0, Number(window.limit));
      return filtered.slice(offset, offset + limit).map(r => ({ ...r }));
    },
    async insert(row) {
      const saved = { ...row, id: id++, status: 'open', created_at: new Date(Date.now() + id).toISOString() };
      reports.push(saved);
      return { id: saved.id };
    },
    async setStatus(reportId, status) {
      const row = reports.find(r => r.id === reportId);
      if (!row) return null;
      row.status = status;
      return { id: row.id, status };
    },
    async reporter(who) { return who.seller === 'ada' ? 'ada@shop.test' : who.seller; },
    limits: {
      async admit(key, max, windowMs, now = Date.now()) {
        let release;
        const gate = new Promise(resolve => { release = resolve; });
        const prev = chain;
        chain = prev.then(() => gate);
        await prev;
        try {
          const decision = bugLimitDecision(limits.get(key) || null, now, max, windowMs);
          if (!decision.allow) return { allow: false, n: Number(limits.get(key)?.n || 0) };
          limits.set(key, decision.next);
          return { allow: true, n: decision.next.n };
        } finally { release(); }
      },
    },
  };
}

const post = (body, headers = {}) => new Request('http://localhost/api/bug-reports', {
  method: 'POST',
  headers: { 'content-type': 'application/json', ...headers },
  body: JSON.stringify(body),
});
const loginHeaders = (ip = '1.2.3.4') => ({ referer: 'http://localhost/login', 'x-forwarded-for': ip });
const loginBody = (extra = {}) => ({ image: jpeg(), transcript: 'the price is wrong', priority: 'Low', page_url: 'http://localhost/login', user_agent: 'TestPhone', viewport: '390x844@3', ...extra });

test('priority, image type, and size are rejected before a report is stored', async () => {
  assert.equal(priorityFilter('High'), 'High');
  assert.equal(priorityFilter('high'), null);
  assert.equal(priorityFilter('Nope'), null);
  assert.equal(priorityFilter(undefined), null);
  assert.equal(validateImage(jpeg(), MAX_IMAGE_BYTES).mime, 'image/jpeg');
  assert.equal(validateImage(png(), MAX_IMAGE_BYTES).mime, 'image/png');
  assert.equal(validateImage(webp(), MAX_IMAGE_BYTES).mime, 'image/webp');
  assert.throws(() => validateImage('data:image/gif;base64,R0lGODlh', MAX_IMAGE_BYTES), /PNG, JPEG, or WebP/);
  assert.throws(() => validateImage('data:text/html;base64,PGh0bWw+', MAX_IMAGE_BYTES), /PNG, JPEG, or WebP/);
  assert.throws(() => validateImage(png().replace('image/png', 'image/jpeg'), MAX_IMAGE_BYTES), /Invalid image/);
  const tooBig = jpeg(ANON_MAX_IMAGE_BYTES + 8);
  assert.throws(() => validateImage(tooBig, ANON_MAX_IMAGE_BYTES), /too large/);
  assert.equal(validateImage(tooBig, MAX_IMAGE_BYTES).mime, 'image/jpeg');
  assert.throws(() => validateImage(jpeg(MAX_IMAGE_BYTES + 8), MAX_IMAGE_BYTES), /too large/);

  const db = memory();
  const anon = (body, headers) => bugReportResponse(post(body, headers || loginHeaders()), db, ENV);
  assert.equal((await anon({ ...loginBody(), priority: 'Urgent' })).status, 400);
  assert.equal((await anon({ ...loginBody(), image: 'data:image/gif;base64,R0lGODlh' })).status, 400);
  assert.equal((await anon({ ...loginBody(), image: tooBig })).status, 413);
  assert.equal((await anon(loginBody(), { 'x-forwarded-for': '8.8.8.8' })).status, 401);
  assert.equal((await anon({ ...loginBody(), page_url: 'http://localhost/' })).status, 401);
  assert.equal((await anon({ ...loginBody(), page_url: 'http://evil.test/login' }, { referer: 'http://evil.test/login', 'x-forwarded-host': 'evil.test' })).status, 401);
  assert.equal(db.reports.length, 0);
});

test('logged-out reports are only accepted from /login and then rate limited', async () => {
  const db = memory();
  for (let i = 0; i < ANON_MAX; i++) {
    const res = await bugReportResponse(post(loginBody({ transcript: `<script>${i}</script>` }), loginHeaders()), db, ENV);
    assert.equal(res.status, 201, i);
  }
  assert.equal((await bugReportResponse(post(loginBody(), loginHeaders()), db, ENV)).status, 429);
  assert.equal((await bugReportResponse(post(loginBody(), loginHeaders('9.9.9.9')), db, ENV)).status, 201);
  assert.equal(db.reports[0].reporter, 'anonymous');
  assert.equal(db.reports[0].transcript.includes('<script>'), true);
  assert.equal(db.reports[0].ai_analysis, null);
  assert.match(escapeHtml(db.reports[0].transcript), /&lt;script&gt;/);
  const closed = await bugReportResponse(post(loginBody(), loginHeaders()), db, { NODE_ENV: 'production' });
  assert.equal(closed.status, 503);
});

test('a signed-in seller or admin can report; only an admin sees and updates the list', async () => {
  const db = memory();
  db.analyze = () => { throw new Error('gemini down'); };
  const env = { ...ENV, GEMINI_API_KEY: 'test-key', BUG_REPORT_AI: 'on', sessionVersions: { ada: 1 } };
  const seller = await sessionToken('seller:ada', SECRET, { version: 1 });
  const admin = await sessionToken('admin', SECRET);
  const sellerRes = await bugReportResponse(post({
    ...loginBody({ priority: 'High', page_url: 'http://localhost/seller', transcript: 'overlap' }),
  }, { 'x-auth': seller, 'x-forwarded-for': '4.4.4.4' }), db, env);
  assert.equal(sellerRes.status, 201);
  assert.equal(db.reports[0].reporter, 'ada@shop.test');
  assert.equal(db.reports[0].ai_analysis, null);
  db.analyze = async () => '## Fix\n\n<script>alert(1)</script>\n\n**bold** [x](javascript:alert(1))';
  const adminRes = await bugReportResponse(post({
    ...loginBody({ priority: 'Question', page_url: 'http://localhost/?seller=ada' }),
  }, { 'x-auth': admin }), db, env);
  assert.equal(adminRes.status, 201);
  assert.match(db.reports[1].ai_analysis, /<script>/);
  assert.equal(db.reports[1].reporter, 'admin');
  const html = renderAnalysis(db.reports[1].ai_analysis);
  assert.equal(html.includes('<script>'), false);
  assert.equal(html.includes('javascript:'), false);
  assert.match(html, /<strong>bold<\/strong>/);

  const list = await bugReportResponse(new Request('http://localhost/api/bug-reports?priority=High', { headers: { 'x-auth': admin } }), db, env);
  assert.equal(list.status, 200);
  const high = await list.json();
  assert.deepEqual(high.reports.map(r => r.priority), ['High']);
  const all = await (await bugReportResponse(new Request('http://localhost/api/bug-reports?priority=nope', { headers: { 'x-auth': admin } }), db, env)).json();
  assert.equal(all.priority, null);
  assert.equal(all.reports.length, 2);
  assert.equal((await bugReportResponse(new Request('http://localhost/api/bug-reports'), db, env)).status, 401);
  assert.equal((await bugReportResponse(new Request('http://localhost/api/bug-reports', { headers: { 'x-auth': seller } }), db, env)).status, 403);
  const fixed = await bugReportResponse(new Request('http://localhost/api/bug-reports', {
    method: 'PATCH', headers: { 'x-auth': admin, 'content-type': 'application/json' }, body: JSON.stringify({ id: high.reports[0].id, status: 'fixed' }),
  }), db, env);
  assert.equal((await fixed.json()).status, 'fixed');
  assert.equal((await bugReportResponse(new Request('http://localhost/api/bug-reports', {
    method: 'PATCH', headers: { 'x-auth': seller, 'content-type': 'application/json' }, body: JSON.stringify({ id: 1, status: 'fixed' }),
  }), db, env)).status, 403);
  assert.equal((await bugReportResponse(new Request('http://localhost/api/bug-reports', {
    method: 'PATCH', headers: { 'x-auth': admin, 'content-type': 'application/json' }, body: JSON.stringify({ id: 1, status: 'closed' }),
  }), db, env)).status, 400);
});

test('the dashboard filter keeps an invalid priority from narrowing the list', () => {
  const rows = [
    { id: 1, priority: 'Low', created_at: '2026-01-01T00:00:00Z' },
    { id: 2, priority: 'High', created_at: '2026-02-01T00:00:00Z' },
    { id: 3, priority: 'High', created_at: '2026-02-01T00:00:00Z' },
    { id: 4, priority: 'Question', created_at: '2026-03-01T00:00:00Z' },
  ];
  assert.deepEqual(filterReports(rows, 'High').map(r => r.id), [3, 2]);
  assert.deepEqual(filterReports(rows, 'nope').map(r => r.id), [4, 3, 2, 1]);
  assert.deepEqual(filterReports(rows, '').map(r => r.id), [4, 3, 2, 1]);
  const page = read('app/admin/bugs/page.js');
  assert.match(page, /priorityFilter/);
  assert.match(page, /robots: \{ index: false, follow: false \}/);
  assert.match(page, /row\.transcript/);
  assert.equal(page.includes('dangerouslySetInnerHTML={{ __html: row.transcript'), false);
  assert.match(read('app/screen.js'), /href="\/admin\/bugs"/);
  assert.match(read('app/layout.js'), /BugReporter/);
  assert.equal(read('proxy.js').includes('req.method'), true);
});

test('the bug button stays inside the safe area and a short move is still a tap', () => {
  const phone = { vw: 390, vh: 844, size: 48, inset: { top: 47, right: 0, bottom: 34, left: 0 } };
  const clamped = clampPosition(-20, 900, phone);
  assert.equal(clamped.x, 0);
  assert.equal(clamped.y, 844 - 48 - 34);
  const snapped = snapPosition(300, 100, phone);
  assert.equal(snapped.side, 'right');
  assert.equal(snapped.x, 390 - 48);
  const parked = parseStoredPosition(JSON.stringify({ side: 'left', y: 10 }), phone);
  assert.equal(parked.side, 'left');
  assert.equal(parked.y, 47);
  const wider = parseStoredPosition(JSON.stringify({ side: 'left', y: 10 }), { ...phone, vw: 200, vh: 400 });
  assert.equal(wider.side, 'left');
  assert.equal(wider.x, 0);
  assert.equal(movedPastThreshold(7, 0), false);
  assert.equal(movedPastThreshold(8, 0), true);
  assert.equal(captureScale(390, 844, 3) <= 2, true);
  assert.ok(captureScale(390, 844, 3) * 390 * 844 <= 1_200_000 + 1);
});

test('POST /api/bug-reports reaches the handler without a session; other methods do not', async () => {
  assert.equal((await decide('/api/bug-reports', '', ENV, 'POST')).type, 'next');
  assert.deepEqual(await decide('/api/bug-reports', '', ENV, 'GET'), { type: 'json', status: 401, error: 'Please log in.' });
  assert.deepEqual(await decide('/api/bug-reports', '', ENV), { type: 'json', status: 401, error: 'Please log in.' });
  assert.equal((await decide('/api/bug-reports', '', { NODE_ENV: 'production' }, 'POST')).type, 'closed');
  const admin = await sessionToken('admin', SECRET);
  assert.equal((await decide('/admin/bugs', admin, ENV)).type, 'next');
  const seller = await sessionToken('seller:ada', SECRET);
  assert.equal((await decide('/admin/bugs', seller, ENV)).to, '/seller');
});

test('concurrent anonymous reports cannot pass the cap, and a lost update can', async () => {
  const rows = new Map();
  const racy = async key => {
    const row = rows.get(key) || null;
    await Promise.resolve();
    const decision = bugLimitDecision(row, Date.now(), ANON_MAX, 600000);
    if (!decision.allow) return false;
    await Promise.resolve();
    rows.set(key, decision.next);
    return true;
  };
  const overrun = await Promise.all(Array.from({ length: 20 }, () => racy('same')));
  assert.ok(overrun.filter(Boolean).length > ANON_MAX);

  const db = memory();
  const results = await Promise.all(Array.from({ length: 20 }, () => bugReportResponse(post(loginBody(), loginHeaders('8.8.4.4')), db, ENV)));
  assert.equal(results.filter(r => r.status === 201).length, ANON_MAX);
  assert.equal(results.filter(r => r.status === 429).length, 20 - ANON_MAX);
  assert.equal(db.reports.length, ANON_MAX);
  const store = read('lib/bug-store.js');
  assert.match(store, /on conflict \(key\) do update/);
  assert.match(store, /returning n/);
  assert.equal(store.includes('do update set n ='), false);
  assert.equal(store.includes('writeLimit'), false);
});

test('page links drop invite, password, contact, and fragments before they are stored', async () => {
  const secret = 'INVITE-SECRET-99';
  const db = memory();
  const page = `http://localhost/login?invite=${secret}&seller=ada&password=hunter2&email=ada%40shop.test&phone=5551234567&contact=Ada#tok`;
  const res = await bugReportResponse(post(loginBody({ page_url: page }), { referer: page, 'x-forwarded-for': '3.3.3.3' }), db, ENV);
  assert.equal(res.status, 201);
  const saved = db.reports[0].page_url;
  assert.equal(saved.includes(secret), false);
  assert.equal(saved.includes('hunter2'), false);
  assert.equal(saved.includes('ada@shop.test'), false);
  assert.equal(saved.includes('5551234567'), false);
  assert.equal(saved.includes('invite'), false);
  assert.equal(saved.includes('#'), false);
  assert.equal(saved, 'http://localhost/login?seller=ada');
  assert.equal(redactPageUrl('http://user:hunter2@localhost/seller?token=abc'), 'http://localhost/seller');
  assert.equal(redactPageUrl('javascript:alert(1)'), '');
  assert.equal(sensitiveQuery('access_token'), true);
  assert.equal(sensitiveQuery('seller'), false);
  const seller = await sessionToken('seller:ada', SECRET, { version: 1 });
  const signed = await bugReportResponse(post(loginBody({
    page_url: 'http://localhost/seller?password=hunter2&email=ada@shop.test&phone=%2B15551212',
  }), { 'x-auth': seller }), db, { ...ENV, sessionVersions: { ada: 1 } });
  assert.equal(signed.status, 201);
  assert.equal(db.reports[1].page_url, 'http://localhost/seller');
});

test('the capture clone clears invite, password, contact, and private text', () => {
  const node = (tag, attrs = {}, text = '') => {
    const el = {
      tagName: tag.toUpperCase(), attrs: { ...attrs }, value: attrs.value || '', children: [], parent: null, _text: text,
      getAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attrs, name) ? String(this.attrs[name]) : null; },
      setAttribute(name, value) { this.attrs[name] = String(value); },
      removeAttribute(name) { delete this.attrs[name]; },
      hasAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attrs, name); },
      closest() {
        for (let n = this; n; n = n.parent) if (n.hasAttribute('data-private') || n.hasAttribute('data-sensitive')) return n;
        return null;
      },
      get textContent() { return this._text + this.children.map(c => c.textContent).join(''); },
      set textContent(value) { this._text = String(value); this.children = []; },
    };
    return el;
  };
  const root = node('div');
  const add = (parent, child) => { child.parent = parent; parent.children.push(child); return child; };
  const invite = add(root, node('input', { placeholder: 'Invite code', value: 'INVITE-SECRET-99' }));
  const password = add(root, node('input', { type: 'password', value: 'hunter2' }));
  const email = add(root, node('input', { type: 'email', name: 'email', value: 'ada@shop.test' }));
  const phone = add(root, node('input', { type: 'tel', name: 'phone', value: '5551234567' }));
  const contact = add(root, node('input', { 'data-private': '', value: 'Ada Boots' }));
  const shop = add(root, node('input', { placeholder: 'Shop name', value: 'Ada Boots' }));
  const shown = add(root, node('p', { 'data-private': '' }, 'Invite code, shown once: INVITE-SECRET-99'));
  root.querySelectorAll = sel => {
    const all = [];
    const walk = n => { all.push(n); n.children.forEach(walk); };
    walk(root);
    if (sel === 'input, textarea, select') return all.filter(n => n.tagName === 'INPUT');
    return all.filter(n => n.hasAttribute('data-private') || n.hasAttribute('data-sensitive'));
  };
  assert.equal(isSensitiveControl(invite), true);
  assert.equal(isSensitiveControl(shop), false);
  redactClone(root);
  for (const el of [invite, password, email, phone, contact]) assert.equal(el.value, '');
  assert.equal(shop.value, 'Ada Boots');
  assert.equal(shown.textContent.includes('INVITE-SECRET-99'), false);
  assert.match(read('components/bug-reporter/capture.js'), /redactClone\(doc\)/);
  assert.match(read('components/bug-reporter/BugReporter.js'), /redactPageUrl\(location\.href/);
  assert.match(read('app/login/page.js'), /data-private/);
  assert.match(read('app/screen.js'), /data-private/);
});

test('request size is the streamed body, anonymous reports do not call AI, and the dashboard page is bounded', async () => {
  const db = memory();
  let reads = 0;
  const closed = {
    method: 'POST', url: 'http://localhost/api/bug-reports',
    headers: new Headers({ 'content-length': '1', referer: 'http://localhost/login' }),
    body: { getReader() { reads += 1; throw new Error('read'); } },
    json() { throw new Error('json'); },
  };
  assert.equal((await bugReportResponse(closed, db, { NODE_ENV: 'production' })).status, 503);
  assert.equal(reads, 0);
  const loggedOutPatch = { ...closed, method: 'PATCH' };
  assert.equal((await bugReportResponse(loggedOutPatch, db, ENV)).status, 401);
  assert.equal(reads, 0);

  const hugeHeader = {
    method: 'POST', url: 'http://localhost/api/bug-reports',
    headers: new Headers({ 'content-length': String(MAX_BODY_BYTES + 5), referer: 'http://localhost/login', 'content-type': 'application/json' }),
    body: { getReader() { reads += 1; throw new Error('read'); } },
    json() { throw new Error('json'); },
  };
  assert.equal((await bugReportResponse(hugeHeader, db, ENV)).status, 413);
  assert.equal(reads, 0);

  let cancelled = false;
  const chunk = new Uint8Array(MAX_BODY_BYTES + 1);
  let sent = false;
  const lying = {
    method: 'POST', url: 'http://localhost/api/bug-reports',
    headers: new Headers({ 'content-length': '1', referer: 'http://localhost/login', 'content-type': 'application/json' }),
    body: { getReader() { return { async read() { if (sent) return { done: true }; sent = true; return { done: false, value: chunk }; }, async cancel() { cancelled = true; }, releaseLock() {} }; } },
    json() { throw new Error('json'); },
  };
  assert.equal((await bugReportResponse(lying, db, ENV)).status, 413);
  assert.equal(cancelled, true);
  assert.equal(db.reports.length, 0);

  let calls = 0;
  db.analyze = () => { calls += 1; throw new Error('should not spend'); };
  const flagged = { ...ENV, GEMINI_API_KEY: 'test-key', BUG_REPORT_AI: 'on' };
  assert.equal((await bugReportResponse(post(loginBody(), loginHeaders('7.7.7.1')), db, flagged)).status, 201);
  assert.equal(calls, 0);
  assert.equal((await bugReportResponse(post(loginBody(), loginHeaders('7.7.7.2')), db, { ...ENV, GEMINI_API_KEY: 'test-key' })).status, 201);
  assert.equal(calls, 0);
  assert.equal(db.reports.every(r => r.ai_analysis == null), true);

  const admin = await sessionToken('admin', SECRET);
  for (let i = 0; i < REPORT_PAGE + 3; i++) {
    assert.equal((await bugReportResponse(post(loginBody({ priority: i % 2 ? 'Low' : 'High', page_url: 'http://localhost/' }), { 'x-auth': admin }), db, ENV)).status, 201);
  }
  const page1 = await (await bugReportResponse(new Request('http://localhost/api/bug-reports?page=1', { headers: { 'x-auth': admin } }), db, ENV)).json();
  const page2 = await (await bugReportResponse(new Request('http://localhost/api/bug-reports?page=2', { headers: { 'x-auth': admin } }), db, ENV)).json();
  assert.equal(page1.reports.length, REPORT_PAGE);
  assert.equal(page1.hasMore, true);
  assert.equal(page2.reports.length, (REPORT_PAGE + 3 + 2) - REPORT_PAGE);
  assert.equal(page2.hasMore, false);
  assert.equal(reportWindow('nope').page, 1);
  assert.equal(reportWindow('2').offset, REPORT_PAGE);
  assert.match(read('lib/bug-store.js'), /limit \$\{take\} offset \$\{skip\}/);
  assert.match(read('app/admin/bugs/page.js'), /loading="lazy"/);
  assert.match(read('lib/bug-ai.js'), /BUG_REPORT_AI/);
  assert.match(read('components/bug-reporter/BugReporter.js'), /data-priority-choices/);
  assert.match(read('components/bug-reporter/BugReporter.js'), />Back</);
  assert.match(read('components/bug-reporter/BugReporter.js'), />Cancel</);
});

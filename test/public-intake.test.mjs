import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { publicIntakeResponse } from '../app/api/public-intake/route.js';
import { intakeSubmissionsResponse } from '../app/api/intake-submissions/route.js';
import { decide } from '../lib/gate.js';
import { decryptSecret, encryptSecret, hasIntakeSecret } from '../lib/intake-crypto.js';
import { HONEYPOT, isHoneypot, publicIntakeView, validatePublicIntake } from '../lib/public-intake.js';
import { sessionToken } from '../lib/session.js';

const DEPOP = 'https://www.depop.com/westernbootworld/';
const SITE = 'https://adaboots.example/shop';
const ENV = { NODE_ENV: 'production', ADMIN_PASSWORD: 'staff-secret', APP_PASSWORD: 'signing-secret', INTAKE_SECRET: 'test-intake-secret' };
const valid = (extra = {}) => ({
  display_name: 'Ada Boots', email: 'ada@shop.test', depop: DEPOP,
  password: 'temporary1', password_confirm: 'temporary1',
  photo_ok: 'on', import_ok: 'on', ...extra,
});

describe('public intake access', () => {
  it('lets anyone open /intake and POST the form without logging in', async () => {
    assert.deepEqual(await decide('/intake', '', ENV), { type: 'next' });
    assert.deepEqual(await decide('/api/public-intake', '', ENV, 'POST'), { type: 'next' });
    assert.deepEqual(await decide('/api/public-intake', '', ENV, 'GET'), { type: 'json', status: 401, error: 'Please log in.' });
    assert.deepEqual(await decide('/api/intake-submissions', '', ENV), { type: 'json', status: 401, error: 'Please log in.' });
    const seller = await sessionToken('seller:ada', ENV.APP_PASSWORD);
    assert.equal((await decide('/intake', seller, ENV)).type, 'next');
  });
});

describe('public intake validation', () => {
  it('requires name, email, one shop link, a confirmed password, and both consent checks', () => {
    assert.throws(() => validatePublicIntake({ ...valid(), display_name: '' }), /name to show on WBW/i);
    assert.throws(() => validatePublicIntake({ ...valid(), email: 'nope' }), /email/i);
    assert.throws(() => validatePublicIntake({ ...valid(), depop: '', website: '' }), /at least one shop link/i);
    assert.throws(() => validatePublicIntake({ ...valid(), password: 'short' }), /at least 8/i);
    assert.throws(() => validatePublicIntake({ ...valid(), password_confirm: 'different1' }), /do not match/i);
    assert.throws(() => validatePublicIntake({ ...valid(), photo_ok: false }), /own the photos/i);
    assert.throws(() => validatePublicIntake({ ...valid(), import_ok: false }), /copy your current listings/i);
    const v = validatePublicIntake(valid({ website: SITE, phone: '5551234567', location: 'El Paso, TX' }));
    assert.equal(v.display_name, 'Ada Boots');
    assert.equal(v.email, 'ada@shop.test');
    assert.equal(v.fb_profile, DEPOP);
    assert.equal(v.website, SITE);
    assert.equal(v.phone, '+15551234567');
    assert.equal(v.location, 'El Paso, TX');
    assert.equal(v.photo_ok, 'on');
    assert.equal(v.import_ok, 'on');
    assert.equal(v.brand_context, 'on');
    assert.equal(v.password, 'temporary1');
  });

  it('allows optional fields to be blank', () => {
    const v = validatePublicIntake(valid());
    assert.equal(v.phone, null);
    assert.equal(v.location, null);
    assert.equal(v.terms, null);
    assert.equal(v.defaults, null);
    assert.equal(v.photo, null);
  });
});

describe('temporary password encryption', () => {
  it('round-trips with INTAKE_SECRET and fails closed without it', () => {
    assert.equal(hasIntakeSecret(ENV), true);
    assert.equal(hasIntakeSecret({}), false);
    const stored = encryptSecret('temporary1', ENV);
    assert.equal(stored.includes('temporary1'), false);
    assert.equal(decryptSecret(stored, ENV), 'temporary1');
    assert.throws(() => encryptSecret('temporary1', {}), /not taking submissions/);
    assert.throws(() => decryptSecret(stored, { INTAKE_SECRET: 'other-secret' }), /not available/);
  });

  it('never puts the password on a public or admin list view', () => {
    const view = publicIntakeView({
      id: 3, display_name: 'Ada', email: 'ada@shop.test', password_cipher: 'cipher-value',
      website: SITE, photo_ok: 'on', import_ok: 'on',
    });
    const text = JSON.stringify(view);
    assert.equal(text.includes('temporary1'), false);
    assert.equal(text.includes('cipher-value'), false);
    assert.equal(text.includes('password_cipher'), false);
    assert.equal(view.has_password, true);
    assert.equal(isHoneypot({ [HONEYPOT]: 'bot' }), true);
    assert.equal(isHoneypot({ [HONEYPOT]: '' }), false);
  });
});

describe('public intake API', () => {
  it('accepts a valid form, drops honeypot posts, and rate-limits', async () => {
    const submitted = [];
    const db = {
      async admit(key) { return key.includes('blocked') ? { ok: false } : { ok: true }; },
      async submit(body) { submitted.push(body); return { ok: true, id: 9 }; },
    };
    const post = (body, headers = {}) => new Request('http://localhost/api/public-intake', {
      method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body),
    });
    const ok = await publicIntakeResponse(post(valid()), db, ENV);
    assert.deepEqual(ok, { ok: true });
    assert.equal(submitted.length, 1);
    assert.equal(JSON.stringify(ok).includes('temporary1'), false);
    const honey = await publicIntakeResponse(post(valid({ [HONEYPOT]: 'spam' })), db, ENV);
    assert.deepEqual(honey, { ok: true });
    assert.equal(submitted.length, 1);
    await assert.rejects(() => publicIntakeResponse(post(valid(), { 'x-forwarded-for': 'blocked' }), {
      async admit() { return { ok: false }; },
      async submit() { throw new Error('should not submit'); },
    }, ENV), /wait a bit/);
  });
});

describe('admin intake submissions', () => {
  it('lets only an admin list, reveal, clear, and approve, and audits reveal', async () => {
    const revealed = [];
    const db = {
      async list() { return [{ id: 1, display_name: 'Ada', has_password: true, status: 'pending' }]; },
      async reveal(id, actor) { revealed.push({ id, actor }); return { password: 'temporary1', display_name: 'Ada' }; },
      async clear(id, actor) { return { id, has_password: false, cleared_by: actor }; },
      async approve(id) { return { id, status: 'approved', seller_name: 'ada-boots' }; },
      async invite() { return { code: 'abc', expires: '2099-01-01' }; },
    };
    const seller = await sessionToken('seller:ada', ENV.APP_PASSWORD);
    const admin = await sessionToken('admin', ENV.APP_PASSWORD);
    const req = (token, method = 'GET', body) => new Request('http://localhost/api/intake-submissions', {
      method, headers: { 'x-auth': token, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined,
    });
    await assert.rejects(() => intakeSubmissionsResponse(new Request('http://localhost/api/intake-submissions'), db, ENV), /log in/);
    await assert.rejects(() => intakeSubmissionsResponse(req(seller), db, ENV), /admin/);
    const list = await intakeSubmissionsResponse(req(admin), db, ENV);
    assert.equal(list[0].display_name, 'Ada');
    const shown = await intakeSubmissionsResponse(req(admin, 'POST', { action: 'reveal', id: 1 }), db, ENV);
    assert.equal(shown.password, 'temporary1');
    assert.deepEqual(revealed, [{ id: 1, actor: 'admin' }]);
    await assert.rejects(() => intakeSubmissionsResponse(req(seller, 'POST', { action: 'reveal', id: 1 }), db, ENV), /admin/);
    const cleared = await intakeSubmissionsResponse(req(admin, 'POST', { action: 'clear', id: 1 }), db, ENV);
    assert.equal(cleared.has_password, false);
    const approved = await intakeSubmissionsResponse(req(admin, 'POST', { action: 'approve', id: 1 }), db, ENV);
    assert.equal(approved.status, 'approved');
  });
});

describe('public intake page', () => {
  it('is a public, noindex form with required and optional sections and a profile photo', () => {
    const page = readFileSync(new URL('../app/intake/page.js', import.meta.url), 'utf8');
    const form = readFileSync(new URL('../components/public-intake-form.js', import.meta.url), 'utf8');
    const gate = readFileSync(new URL('../lib/gate.js', import.meta.url), 'utf8');
    assert.match(page, /index: false/);
    assert.match(page, /PublicIntakeForm/);
    assert.match(form, /Required/);
    assert.match(form, /Optional/);
    assert.match(form, /Name to show on WBW/);
    assert.match(form, /Temporary password for WBW registration/);
    assert.match(form, /Profile picture/);
    assert.match(form, /\/api\/public-intake/);
    assert.match(gate, /\/intake/);
    assert.match(gate, /\/api\/public-intake/);
  });
});

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { publicIntakeResponse } from '../app/api/public-intake/route.js';
import { intakeSubmissionsResponse } from '../app/api/intake-submissions/route.js';
import { decide } from '../lib/gate.js';
import { decryptSecret, encryptSecret, hasIntakeSecret, intakeKeyMaterial } from '../lib/intake-crypto.js';
import { HONEYPOT, isHoneypot, publicIntakeView, validatePublicIntake } from '../lib/public-intake.js';
import { EMAIL_PREFS, EMAIL_PREFS_INTRO, INTAKE_LIMITS, USERNAME_RE } from '../lib/public-intake-constants.js';
import { sessionToken } from '../lib/session.js';

const DEPOP = 'https://www.depop.com/westernbootworld/';
const SITE = 'https://adaboots.example/shop';
const ENV = { NODE_ENV: 'production', ADMIN_PASSWORD: 'staff-secret', APP_PASSWORD: 'signing-secret', INTAKE_SECRET: 'test-intake-secret' };
const valid = (extra = {}) => ({
  display_name: 'Ada Boots', username: 'ada_boots', email: 'ada@shop.test', depop: DEPOP,
  password: 'temporary1', password_confirm: 'temporary1',
  photo_ok: 'on', import_ok: 'on', ...extra,
});

describe('public intake access', () => {
  it('lets anyone open /intake and POST the form without logging in', async () => {
    assert.deepEqual(await decide('/intake', '', ENV), { type: 'next' });
    assert.deepEqual(await decide('/api/public-intake', '', ENV, 'POST'), { type: 'next' });
    assert.deepEqual(await decide('/api/public-intake', '', ENV, 'GET'), { type: 'json', status: 401, error: 'Please log in.' });
    // /api/intake is the signed-in seller update API, not the public form.
    assert.deepEqual(await decide('/api/intake', '', ENV, 'POST'), { type: 'json', status: 401, error: 'Please log in.' });
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
  it('round-trips with INTAKE_SECRET and fails closed without any key source', () => {
    assert.equal(hasIntakeSecret(ENV), true);
    assert.equal(hasIntakeSecret({}), false);
    const stored = encryptSecret('temporary1', ENV);
    assert.equal(stored.includes('temporary1'), false);
    assert.equal(decryptSecret(stored, ENV), 'temporary1');
    assert.throws(() => encryptSecret('temporary1', {}), /not taking submissions/);
    assert.throws(() => decryptSecret(stored, { INTAKE_SECRET: 'other-secret' }), /not available/);
  });

  it('derives the key from INTAKE_SECRET, else ADMIN_PASSWORD, else APP_PASSWORD, and does not need INTAKE_SECRET', () => {
    assert.equal(intakeKeyMaterial({ INTAKE_SECRET: 'intake', ADMIN_PASSWORD: 'admin', APP_PASSWORD: 'app' }), 'intake');
    assert.equal(intakeKeyMaterial({ ADMIN_PASSWORD: 'admin', APP_PASSWORD: 'app' }), 'admin');
    assert.equal(intakeKeyMaterial({ APP_PASSWORD: 'app' }), 'app');
    assert.equal(intakeKeyMaterial({}), '');
    const fromAdmin = encryptSecret('temporary1', { ADMIN_PASSWORD: 'staff-secret' });
    assert.equal(decryptSecret(fromAdmin, { ADMIN_PASSWORD: 'staff-secret' }), 'temporary1');
    const fromApp = encryptSecret('temporary1', { APP_PASSWORD: 'signing-secret' });
    assert.equal(decryptSecret(fromApp, { APP_PASSWORD: 'signing-secret' }), 'temporary1');
    const preferIntake = encryptSecret('temporary1', { INTAKE_SECRET: 'intake-secret', ADMIN_PASSWORD: 'staff-secret' });
    assert.equal(decryptSecret(preferIntake, { INTAKE_SECRET: 'intake-secret' }), 'temporary1');
    assert.throws(() => decryptSecret(preferIntake, { ADMIN_PASSWORD: 'staff-secret' }), /not available/);
    assert.throws(() => decryptSecret(fromAdmin, { APP_PASSWORD: 'signing-secret' }), /not available/);
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
  it('lets only an admin list, reveal, and clear, and audits reveal', async () => {
    const revealed = [];
    const db = {
      async list() { return [{ id: 1, display_name: 'Ada', has_password: true, status: 'pending' }]; },
      async reveal(id, actor) { revealed.push({ id, actor }); return { password: 'temporary1', display_name: 'Ada' }; },
      async clear(id, actor) { return { id, has_password: false, cleared_by: actor }; },
      async approve() { throw new Error('should not approve'); },
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
    await assert.rejects(() => intakeSubmissionsResponse(req(admin, 'POST', { action: 'approve', id: 1 }), db, ENV), /Unknown request/);
  });
});

describe('public intake page', () => {
  it('is a public, noindex form with required and optional sections and a profile photo', () => {
    const page = readFileSync(new URL('../app/intake/page.js', import.meta.url), 'utf8');
    const form = readFileSync(new URL('../components/public-intake-form.js', import.meta.url), 'utf8');
    const gate = readFileSync(new URL('../lib/gate.js', import.meta.url), 'utf8');
    const adminUi = readFileSync(new URL('../components/intake-submissions.js', import.meta.url), 'utf8');
    const store = readFileSync(new URL('../lib/public-intake-store.js', import.meta.url), 'utf8');
    assert.match(page, /index: false/);
    assert.match(page, /PublicIntakeForm/);
    assert.match(form, /Required/);
    assert.match(form, /Optional/);
    assert.match(form, /name to show on WBW/);
    assert.match(form, /Temporary password for WBW registration/);
    assert.match(form, /Profile photo/);
    assert.match(form, /\/api\/public-intake/);
    assert.doesNotMatch(form, /\/api\/intake['"]/);
    assert.match(gate, /\/intake/);
    assert.match(gate, /\/api\/public-intake/);
    assert.doesNotMatch(adminUi, /Approve into a seller/);
    assert.match(adminUi, /integrate later/);
    assert.doesNotMatch(store, /saveSeller/);
    assert.doesNotMatch(store, /approveIntake/);
    assert.doesNotMatch(store, /already on a seller/);
  });
});

describe('intake v2 fields', () => {
  it('requires a 3-20 character username of letters, numbers, or underscores', () => {
    assert.throws(() => validatePublicIntake(valid({ username: '' })), /username/i);
    assert.throws(() => validatePublicIntake(valid({ username: 'ab' })), /3 to 20/);
    assert.throws(() => validatePublicIntake(valid({ username: 'has space' })), /3 to 20/);
    assert.throws(() => validatePublicIntake(valid({ username: 'a'.repeat(21) })), /3 to 20/);
    assert.equal(validatePublicIntake(valid()).username, 'ada_boots');
    assert.match('ada_boots', USERNAME_RE);
    assert.doesNotMatch('ada-boots', USERNAME_RE);
  });

  it('stores the optional profile fields and blanks them as null', () => {
    const v = validatePublicIntake(valid({
      aliases: 'Ada, AB', bio: 'Vintage Luccheses', fun_fact: 'First pair 1994', sells_where: 'Depop',
      boot_types: 'Exotics', pairs_estimate: '40', notes: 'Ships Mondays',
    }));
    assert.deepEqual(
      [v.aliases, v.bio, v.fun_fact, v.sells_where, v.boot_types, v.pairs_estimate, v.notes],
      ['Ada, AB', 'Vintage Luccheses', 'First pair 1994', 'Depop', 'Exotics', '40', 'Ships Mondays'],
    );
    const blank = validatePublicIntake(valid());
    for (const k of ['aliases', 'bio', 'fun_fact', 'sells_where', 'boot_types', 'pairs_estimate', 'notes']) assert.equal(blank[k], null, k);
  });

  it('defaults every email preference on and honors unchecked boxes', () => {
    assert.deepEqual(validatePublicIntake(valid()).email_prefs, Object.fromEntries(EMAIL_PREFS.map(([k]) => [k, true])));
    assert.equal(EMAIL_PREFS.length, 5);
    const v = validatePublicIntake(valid({ email_prefs: { watching: false, messages: true, bogus: true } }));
    assert.equal(v.email_prefs.watching, false);
    assert.equal(v.email_prefs.messages, true);
    assert.equal('bogus' in v.email_prefs, false);
  });

  it('enforces a length limit on every text field', () => {
    for (const [k, max] of Object.entries(INTAKE_LIMITS)) {
      if (k === 'username' || k === 'email') continue;
      const extra = k in { depop: 1, facebook: 1, ebay: 1, poshmark: 1, website: 1 } ? `https://x.test/${'a'.repeat(max)}` : 'a'.repeat(max + 1);
      assert.throws(() => validatePublicIntake(valid({ [k]: extra })), /too long/i, k);
    }
  });

  it('shows the new fields on the admin view without the password', () => {
    const view = publicIntakeView({ id: 1, username: 'ada_boots', bio: 'b', email_prefs: { watching: true }, password_cipher: 'x' });
    assert.equal(view.username, 'ada_boots');
    assert.equal(view.bio, 'b');
    assert.deepEqual(view.email_prefs, { watching: true });
    assert.equal(JSON.stringify(view).includes('password_cipher'), false);
  });

  it('keeps the form browser-safe and split into Required and Optional sections', () => {
    const form = readFileSync(new URL('../components/public-intake-form.js', import.meta.url), 'utf8');
    const store = readFileSync(new URL('../lib/public-intake-store.js', import.meta.url), 'utf8');
    assert.doesNotMatch(form, /lib\/(public-intake|auth)['"]/);
    assert.match(form, /USERNAME_RE/);
    for (const s of ['Display name', 'Username', 'Best email to reach you', 'Aliases', 'Bio', 'Fun fact about you',
      'Where do you sell boots today?', 'What kind of boots do you deal in?', 'Roughly how many pairs would you list?',
      'Anything else we should know?', 'Email preferences', 'Profile photo']) assert.ok(form.includes(s), s);
    assert.ok(form.indexOf('Optional') < form.indexOf('Profile photo'));
    assert.match(store, /add column if not exists username/);
    assert.match(store, /add column if not exists email_prefs jsonb/);
  });
});

describe('email preference wording', () => {
  it("uses Dan's exact labels, helper text, and intro", () => {
    assert.deepEqual(EMAIL_PREFS.map(([, l]) => l), ["Email me about pairs I'm watching", 'Email me about buy-button holds',
      'Email me when somebody tags me in Community', 'Email me when somebody beats my Shootout high score', 'Email me about new messages']);
    assert.match(EMAIL_PREFS[1][2], /48-hour hold expires\.$/);
    assert.match(EMAIL_PREFS[4][2], /Your inbox and the bell show them either way\.$/);
    assert.equal(EMAIL_PREFS_INTRO, 'The bell in the header shows all of these, whether or not you take the email.');
    const form = readFileSync(new URL('../components/public-intake-form.js', import.meta.url), 'utf8');
    assert.match(form, /EMAIL_PREFS_INTRO/);
  });
});

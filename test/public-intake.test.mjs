import { TERMS_HEADING, TERMS_SOURCE, SELLER_TERMS } from '../lib/seller-terms.js';
import { newTermsToken, isTermsToken, validateAcceptance } from '../lib/terms-acceptance.js';
import { termsAcceptResponse } from '../app/api/terms-accept/route.js';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { publicIntakeResponse } from '../app/api/public-intake/route.js';
import { intakeCheckResponse } from '../app/api/public-intake/check/route.js';
import { intakeSubmissionsResponse } from '../app/api/intake-submissions/route.js';
import { decide } from '../lib/gate.js';
import { decryptSecret, encryptSecret, hasIntakeSecret, intakeKeyMaterial } from '../lib/intake-crypto.js';
import { HONEYPOT, isHoneypot, publicIntakeView, validatePublicIntake } from '../lib/public-intake.js';
import { DUPLICATE_MESSAGES, PAYMENT_METHODS, PRICE_FREQUENCIES, applicationsLabel, EMAIL_PREFS, EMAIL_PREFS_INTRO, INTAKE_LIMITS, USERNAME_RE } from '../lib/public-intake-constants.js';
import { sessionToken } from '../lib/session.js';

const DEPOP = 'https://www.depop.com/westernbootworld/';
const SITE = 'https://adaboots.example/shop';
const ENV = { NODE_ENV: 'production', ADMIN_PASSWORD: 'staff-secret', APP_PASSWORD: 'signing-secret', INTAKE_SECRET: 'test-intake-secret' };
const valid = (extra = {}) => ({
  display_name: 'Ada Boots', username: 'ada_boots', email: 'ada@shop.test',
  password: 'temporary1', import_mode: 'draft', has_wbw_account: 'no', ...extra,
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
  it('requires name, email, a temporary password, and the import choice', () => {
    assert.throws(() => validatePublicIntake({ ...valid(), display_name: '' }), /name to show on WBW/i);
    assert.throws(() => validatePublicIntake({ ...valid(), email: 'nope' }), /email/i);
    assert.throws(() => validatePublicIntake({ ...valid(), password: 'short' }), /at least 8/i);
    assert.throws(() => validatePublicIntake({ ...valid(), import_mode: '' }), /how we should import/i);
    assert.throws(() => validatePublicIntake({ ...valid(), import_mode: 'review' }), /how we should import/i);
    const v = validatePublicIntake(valid({ depop: DEPOP, website: SITE, phone: '5551234567', location: 'El Paso, TX' }));
    assert.equal(v.display_name, 'Ada Boots');
    assert.equal(v.email, 'ada@shop.test');
    assert.equal(v.fb_profile, DEPOP);
    assert.equal(v.website, SITE);
    assert.equal(v.phone, '+15551234567');
    assert.equal(v.location, 'El Paso, TX');
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
      if (['username', 'email', 'pricing_notes', 'payment_other', 'price_change_frequency_other'].includes(k)) continue; // covered in store policies
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
      'Where do you sell boots today?', 'What kind of boots do you deal in?', 'Roughly how many boots (and belts, if you sell them) do you have to list?',
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

describe('import mode', () => {
  it('requires live or draft, stores it, and shows it to the admin', () => {
    assert.equal(validatePublicIntake(valid({ import_mode: 'live' })).import_mode, 'live');
    assert.equal(validatePublicIntake(valid()).import_mode, 'draft');
    assert.equal(publicIntakeView({ id: 1, import_mode: 'live' }).import_mode, 'live');
    const form = readFileSync(new URL('../components/public-intake-form.js', import.meta.url), 'utf8');
    const page = readFileSync(new URL('../app/intake/page.js', import.meta.url), 'utf8');
    const consts = readFileSync(new URL('../lib/public-intake-constants.js', import.meta.url), 'utf8');
    const store = readFileSync(new URL('../lib/public-intake-store.js', import.meta.url), 'utf8');
    const adminUi = readFileSync(new URL('../components/intake-submissions.js', import.meta.url), 'utf8');
    assert.match(form, /How should we import your listings to Western Boot World\?/);
    assert.match(form, /type="radio"/);
    assert.match(consts, /Live — list them for sale right away/);
    assert.match(consts, /As drafts in my WBW account, so I can review them there first/);
    assert.doesNotMatch(form, /review them here|until you review|import_ok/);
    assert.doesNotMatch(page, /for review/);
    assert.match(store, /add column if not exists import_mode text/);
    assert.match(adminUi, /import_mode/);
  });
});

describe('trimmed intake (Dan, Nov 15 3:20 AM)', () => {
  it('needs no shop link, password confirmation, or consent checkbox', () => {
    const v = validatePublicIntake(valid({ password_confirm: 'different1', photo_ok: false, import_ok: false }));
    assert.equal(v.shop_links ?? null, null);
    assert.equal(v.password, 'temporary1');
    assert.throws(() => validatePublicIntake(valid({ password: 'x'.repeat(201) })), /too long/);
    assert.throws(() => validatePublicIntake(valid({ password: 'short' })), /at least 8/);
    const form = readFileSync(new URL('../components/public-intake-form.js', import.meta.url), 'utf8');
    assert.doesNotMatch(form, /Shop links|Depop shop|Confirm temporary password|password_confirm|photo_ok|type="checkbox"[^>]*required/);
    assert.match(form, /type="radio"/);
  });
});

describe('existing account check', () => {
  it('opens only GET /api/public-intake/check to the public', async () => {
    assert.deepEqual(await decide('/api/public-intake/check', '', ENV, 'GET'), { type: 'next' });
    assert.deepEqual(await decide('/api/public-intake/check', '', ENV, 'POST'), { type: 'json', status: 401, error: 'Please log in.' });
  });

  it('returns only a status, rate-limits, and validates input', async () => {
    const seen = [];
    const db = {
      async admit(key) { return { ok: !key.includes('blocked') }; },
      async check(q) { seen.push(q); return q.email === 'seller@shop.test' ? 'seller' : q.username === 'old_one' ? 'intake' : 'none'; },
    };
    const get = (qs, headers = {}) => new Request(`http://localhost/api/public-intake/check?${qs}`, { headers });
    assert.deepEqual(await intakeCheckResponse(get('email=Seller@Shop.test&username=x_y_z'), db), { status: 'seller' });
    assert.deepEqual(seen[0], { email: 'seller@shop.test', username: 'x_y_z' });
    assert.deepEqual(await intakeCheckResponse(get('username=old_one'), db), { status: 'intake' });
    assert.deepEqual(await intakeCheckResponse(get('email=new@shop.test'), db), { status: 'none' });
    await assert.rejects(() => intakeCheckResponse(get(''), db), /email or username/i);
    await assert.rejects(() => intakeCheckResponse(get('email=nope'), db), /email/i);
    await assert.rejects(() => intakeCheckResponse(get('email=a@b.test', { 'x-forwarded-for': 'blocked' }), db), /wait a bit/);
  });

  it('uses the same duplicate messages in the form and on the server', () => {
    assert.equal(DUPLICATE_MESSAGES.seller, 'You already have a BootLister account. Sign in here');
    assert.equal(DUPLICATE_MESSAGES.intake, 'We already have your intake, Dan will be in touch.');
    const form = readFileSync(new URL('../components/public-intake-form.js', import.meta.url), 'utf8');
    const store = readFileSync(new URL('../lib/public-intake-store.js', import.meta.url), 'utf8');
    assert.match(form, /\/api\/public-intake\/check/);
    assert.match(form, /onBlur/);
    assert.match(form, /Continue/);
    assert.match(form, /href="\/login"/);
    assert.match(store, /DUPLICATE_MESSAGES/);
    assert.match(store, /checkIntakeAccount\(v\)/);
  });
});

describe('existing WBW account question', () => {
  it('requires a yes/no answer and skips the password for yes', () => {
    assert.throws(() => validatePublicIntake(valid({ has_wbw_account: undefined })), /Western Boot World account/);
    const yes = validatePublicIntake(valid({ has_wbw_account: 'yes', password: '' }));
    assert.equal(yes.has_wbw_account, true);
    assert.equal(yes.password, null);
    const no = validatePublicIntake(valid({ has_wbw_account: 'no' }));
    assert.equal(no.has_wbw_account, false);
    assert.equal(no.password, 'temporary1');
    assert.throws(() => validatePublicIntake(valid({ has_wbw_account: 'no', password: '' })), /at least 8/);
    assert.equal(publicIntakeView({ id: 1, has_wbw_account: true }).has_wbw_account, true);
  });

  it('asks the question, explains the yes case, stores it, and shows it to the admin', () => {
    const form = readFileSync(new URL('../components/public-intake-form.js', import.meta.url), 'utf8');
    const store = readFileSync(new URL('../lib/public-intake-store.js', import.meta.url), 'utf8');
    const adminUi = readFileSync(new URL('../components/intake-submissions.js', import.meta.url), 'utf8');
    assert.match(form, /Do you already have a Western Boot World account\?/);
    assert.match(form, /No password needed\. We'll link your existing WBW account for you\./);
    assert.match(store, /add column if not exists has_wbw_account boolean/);
    assert.match(adminUi, /has_wbw_account/);
  });
});

describe('My Western Boot World account link', () => {
  it('links the WBW account page in a new tab on /intake, the thank-you, and the seller header', () => {
    const read = f => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
    assert.match(read('lib/wbw-account.js'), /https:\/\/www\.westernbootworld\.com\/me/);
    assert.match(read('lib/wbw-account.js'), /My Western Boot World account/);
    for (const f of ['app/intake/page.js', 'components/public-intake-form.js', 'app/screen.js']) {
      assert.match(read(f), /href=\{WBW_ACCOUNT_URL\} target="_blank" rel="noopener noreferrer"/, f);
    }
    assert.match(read('app/screen.js'), /!admin && <a className="src" href=\{WBW_ACCOUNT_URL\}/);
    const thanks = read('components/public-intake-form.js').split('if (done) return')[1].split('</div>')[0];
    assert.match(thanks, /WBW_ACCOUNT_URL/);
  });
});

describe('pending applications', () => {
  const admin = () => sessionToken('admin', ENV.APP_PASSWORD);
  const req = (token, method = 'GET', body, qs = '') => new Request(`http://localhost/api/intake-submissions${qs}`, {
    method, headers: { 'x-auth': token, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined,
  });
  it('counts pending applications for an admin only', async () => {
    const db = { async pending() { return 3; } };
    assert.deepEqual(await intakeSubmissionsResponse(req(await admin(), 'GET', null, '?count=1'), db, ENV), { pending: 3 });
    const seller = await sessionToken('seller:ada', ENV.APP_PASSWORD);
    await assert.rejects(() => intakeSubmissionsResponse(req(seller, 'GET', null, '?count=1'), db, ENV), /admin/);
  });
  it('approves or declines an application without creating a seller', async () => {
    const calls = [];
    const db = { async review(id, decision) { calls.push([id, decision]); return { id, status: decision }; } };
    const t = await admin();
    assert.deepEqual(await intakeSubmissionsResponse(req(t, 'POST', { action: 'review', id: 4, decision: 'approved' }), db, ENV), { id: 4, status: 'approved' });
    await intakeSubmissionsResponse(req(t, 'POST', { action: 'review', id: 4, decision: 'declined' }), db, ENV);
    await assert.rejects(() => intakeSubmissionsResponse(req(t, 'POST', { action: 'review', id: 4, decision: 'active' }), db, ENV), /approved or declined/);
    assert.deepEqual(calls, [[4, 'approved'], [4, 'declined']]);
    const store = readFileSync(new URL('../lib/public-intake-store.js', import.meta.url), 'utf8');
    assert.match(store, /status = 'pending' and email is not null/);
    assert.doesNotMatch(store, /insert into sellers/);
  });
  it('shows an "N new seller applications" banner on every admin page, linking to the pending list', () => {
    const read = f => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
    const banner = read('components/applications-banner.js');
    assert.match(banner, /applicationsLabel\(n\)/);
    assert.match(banner, /href="\/#applications"/);
    assert.match(banner, /\/api\/intake-submissions\?count=1/);
    assert.match(read('app/screen.js'), /admin && <ApplicationsBanner/);
    assert.match(read('app/admin/bugs/page.js'), /<ApplicationsBanner/);
    assert.match(read('components/intake-submissions.js'), /id="applications"/);
    assert.match(read('components/intake-submissions.js'), /decision: 'approved'/);
    assert.equal(applicationsLabel(1), '1 new seller application');
    assert.equal(applicationsLabel(3), '3 new seller applications');
  });
});

describe('store policies', () => {
  it('stores pricing, shipping, payment methods, and returns, all optional and length-limited', () => {
    const blank = validatePublicIntake(valid());
    for (const k of ['pricing_change', 'pricing_notes', 'shipping_policy', 'payment_methods', 'return_policy']) assert.equal(blank[k], null, k);
    const v = validatePublicIntake(valid({
      pricing_change: 'yes', pricing_notes: 'Drop 10%', shipping_policy: 'Ships in 2 days', return_policy: 'No returns',
      payment_methods: { methods: ['paypal', 'venmo', 'other', 'bogus'], other: 'Apple Pay' },
    }));
    assert.equal(v.pricing_change, 'yes');
    assert.equal(v.pricing_notes, 'Drop 10%');
    assert.deepEqual(v.payment_methods, { methods: ['paypal', 'venmo', 'other'], other: 'Apple Pay' });
    assert.equal(validatePublicIntake(valid({ pricing_change: 'no', pricing_notes: 'ignored' })).pricing_notes, null);
    assert.deepEqual(validatePublicIntake(valid({ payment_methods: { methods: ['cash'], other: 'x' } })).payment_methods, { methods: ['cash'], other: null });
    assert.throws(() => validatePublicIntake(valid({ pricing_change: 'maybe' })), /pricing/i);
    for (const k of ['pricing_notes', 'shipping_policy', 'return_policy']) {
      assert.throws(() => validatePublicIntake(valid({ pricing_change: 'yes', [k]: 'a'.repeat(INTAKE_LIMITS[k] + 1) })), /too long/, k);
    }
    assert.throws(() => validatePublicIntake(valid({ payment_methods: { methods: ['other'], other: 'a'.repeat(INTAKE_LIMITS.payment_other + 1) } })), /too long/);
    assert.deepEqual(PAYMENT_METHODS.map(([, l]) => l), ['Cash', 'Card', 'PayPal', 'Venmo', 'Cash App', 'Zelle', 'Other']);
  });
  it('asks the questions under Store policies, stores the columns, and shows them to the admin', () => {
    const read = f => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
    const form = read('components/public-intake-form.js');
    for (const s of ['Store policies', 'Do you want to change the pricing of your items?', 'No, keep my prices', 'What are your shipping policies?',
      'What payment methods do you accept?', 'What is your return policy?']) assert.ok(form.includes(s), s);
    const store = read('lib/public-intake-store.js');
    for (const c of ['pricing_change text', 'pricing_notes text', 'shipping_policy text', 'payment_methods jsonb', 'return_policy text']) assert.match(store, new RegExp(`add column if not exists ${c}`), c);
    const adminUi = read('components/intake-submissions.js');
    for (const c of ['pricing_change', 'shipping_policy', 'payment_methods', 'return_policy']) assert.match(adminUi, new RegExp(c), c);
    assert.equal(publicIntakeView({ id: 1, shipping_policy: 's', payment_methods: { methods: ['cash'] } }).shipping_policy, 's');
  });
});

describe('seller terms', () => {
  it('uses the full real Terms of Service with the requested credit', () => {
    assert.equal(TERMS_SOURCE, 'https://www.westernbootworld.com/terms');
    assert.equal(TERMS_HEADING, 'Western Boot World Terms of Service, last updated October 18, 2026, operated by Cornerstone Technology Group LLC dba Ergon Insights');
    assert.match(SELLER_TERMS, /^1\. What Western Boot World is \(and isn't\)/);
    assert.match(SELLER_TERMS, /2\. Who can use the site/);
    assert.match(SELLER_TERMS, /3\. Listing rules/);
    assert.match(SELLER_TERMS, /4\. Prohibited conduct: zero tolerance/);
    assert.match(SELLER_TERMS, /5\. Payments, holds, and disputes between members/);
    assert.match(SELLER_TERMS, /14\. Changes, governing law, and contact/);
    assert.match(SELLER_TERMS, /Questions, reports, or appeals: support@westernbootworld\.com\.$/);
    assert.match(SELLER_TERMS, /California Penal Code §653o/);
  });
  it('uses copyable terms with clipboard and select-all fallback, optionally appending an acceptance link', () => {
    const read = f => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
    const box = read('components/seller-terms.js');
    assert.match(box, /<details/);
    assert.match(box, /Copy terms/);
    assert.match(box, /navigator.clipboard/);
    assert.match(box, /\.select\(\)/);
    assert.match(box, /acceptanceUrl/);
    assert.match(read('app/intake/page.js'), /<SellerTerms/);
    assert.match(read('components/intake-submissions.js'), /<SellerTerms/);
  });
});

describe('terms acceptance', () => {
  it('validates the acceptance input and an unguessable token', () => {
    const token = newTermsToken();
    assert.equal(Buffer.from(token, 'base64url').length, 32);
    assert.notEqual(token, newTermsToken());
    assert.equal(isTermsToken(token), true);
    assert.equal(isTermsToken('no'), false);
    assert.deepEqual(validateAcceptance({ accepted: true, full_name: ' Ada Boots ' }), { full_name: 'Ada Boots' });
    assert.throws(() => validateAcceptance({ accepted: false, full_name: 'Ada' }), /accept/i);
    assert.throws(() => validateAcceptance({ accepted: true, full_name: '' }), /full name/i);
    assert.throws(() => validateAcceptance({ accepted: true, full_name: 'a'.repeat(201) }), /too long/i);
  });
  it('keeps the acceptance page/API public and the admin sent action admin-only', async () => {
    const token = newTermsToken();
    for (const [p, m] of [[`/terms/accept/${token}`, 'GET'], ['/api/terms-accept', 'GET'], ['/api/terms-accept', 'POST']]) {
      assert.deepEqual(await decide(p, '', ENV, m), { type: 'next' });
    }
    const admin = await sessionToken('admin', ENV.APP_PASSWORD);
    const seller = await sessionToken('seller:ada', ENV.APP_PASSWORD);
    const req = t => new Request('http://localhost/api/intake-submissions', { method: 'POST', headers: { 'x-auth': t }, body: JSON.stringify({ action: 'terms-sent', id: 1, sent: true }) });
    const db = { async sent(id, sent) { return { id, terms_sent_at: sent ? '2026-11-15' : null }; } };
    assert.deepEqual(await intakeSubmissionsResponse(req(admin), db, ENV), { id: 1, terms_sent_at: '2026-11-15' });
    await assert.rejects(() => intakeSubmissionsResponse(req(seller), db, ENV), /admin/);
  });
  it('shows only terms status publicly; accepts once and rate limits', async () => {
    const token = newTermsToken();
    let accepted = false;
    const db = { async admit() { return { ok: true }; }, async get(t) { return t === token ? { accepted_at: accepted ? '2026-11-15T08:00:00Z' : null } : null; }, async accept(t, v, meta) { assert.equal(v.full_name, 'Ada'); assert.equal(meta.ip, '1.2.3.4'); accepted = true; return { accepted_at: '2026-11-15T08:00:00Z' }; } };
    const get = t => new Request(`http://localhost/api/terms-accept?token=${t}`);
    assert.deepEqual(await termsAcceptResponse(get(token), db), { accepted_at: null });
    const post = new Request('http://localhost/api/terms-accept', { method: 'POST', headers: { 'x-forwarded-for': '1.2.3.4' }, body: JSON.stringify({ token, accepted: true, full_name: 'Ada' }) });
    assert.deepEqual(await termsAcceptResponse(post, db), { accepted_at: '2026-11-15T08:00:00Z' });
    await assert.rejects(() => termsAcceptResponse(get('bad'), db), /link is not valid/i);
    await assert.rejects(() => termsAcceptResponse(get(token), { ...db, async admit() { return { ok: false }; } }), /wait a bit/i);
  });
});

describe('intake store guards', () => {
  it('rejects duplicate submits before encrypting or writing and never updates a previous intake', async () => {
    const { useIntakeSql, submitPublicIntake } = await import('../lib/public-intake-store.js');
    for (const kind of ['seller', 'intake']) {
      const writes = [];
      const fake = async (ss, ...args) => {
        const q = ss.join('?').replace(/\s+/g, ' ').trim();
        if (/^select 1 from sellers/.test(q)) return kind === 'seller' ? [{}] : [];
        if (/^select 1 from seller_intake/.test(q)) return kind === 'intake' ? [{}] : [];
        if (/^(insert into|update) seller_intake/.test(q)) writes.push(q);
        return [];
      };
      useIntakeSql(fake);
      await assert.rejects(() => submitPublicIntake(valid(), { env: {} }), e => e.status === 409 && e.message === DUPLICATE_MESSAGES[kind]);
      assert.deepEqual(writes, []);
    }
    useIntakeSql(null);
  });

  it('stores a new application as pending with a random token, policies, and no password for an existing WBW account', async () => {
    const { useIntakeSql, submitPublicIntake } = await import('../lib/public-intake-store.js');
    let insert;
    useIntakeSql(async (ss, ...args) => {
      const q = ss.join('?').replace(/\s+/g, ' ').trim();
      if (/^insert into seller_intake/.test(q)) { insert = { q, args }; return [{ id: 9 }]; }
      return [];
    });
    assert.deepEqual(await submitPublicIntake(valid({ has_wbw_account: 'yes', password: '', shipping_policy: 'Ships Mondays' }), { env: {} }), { ok: true, updated: false, id: 9 });
    assert.match(insert.q, /values \('pending'/);
    assert.ok(insert.args.includes('Ships Mondays'));
    assert.ok(insert.args.includes(true));
    assert.ok(insert.args.some(isTermsToken));
    assert.equal(insert.args.includes('temporary1'), false);
    useIntakeSql(null);
  });

  it('records only first terms acceptance and leaves it unchanged on a second acceptance', async () => {
    const { acceptTerms, useIntakeSql } = await import('../lib/public-intake-store.js');
    const t = newTermsToken();
    let count = 0, saved;
    useIntakeSql(async (ss, ...args) => {
      const q = ss.join('?').replace(/\s+/g, ' ').trim();
      if (/^update seller_intake set terms_accepted_at/.test(q)) {
        assert.match(q, /terms_accepted_at is null/);
        if (count++) return [];
        saved = args;
        return [{ terms_accepted_at: '2026-11-15T08:00:00Z' }];
      }
      if (/^select terms_accepted_at/.test(q)) return [{ terms_accepted_at: '2026-11-15T08:00:00Z' }];
      return [];
    });
    await acceptTerms(t, { full_name: 'Ada' }, { ip: '127.0.0.1', ua: 'test agent' });
    assert.deepEqual(await acceptTerms(t, { full_name: 'Other' }, { ip: 'other' }), { accepted_at: '2026-11-15T08:00:00Z' });
    assert.deepEqual(saved, ['Ada', '127.0.0.1', 'test agent', t]);
    useIntakeSql(null);
  });
});

describe('belt selling and boot measurement', () => {
  it('stores the belt dealer flag only and the measurement method', () => {
    const blank = validatePublicIntake(valid());
    assert.equal(blank.sells_belts, null);
    assert.equal('belt_types' in blank, false);
    assert.equal(blank.measurement_method, null);
    const yes = validatePublicIntake(valid({ sells_belts: 'yes', belt_types: 'ignored', measurement_method: 'Brannock' }));
    assert.equal(yes.sells_belts, true);
    assert.equal('belt_types' in yes, false);
    assert.equal(yes.measurement_method, 'Brannock');
    assert.equal(validatePublicIntake(valid({ sells_belts: 'no' })).sells_belts, false);
    assert.throws(() => validatePublicIntake(valid({ sells_belts: 'maybe' })), /belts/i);
    assert.throws(() => validatePublicIntake(valid({ measurement_method: 'a'.repeat(INTAKE_LIMITS.measurement_method + 1) })), /too long/i);
    assert.equal('belt_types' in INTAKE_LIMITS, false);
  });
  it('asks the belts yes/no near boot types with no belt types field, and shows Belt dealer to admin', () => {
    const read = f => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
    const form = read('components/public-intake-form.js');
    assert.ok(form.includes('Do you also sell belts?'));
    assert.doesNotMatch(form, /What kind of belts\?|belt_types/);
    assert.ok(form.indexOf('Do you also sell belts?') > form.indexOf('What kind of boots do you deal in?'));
    assert.match(form, /How do you measure your boots\?<input \{\.\.\.field\('measurement_method'\)\} \/>/);
    assert.doesNotMatch(form, /Brannock|insole tracing/);
    assert.match(form, /Roughly how many boots \(and belts, if you sell them\) do you have to list\?<input placeholder="e\.g\. 40 boots, 10 belts" \{\.\.\.field\('pairs_estimate'\)\} \/>/);
    assert.doesNotMatch(form, /Roughly how many pairs/);
    const store = read('lib/public-intake-store.js');
    assert.ok(store.includes('add column if not exists sells_belts boolean'));
    assert.doesNotMatch(store, /belt_types/);
    for (const c of ['measurement_method text', 'encyclopedia_help boolean', 'encyclopedia_permission boolean', 'price_change_frequency text']) assert.ok(store.includes(`add column if not exists ${c}`), c);
    const admin = read('components/intake-submissions.js');
    assert.match(admin, /Belt dealer:/);
    assert.doesNotMatch(admin, /belt_types|Sells belts/);
  });
});

describe('boot encyclopedia and price frequency', () => {
  it('validates encyclopedia yes/no answers', () => {
    const blank = validatePublicIntake(valid());
    assert.equal(blank.encyclopedia_help, null);
    assert.equal(blank.encyclopedia_permission, null);
    const v = validatePublicIntake(valid({ encyclopedia_help: 'yes', encyclopedia_permission: 'no' }));
    assert.equal(v.encyclopedia_help, true);
    assert.equal(v.encyclopedia_permission, false);
    assert.throws(() => validatePublicIntake(valid({ encyclopedia_help: 'maybe' })), /encyclopedia/i);
    assert.throws(() => validatePublicIntake(valid({ encyclopedia_permission: 'sure' })), /encyclopedia/i);
  });
  it('validates price change frequency with a short Other text', () => {
    assert.equal(validatePublicIntake(valid()).price_change_frequency, null);
    assert.equal(validatePublicIntake(valid({ price_change_frequency: 'weekly' })).price_change_frequency, 'weekly');
    assert.equal(validatePublicIntake(valid({ price_change_frequency: 'other', price_change_frequency_other: 'Every season' })).price_change_frequency, 'other: Every season');
    assert.equal(validatePublicIntake(valid({ price_change_frequency: 'other' })).price_change_frequency, 'other');
    assert.throws(() => validatePublicIntake(valid({ price_change_frequency: 'hourly' })), /how often/i);
    assert.throws(() => validatePublicIntake(valid({ price_change_frequency: 'other', price_change_frequency_other: 'a'.repeat(INTAKE_LIMITS.price_change_frequency_other + 1) })), /too long/i);
    assert.deepEqual(PRICE_FREQUENCIES.map(([, l]) => l), ['Rarely or never', 'Monthly', 'Weekly', 'Daily', 'Other']);
  });
  it('asks the questions in the right sections and shows them to admin', () => {
    const read = f => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
    const form = read('components/public-intake-form.js');
    for (const q of ['Boot encyclopedia', 'Would you like to help build the Western Boot World boot encyclopedia?', 'May we use your photos and listing details in the boot encyclopedia?', 'How often do you change your prices?']) assert.ok(form.includes(q), q);
    assert.ok(form.indexOf('How often do you change your prices?') > form.indexOf('Do you want to change the pricing of your items?'));
    assert.ok(form.indexOf('How often do you change your prices?') < form.indexOf('What are your shipping policies?'));
    const admin = read('components/intake-submissions.js');
    for (const c of ['encyclopedia_help', 'encyclopedia_permission', 'price_change_frequency']) assert.ok(admin.includes(c), c);
    const view = publicIntakeView({ encyclopedia_help: true, encyclopedia_permission: false, price_change_frequency: 'daily' });
    assert.deepEqual([view.encyclopedia_help, view.encyclopedia_permission, view.price_change_frequency], [true, false, 'daily']);
  });
});

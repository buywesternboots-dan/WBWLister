import { bootListerOnly, WBW_SIGNUP_URL, wbwPolicyText, wbwSetupSections } from '../lib/wbw-account.js';
import { existsSync } from 'node:fs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { publicIntakeResponse } from '../app/api/public-intake/route.js';
import { intakeSubmissionsResponse } from '../app/api/intake-submissions/route.js';
import { decide } from '../lib/gate.js';
import { decryptSecret, encryptSecret, hasIntakeSecret, intakeKeyMaterial } from '../lib/intake-crypto.js';
import { HONEYPOT, isHoneypot, publicIntakeView, validatePublicIntake } from '../lib/public-intake.js';
import { DUPLICATE_MESSAGES, PAYMENT_METHODS, PRICE_FREQUENCIES, EMAIL_PREFS, EMAIL_PREFS_INTRO, INTAKE_LIMITS, USERNAME_RE } from '../lib/public-intake-constants.js';
import { sessionToken } from '../lib/session.js';

const DEPOP = 'https://www.depop.com/westernbootworld/';
const SITE = 'https://adaboots.example/shop';
const ENV = { NODE_ENV: 'production', ADMIN_PASSWORD: 'staff-secret', APP_PASSWORD: 'signing-secret', INTAKE_SECRET: 'test-intake-secret' };
const valid = (extra = {}) => ({
  display_name: 'Ada Boots', username: 'ada_boots', email: 'ada@shop.test',
  password: 'temporary1', import_mode: 'draft', has_wbw_account: 'no', ...extra,
});

describe('intake access (open form, no sign-in)', () => {
  it('lets anyone open /intake and POST the form; everything else stays behind a session', async () => {
    assert.deepEqual(await decide('/intake', '', ENV), { type: 'next' });
    assert.deepEqual(await decide('/api/public-intake', '', ENV, 'POST'), { type: 'next' });
    assert.deepEqual(await decide('/api/public-intake', '', ENV, 'GET'), { type: 'json', status: 401, error: 'Please log in.' });
    assert.deepEqual(await decide('/api/public-intake/check', '', ENV, 'GET'), { type: 'json', status: 401, error: 'Please log in.' });
    assert.deepEqual(await decide('/api/intake', '', ENV, 'POST'), { type: 'json', status: 401, error: 'Please log in.' });
    assert.deepEqual(await decide('/api/intake-submissions', '', ENV), { type: 'json', status: 401, error: 'Please log in.' });
    const seller = await sessionToken('seller:ada', ENV.APP_PASSWORD);
    assert.equal((await decide('/intake', seller, ENV)).type, 'next');
  });
  it('has no sign-in check on the page', () => {
    const page = readFileSync(new URL('../app/intake/page.js', import.meta.url), 'utf8');
    assert.doesNotMatch(page, /readSession|redirect\(|cookies\(/);
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
  });
});

describe('intake API (open)', () => {
  it('accepts a form with no session, drops honeypot posts, rate-limits, and returns only the new seller name', async () => {
    const submitted = [];
    const db = {
      async admit(key) { return key.includes('blocked') ? { ok: false } : { ok: true }; },
      async submit(body) { submitted.push(body); return { ok: true, id: 9, seller_name: 'ada_boots' }; },
    };
    const post = (body, headers = {}) => new Request('http://localhost/api/public-intake', {
      method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body),
    });
    const ok = await publicIntakeResponse(post(valid()), db, ENV);
    assert.deepEqual(ok, { ok: true, seller_name: 'ada_boots' });
    assert.equal(submitted.length, 1);
    assert.equal(JSON.stringify(ok).includes('temporary1'), false);
    assert.equal('id' in ok, false);
    const honey = await publicIntakeResponse(post(valid({ [HONEYPOT]: 'spam' })), db, ENV);
    assert.deepEqual(honey, { ok: true });
    assert.equal(submitted.length, 1);
    assert.equal(isHoneypot({ [HONEYPOT]: '' }), false);
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
      async create(id) { return { id, status: 'approved', seller_name: 'ada' }; },
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
    assert.equal((await intakeSubmissionsResponse(req(admin, 'POST', { action: 'create-seller', id: 1 }), db, ENV)).seller_name, 'ada');
    await assert.rejects(() => intakeSubmissionsResponse(req(seller, 'POST', { action: 'create-seller', id: 1 }), db, ENV), /admin/);
    for (const action of ['approve', 'review', 'invite', 'terms-sent']) {
      await assert.rejects(() => intakeSubmissionsResponse(req(admin, 'POST', { action, id: 1, decision: 'approved' }), db, ENV), /Unknown request/, action);
    }
  });
});

describe('intake page', () => {
  it('is a noindex open form with Required and Optional sections that saves and creates the seller', () => {
    const page = readFileSync(new URL('../app/intake/page.js', import.meta.url), 'utf8');
    const form = readFileSync(new URL('../components/public-intake-form.js', import.meta.url), 'utf8');
    const adminUi = readFileSync(new URL('../components/intake-submissions.js', import.meta.url), 'utf8');
    const store = readFileSync(new URL('../lib/public-intake-store.js', import.meta.url), 'utf8');
    assert.match(page, /index: false/);
    assert.match(page, /PublicIntakeForm/);
    assert.match(form, /Required/);
    assert.match(form, /Optional/);
    assert.match(form, /Seller’s display name/);
    assert.match(form, /Temporary WBW password/);
    assert.match(form, /Profile photo/);
    assert.match(form, /\/api\/public-intake['"]/);
    assert.match(form, /Save and create seller/);
    assert.match(form, /<WbwSetupPanel/);
    assert.match(form, /HONEYPOT/);
    assert.doesNotMatch(form, /\/api\/intake['"]|\/api\/public-intake\/check|Continue/);
    assert.match(adminUi, /Saving creates the BootLister seller/);
    assert.doesNotMatch(adminUi, /Approve application|>Decline<|Create intake link/);
    assert.match(store, /createSellerFromIntake\(row\.id/);
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
    for (const s of ['Seller’s display name', 'Ask: what username do you want?', 'Seller’s email', 'Ask: any other names you go by?',
      'Ask: how would you describe yourself to buyers?', 'Ask: what’s a fun fact about you?',
      'Ask: where do you sell boots today?', 'Ask: what kind of boots do you deal in?', 'Ask: roughly how many boots (and belts) do you have to list?',
      'Ask: anything else we should know?', 'Email preferences', 'Profile photo']) assert.ok(form.includes(s), s);
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
    assert.match(form, /Ask: should we import your listings live, or as drafts you review first\?/);
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

describe('duplicate check at submit', () => {
  it('rejects a duplicate email or username at save, with admin-facing messages; the public check endpoint is gone', () => {
    assert.equal(DUPLICATE_MESSAGES.seller, 'That email or username is already on BootLister. Sign in instead.');
    assert.equal(DUPLICATE_MESSAGES.intake, 'We already have an intake for that email or username. Dan will be in touch.');
    assert.equal(existsSync(new URL('../app/api/public-intake/check/route.js', import.meta.url)), false);
    const store = readFileSync(new URL('../lib/public-intake-store.js', import.meta.url), 'utf8');
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
    assert.throws(() => validatePublicIntake(valid({ has_wbw_account: 'no', password: 'nodigitshere' })), /needs a number/);
    assert.equal(publicIntakeView({ id: 1, has_wbw_account: true }).has_wbw_account, true);
  });

  it('asks the question, explains the yes case, stores it, and shows it to the admin', () => {
    const form = readFileSync(new URL('../components/public-intake-form.js', import.meta.url), 'utf8');
    const store = readFileSync(new URL('../lib/public-intake-store.js', import.meta.url), 'utf8');
    const adminUi = readFileSync(new URL('../components/intake-submissions.js', import.meta.url), 'utf8');
    assert.match(form, /Ask: do you already have a Western Boot World account\?/);
    assert.match(form, /No password needed\. Link their existing WBW account\./);
    assert.match(store, /add column if not exists has_wbw_account boolean/);
    assert.match(adminUi, /has_wbw_account/);
  });
});

describe('My Western Boot World account link', () => {
  it('keeps the WBW account link in the seller header', () => {
    const read = f => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
    assert.match(read('lib/wbw-account.js'), /https:\/\/www\.westernbootworld\.com\/me/);
    assert.match(read('app/screen.js'), /!admin && <a className="src" href=\{WBW_ACCOUNT_URL\}/);
  });
});

describe('no pending/approve step', () => {
  it('drops the applications banner, the count endpoint, and the approve/decline actions', async () => {
    const read = f => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
    assert.equal(existsSync(new URL('../components/applications-banner.js', import.meta.url)), false);
    assert.doesNotMatch(read('app/screen.js'), /ApplicationsBanner/);
    assert.doesNotMatch(read('app/admin/bugs/page.js'), /ApplicationsBanner/);
    const admin = await sessionToken('admin', ENV.APP_PASSWORD);
    const db = { async list() { return []; }, async pending() { throw new Error('no count'); } };
    const req = new Request('http://localhost/api/intake-submissions?count=1', { headers: { 'x-auth': admin } });
    assert.deepEqual(await intakeSubmissionsResponse(req, db, ENV), []);
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
    for (const s of ['Store policies', 'Ask: do you want your prices changed when we import?', 'No, keep my prices', 'Ask: what’s your shipping policy?',
      'Ask: what payment methods do you take?', 'Ask: what’s your return policy?']) assert.ok(form.includes(s), s);
    const store = read('lib/public-intake-store.js');
    for (const c of ['pricing_change text', 'pricing_notes text', 'shipping_policy text', 'payment_methods jsonb', 'return_policy text']) assert.match(store, new RegExp(`add column if not exists ${c}`), c);
    const setup = read('lib/wbw-account.js');
    for (const c of ['pricing_change', 'shipping_policy', 'payment_methods', 'return_policy']) assert.match(setup, new RegExp(c), c);
    assert.equal(publicIntakeView({ id: 1, shipping_policy: 's', payment_methods: { methods: ['cash'] } }).shipping_policy, 's');
  });
});

describe('terms step removed', () => {
  it('has no terms text, copy button, Terms sent checkbox, acceptance portal, or API', async () => {
    for (const f of ['lib/seller-terms.js', 'components/seller-terms.js', 'lib/terms-acceptance.js', 'app/terms/accept/[token]/page.js', 'app/api/terms-accept/route.js']) {
      assert.equal(existsSync(new URL(`../${f}`, import.meta.url)), false, f);
    }
    const read = f => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
    for (const f of ['app/intake/page.js', 'components/public-intake-form.js', 'components/intake-submissions.js', 'lib/gate.js', 'lib/public-intake.js', 'lib/public-intake-store.js']) {
      assert.doesNotMatch(read(f), /SellerTerms|terms_token|terms_sent|terms-accept|terms\/accept|Terms sent/, f);
    }
    assert.deepEqual(await decide('/api/terms-accept', '', ENV, 'POST'), { type: 'json', status: 401, error: 'Please log in.' });
    assert.deepEqual(await decide('/terms/accept/abc', '', ENV), { type: 'redirect', to: '/login' });
    assert.equal('terms_url' in publicIntakeView({ id: 1, terms_token: 't' }), false);
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

  it('saves the sheet, creates the seller right away, and stores no password for an existing WBW account', async () => {
    const { useIntakeSql, submitPublicIntake } = await import('../lib/public-intake-store.js');
    let insert, status;
    const saved = [];
    useIntakeSql(async (ss, ...args) => {
      const q = ss.join('?').replace(/\s+/g, ' ').trim();
      if (/^insert into seller_intake/.test(q)) { insert = { q, args }; return [{ id: 9, email: 'ada@shop.test', username: 'ada_boots', display_name: 'Ada Boots', seller_name: null }]; }
      if (/^select name, email from sellers/.test(q)) return [];
      if (/^update seller_intake set status/.test(q)) { status = args; return [{ id: 9, status: args[0], seller_name: args[1] }]; }
      return [];
    });
    const out = await submitPublicIntake(valid({ has_wbw_account: 'yes', password: '', shipping_policy: 'Ships Mondays' }), { env: {}, save: async p => { saved.push(p); return { name: p.name }; } });
    assert.deepEqual(out, { ok: true, id: 9, seller_name: 'ada_boots' });
    assert.ok(insert.args.includes('Ships Mondays'));
    assert.ok(insert.args.includes(true));
    assert.equal(insert.args.includes('temporary1'), false);
    assert.deepEqual(status, ['approved', 'ada_boots', 9]);
    assert.equal(saved.length, 1);
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
    assert.ok(form.includes('Ask: do you also sell belts?'));
    assert.doesNotMatch(form, /What kind of belts\?|belt_types/);
    assert.ok(form.indexOf('Ask: do you also sell belts?') > form.indexOf('Ask: what kind of boots do you deal in?'));
    assert.match(form, /Ask: how do you measure your boots\?<input \{\.\.\.field\('measurement_method'\)\} \/>/);
    assert.doesNotMatch(form, /Brannock|insole tracing/);
    assert.match(form, /Ask: roughly how many boots \(and belts\) do you have to list\?<input placeholder="e\.g\. 40 boots, 10 belts" \{\.\.\.field\('pairs_estimate'\)\} \/>/);
    assert.doesNotMatch(form, /Roughly how many pairs/);
    const store = read('lib/public-intake-store.js');
    assert.ok(store.includes('add column if not exists sells_belts boolean'));
    assert.doesNotMatch(store, /belt_types/);
    for (const c of ['measurement_method text', 'encyclopedia_help boolean', 'encyclopedia_permission boolean', 'price_change_frequency text']) assert.ok(store.includes(`add column if not exists ${c}`), c);
    const admin = read('components/intake-submissions.js');
    assert.match(admin, /Belt dealer:/);
    assert.doesNotMatch(admin, /belt_types/);
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
    for (const q of ['Boot encyclopedia', 'Ask: would you like to help build the WBW boot encyclopedia?', 'Ask: may we use your photos and listing details in the encyclopedia?', 'Ask: how often do you change prices?']) assert.ok(form.includes(q), q);
    assert.ok(form.indexOf('Ask: how often do you change prices?') > form.indexOf('Ask: do you want your prices changed when we import?'));
    assert.ok(form.indexOf('Ask: how often do you change prices?') < form.indexOf('Ask: what’s your shipping policy?'));
    const admin = read('components/intake-submissions.js');
    for (const c of ['encyclopedia_help', 'encyclopedia_permission', 'price_change_frequency']) assert.ok(admin.includes(c), c);
    const view = publicIntakeView({ encyclopedia_help: true, encyclopedia_permission: false, price_change_frequency: 'daily' });
    assert.deepEqual([view.encyclopedia_help, view.encyclopedia_permission, view.price_change_frequency], [true, false, 'daily']);
  });
});

describe('create the seller from an intake (idempotent)', () => {
  const app = (extra = {}) => ({ id: 7, status: 'pending', display_name: 'Ada Boots', username: 'Ada_Boots', email: 'ada@shop.test', phone: null,
    location: 'El Paso, TX', bio: 'Vintage', website: null, fb_profile: null, shop_links: null, terms: null, defaults: null, brand_context: 'on',
    photo_url: null, photo_key: null, seller_name: null, ...extra });
  // Tiny fake of the two tables this path touches.
  const fakeDb = (row, sellers = []) => {
    const state = { row: { ...row }, sellers: sellers.map(s => ({ ...s })), saved: [] };
    const sql = async (ss, ...a) => {
      const q = ss.join('?').replace(/\s+/g, ' ').trim();
      if (/^select \* from seller_intake where id/.test(q)) return [state.row];
      if (/^select name, email from sellers/.test(q)) return state.sellers;
      if (/^update seller_intake set status/.test(q)) { Object.assign(state.row, { status: a[0], seller_name: a[1] ?? state.row.seller_name }); return [state.row]; }
      if (/^update sellers set profile_photo/.test(q)) return [];
      return [];
    };
    const save = async p => {
      state.saved.push(p);
      const i = state.sellers.findIndex(x => x.name === p.name);
      if (i >= 0) state.sellers[i] = { ...state.sellers[i], ...p }; else state.sellers.push({ name: p.name, email: p.email });
      return { name: p.name };
    };
    return { state, sql, save };
  };

  it('creates one seller from the intake data and links the intake row', async () => {
    const { useIntakeSql, createSellerFromIntake } = await import('../lib/public-intake-store.js');
    const db = fakeDb(app());
    useIntakeSql(db.sql);
    const out = await createSellerFromIntake(7, { save: db.save });
    assert.equal(out.status, 'approved');
    assert.equal(out.seller_name, 'ada_boots');
    assert.equal(db.state.sellers.length, 1);
    const p = db.state.saved[0];
    assert.deepEqual([p.name, p.display_name, p.email, p.location], ['ada_boots', 'Ada Boots', 'ada@shop.test', 'El Paso, TX']);
    assert.equal('password' in p, false);
    useIntakeSql(null);
  });

  it('is idempotent: running twice does not create a second seller', async () => {
    const { useIntakeSql, createSellerFromIntake } = await import('../lib/public-intake-store.js');
    const db = fakeDb(app());
    useIntakeSql(db.sql);
    await createSellerFromIntake(7, { save: db.save });
    await createSellerFromIntake(7, { save: db.save });
    assert.equal(db.state.sellers.length, 1);
    assert.equal(db.state.saved.length, 1);
    assert.equal(db.state.row.seller_name, 'ada_boots');
    useIntakeSql(null);
  });

  it('links to an existing seller with the same email instead of duplicating, and avoids a name clash', async () => {
    const { useIntakeSql, createSellerFromIntake } = await import('../lib/public-intake-store.js');
    let db = fakeDb(app(), [{ name: 'ada_old', email: 'ADA@shop.test' }]);
    useIntakeSql(db.sql);
    assert.equal((await createSellerFromIntake(7, { save: db.save })).seller_name, 'ada_old');
    assert.equal(db.state.sellers.length, 1);
    assert.equal(db.state.saved.length, 0);
    db = fakeDb(app(), [{ name: 'ada_boots', email: 'someone@else.test' }]);
    useIntakeSql(db.sql);
    assert.equal((await createSellerFromIntake(7, { save: db.save })).seller_name, 'ada_boots-2');
    assert.equal(db.state.sellers.length, 2);
    useIntakeSql(null);
  });

});

describe('WBW account setup panel', () => {
  const row = { display_name: 'Ada', username: 'ada_b', email: 'a@b.test', phone: '+15551234567', location: 'TX', bio: 'Hi', aliases: 'AB', fun_fact: 'F',
    has_wbw_account: 'no', shipping_policy: 'Ships Mon', return_policy: 'No returns', payment_methods: { methods: ['paypal', 'other'], other: 'Apple Pay' },
    email_prefs: { watching: true, holds: false, community_tags: true, shootout: true, messages: true }, sells_belts: 'yes', import_mode: 'draft' };
  it('maps each answer to the WBW field label, in WBW order', () => {
    const secs = wbwSetupSections(row, { password: 'temporary1' });
    assert.deepEqual(secs.map(x => x.key), ['signup', 'profile', 'policies', 'notifications', 'application']);
    const labels = Object.fromEntries(secs.map(x => [x.key, x.fields.map(f => f.label)]));
    assert.deepEqual(labels.signup, ['Email address', 'Password', 'Confirm password', 'I’m 18 or older and agree to the Terms and Privacy Policy.']);
    assert.deepEqual(labels.profile, ['Display name', 'Username', 'Aliases', 'Location', 'Bio', 'Fun fact about you']);
    assert.deepEqual(labels.policies, ['Shipping & return policies', 'Phone', 'Email']);
    assert.deepEqual(labels.notifications, EMAIL_PREFS.map(([, l]) => l));
    const signup = secs[0].fields;
    assert.equal(signup[1].value, 'temporary1');
    assert.equal(signup[2].value, 'temporary1');
    assert.equal(signup[3].copy, false);
    assert.equal(secs[3].fields[1].value, 'Off');
    assert.equal(wbwPolicyText(row), 'Shipping: Ships Mon · Returns: No returns · Preferred payment: PayPal, Apple Pay');
    assert.equal(secs[1].fields.find(f => f.key === 'bio').max, 280);
    assert.equal(secs[2].fields[0].max, 400);
  });
  it('skips sign-up for an existing WBW account and lists BootLister-only answers', () => {
    const secs = wbwSetupSections({ ...row, has_wbw_account: true });
    assert.equal(secs.some(x => x.key === 'signup'), false);
    const only = Object.fromEntries(bootListerOnly(row));
    assert.equal(only['Sells belts'], 'Yes');
    assert.equal(only['Import listings'], 'Drafts');
    assert.equal(only['Already has a WBW account'], 'No');
    assert.equal(WBW_SIGNUP_URL, 'https://www.westernbootworld.com/');
  });
  it('renders the Create WBW account link and copy buttons without automating WBW', () => {
    const ui = readFileSync(new URL('../components/wbw-setup-panel.js', import.meta.url), 'utf8');
    assert.match(ui, /href=\{WBW_SIGNUP_URL\} target="_blank" rel="noopener noreferrer"/);
    assert.match(ui, />Create WBW account</);
    assert.match(ui, /WBW_SIGNUP_HINT/);
    assert.match(ui, /navigator\.clipboard\.writeText/);
    assert.doesNotMatch(ui, /fetch\(/);
    const admin = readFileSync(new URL('../components/intake-submissions.js', import.meta.url), 'utf8');
    assert.match(admin, /<WbwSetupPanel row=\{r\}/);
    assert.match(admin, /action: 'reveal'/);
  });
});

describe('password show/hide', () => {
  it('has an accessible eye toggle on the temporary password, which only shows when there is no WBW account', () => {
    const form = readFileSync(new URL('../components/public-intake-form.js', import.meta.url), 'utf8');
    assert.match(form, /type="button" className="eye"/);
    assert.match(form, /'Hide password' : 'Show password'/);
    assert.match(form, /type=\{showPw \? 'text' : 'password'\}/);
    const block = form.split("form.has_wbw_account === 'no' && <label>Temporary WBW password")[1].split('</label>}')[0];
    assert.match(block, /className="eye"/);
  });
});

describe('result panel shows only this submission', () => {
  it('builds the WBW panel from the browser’s own answers; the API returns no other intake data', () => {
    const form = readFileSync(new URL('../components/public-intake-form.js', import.meta.url), 'utf8');
    const done = form.split('if (done) {')[1].split('return (')[0];
    assert.match(done, /const row = \{ \.\.\.form,/);
    assert.doesNotMatch(form, /intake-submissions|fetch\([^)]*GET/);
    const panel = readFileSync(new URL('../components/wbw-setup-panel.js', import.meta.url), 'utf8');
    assert.doesNotMatch(panel, /fetch\(/);
    const route = readFileSync(new URL('../app/api/public-intake/route.js', import.meta.url), 'utf8');
    assert.match(route, /return \{ ok: true, seller_name: out\?\.seller_name \?\? null \}/);
  });
});

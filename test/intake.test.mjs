import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { intakeApi } from '../app/api/intake/route.js';
import { applyIntake, intakeLabel, intakePatch, intakeStatus } from '../lib/intake.js';
import { packShopLinks, parseShopLinks } from '../lib/seller-links.js';
import { sessionToken } from '../lib/session.js';

const DEPOP = 'https://www.depop.com/westernbootworld/';
const FACEBOOK = 'https://www.facebook.com/marketplace/profile/1661843737/';
const EBAY = 'https://www.ebay.com/usr/ada-boots';
const POSH = 'https://poshmark.com/closet/ada';
const SITE = 'https://adaboots.example/shop';
const ENV = { NODE_ENV: 'production', ADMIN_PASSWORD: 'staff-secret', APP_PASSWORD: 'signing-secret' };

describe('shop link intake mapping', () => {
  it('maps Facebook and Depop into fb_profile and keeps the extra link in shop_links', () => {
    const packed = packShopLinks({ facebook: FACEBOOK, depop: DEPOP, website: SITE });
    assert.equal(packed.fb_profile, FACEBOOK);
    assert.equal(packed.website, SITE);
    assert.deepEqual(JSON.parse(packed.shop_links), { depop: DEPOP, facebook: FACEBOOK, website: SITE });
    const parsed = parseShopLinks(packed);
    assert.equal(parsed.depop, DEPOP);
    assert.equal(parsed.facebook, FACEBOOK);
    assert.equal(parsed.website, SITE);
  });

  it('keeps eBay and Poshmark when a website already fills the website field', () => {
    const packed = packShopLinks({ website: SITE, ebay: EBAY, poshmark: POSH });
    assert.equal(packed.website, SITE);
    assert.equal(packed.fb_profile, null);
    const links = JSON.parse(packed.shop_links);
    assert.equal(links.ebay, EBAY);
    assert.equal(links.poshmark, POSH);
    assert.equal(links.website, SITE);
    assert.deepEqual(parseShopLinks(packed), { depop: '', facebook: '', ebay: EBAY, poshmark: POSH, website: SITE });
  });

  it('folds older website and fb_profile values into the intake fields', () => {
    assert.deepEqual(parseShopLinks({ website: EBAY, fb_profile: DEPOP }), {
      depop: DEPOP, facebook: '', ebay: EBAY, poshmark: '', website: '',
    });
  });
});

describe('intake completion status', () => {
  it('lists what is missing until shop links and both consent checks are done', () => {
    assert.deepEqual(intakeStatus({}), { done: false, missing: ['shop links', 'photo OK', 'import OK'] });
    assert.equal(intakeLabel(intakeStatus({})), 'Intake: missing shop links, photo OK, import OK');
    const mid = intakeStatus({ website: SITE, photo_ok: 'on' });
    assert.deepEqual(mid, { done: false, missing: ['import OK'] });
    assert.equal(intakeLabel(mid), 'Intake: missing import OK');
    const done = intakeStatus({ website: SITE, photo_ok: 'on', import_ok: 'on' });
    assert.deepEqual(done, { done: true, missing: [] });
    assert.equal(intakeLabel(done), 'Intake: done');
  });

  it('treats terms, defaults, and brand context as optional and defaults brand context to on', () => {
    const done = intakeStatus({ fb_profile: DEPOP, photo_ok: 'on', import_ok: 'yes' });
    assert.equal(done.done, true);
    assert.ok(!done.missing.includes('terms'));
    assert.ok(!done.missing.includes('defaults'));
  });
});

describe('intake save merge', () => {
  it('updates intake fields and never blanks other seller settings', () => {
    const row = {
      name: 'ada', display_name: 'Ada Boots', contact: 'Ada', email: 'ada@shop.test',
      phone: '5551234567', location: 'El Paso, TX', notes: 'Keep these notes', sync: 'weekly',
      ship_price: '12', handle_days: '3', return_days: '14', website: SITE, terms: 'Old = Term',
    };
    const next = applyIntake(row, {
      depop: DEPOP, facebook: FACEBOOK, ebay: EBAY, terms: 'BJ = Black Jack',
      defaults: 'sized_for = Women', brand_context: 'off', photo_ok: true, import_ok: 'on',
    });
    assert.equal(next.contact, 'Ada');
    assert.equal(next.email, 'ada@shop.test');
    assert.equal(next.phone, '5551234567');
    assert.equal(next.location, 'El Paso, TX');
    assert.equal(next.notes, 'Keep these notes');
    assert.equal(next.sync, 'weekly');
    assert.equal(next.ship_price, '12');
    assert.equal(next.handle_days, '3');
    assert.equal(next.return_days, '14');
    assert.equal(next.display_name, 'Ada Boots');
    assert.equal(next.fb_profile, FACEBOOK);
    assert.equal(next.website, SITE);
    assert.equal(next.terms, 'BJ = Black Jack');
    assert.equal(next.defaults, 'sized_for = Women');
    assert.equal(next.brand_context, 'off');
    assert.equal(next.photo_ok, 'on');
    assert.equal(next.import_ok, 'on');
    assert.deepEqual(JSON.parse(next.shop_links), { depop: DEPOP, facebook: FACEBOOK, ebay: EBAY, website: SITE });
  });

  it('omits unsent fields so a later save cannot clear them', () => {
    const row = { name: 'ada', website: SITE, terms: 'BJ = Black Jack', defaults: 'sized_for = Women', photo_ok: 'on', import_ok: 'on', notes: 'secret' };
    const patch = intakePatch(row, { photo_ok: 'on' });
    assert.equal('terms' in patch, false);
    assert.equal('defaults' in patch, false);
    assert.equal('website' in patch, false);
    assert.equal('notes' in patch, false);
    assert.equal(applyIntake(row, { photo_ok: 'on' }).terms, 'BJ = Black Jack');
    assert.equal(applyIntake(row, { photo_ok: 'on' }).notes, 'secret');
    assert.equal(applyIntake(row, { terms: '' }).terms, null);
  });
});

describe('intake API', () => {
  it('lets a seller save their own intake and refuses another seller; an admin can save for the selected seller', async () => {
    const rows = {
      ada: { name: 'ada', display_name: 'Ada', notes: 'Keep me', sync: 'off', contact: 'Ada' },
      bea: { name: 'bea', display_name: 'Bea' },
    };
    const saved = [];
    const db = {
      async saveSellerIntake(name, p) {
        if (!rows[name]) throw new Error('Set up this seller first.');
        const next = applyIntake(rows[name], p);
        rows[name] = next;
        saved.push({ name, p, next });
        return next;
      },
    };
    const ada = await sessionToken('seller:ada', ENV.APP_PASSWORD);
    const bea = await sessionToken('seller:bea', ENV.APP_PASSWORD);
    const admin = await sessionToken('admin', ENV.APP_PASSWORD);
    const req = (token, body, seller) => new Request('http://localhost/api/intake', {
      method: 'POST',
      headers: { 'x-auth': token, 'content-type': 'application/json', ...(seller ? { authorization: `Bearer ${seller}` } : {}) },
      body: JSON.stringify(body),
    });
    await assert.rejects(() => intakeApi(new Request('http://localhost/api/intake', { method: 'POST', body: '{}' }), db, ENV), /log in/);
    const own = await intakeApi(req(ada, { depop: DEPOP, photo_ok: 'on', import_ok: 'on' }), db, ENV);
    assert.equal(own.name, 'ada');
    assert.equal(own.fb_profile, DEPOP);
    assert.equal(own.notes, 'Keep me');
    assert.equal(own.contact, 'Ada');
    assert.equal(own.photo_ok, 'on');
    await assert.rejects(() => intakeApi(req(bea, { depop: DEPOP }, 'ada'), db, ENV), /your own items/);
    const asAdmin = await intakeApi(req(admin, { brand_context: 'off', photo_ok: 'on' }, 'ada'), db, ENV);
    assert.equal(asAdmin.name, 'ada');
    assert.equal(asAdmin.brand_context, 'off');
    assert.equal(asAdmin.notes, 'Keep me');
    assert.equal(saved.filter(s => s.name === 'ada').length, 2);
    assert.equal(saved.some(s => s.name === 'bea'), false);
    await assert.rejects(() => intakeApi(req(admin, { photo_ok: 'on' }), db, ENV), /Pick a seller/);
  });
});

describe('intake form', () => {
  it('is a short seller form that does not re-ask WBW profile fields', () => {
    const src = readFileSync(new URL('../components/intake-form.js', import.meta.url), 'utf8');
    const screen = readFileSync(new URL('../app/screen.js', import.meta.url), 'utf8');
    assert.match(src, /Shop links/);
    assert.match(src, /Listing habits/);
    assert.match(src, /I own these photos/);
    assert.match(src, /Nothing goes live until I approve it/);
    assert.match(src, /WBW profile already has/);
    assert.equal(src.includes('Contact person'), false);
    assert.equal(/Location \(city, state\)/.test(src), false);
    assert.equal(src.includes('Shipping price'), false);
    assert.match(screen, /IntakeForm/);
    assert.match(screen, /intakeLabel/);
    assert.match(screen, /Seller intake/);
    assert.match(screen, /\/api\/intake/);
  });
});

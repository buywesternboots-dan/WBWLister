import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { isExtensionShop, sellerFormState, sellerSavePayload, shopLinkFields, shopLinkState } from '../lib/seller-links.js';

const DEPOP = 'https://www.depop.com/westernbootworld/';
const FACEBOOK = 'https://www.facebook.com/marketplace/profile/1661843737/';
const EBAY = 'https://www.ebay.com/usr/ada-boots';
const SITE = 'https://adaboots.example/shop';

describe('shop link routing', () => {
  it('sends Facebook and Depop URLs to fb_profile and keeps them there for the extension', () => {
    assert.equal(isExtensionShop(DEPOP), true);
    assert.equal(isExtensionShop(FACEBOOK), true);
    assert.equal(isExtensionShop(EBAY), false);
    assert.deepEqual(shopLinkFields({ shop_link: DEPOP }), { website: null, fb_profile: DEPOP });
    assert.deepEqual(shopLinkFields({ shop_link: FACEBOOK }), { website: null, fb_profile: FACEBOOK });
  });

  it('sends website, Poshmark, and eBay URLs to website', () => {
    assert.deepEqual(shopLinkFields({ shop_link: SITE }), { website: SITE, fb_profile: null });
    assert.deepEqual(shopLinkFields({ shop_link: EBAY }), { website: EBAY, fb_profile: null });
    assert.deepEqual(shopLinkFields({ shop_link: 'https://poshmark.com/closet/ada' }), {
      website: 'https://poshmark.com/closet/ada', fb_profile: null,
    });
  });

  it('routes two links by URL, in either order', () => {
    assert.deepEqual(shopLinkFields({ shop_link: SITE, shop_link_2: DEPOP }), { website: SITE, fb_profile: DEPOP });
    assert.deepEqual(shopLinkFields({ shop_link: DEPOP, shop_link_2: SITE }), { website: SITE, fb_profile: DEPOP });
  });

  it('moves a shop link from website to fb_profile when it is changed to a Depop URL', () => {
    const form = sellerFormState({ website: SITE, fb_profile: null });
    assert.equal(form.shop_link, SITE);
    assert.deepEqual(shopLinkFields({ ...form, shop_link: DEPOP }), { website: null, fb_profile: DEPOP });
  });

  it('clears both stored links when the shop link fields are emptied', () => {
    assert.deepEqual(shopLinkFields({ shop_link: '', shop_link_2: '' }), { website: null, fb_profile: null });
  });
});

describe('shop link form state', () => {
  it('shows a single stored link in the visible shop field', () => {
    assert.deepEqual(shopLinkState({ website: SITE }), { shop_link: SITE, shop_link_2: '' });
    assert.deepEqual(shopLinkState({ fb_profile: DEPOP }), { shop_link: DEPOP, shop_link_2: '' });
    assert.deepEqual(shopLinkState({}), { shop_link: '', shop_link_2: '' });
  });

  it('puts website in the visible field and the Facebook or Depop link under Advanced when both exist', () => {
    assert.deepEqual(shopLinkState({ website: SITE, fb_profile: DEPOP }), { shop_link: SITE, shop_link_2: DEPOP });
  });
});

describe('seller save payload', () => {
  it('preserves contact, notes, and sync that the form no longer shows', () => {
    const form = sellerFormState({
      name: 'ada',
      display_name: 'Ada Boots',
      contact: 'Ada',
      email: 'ada@shop.test',
      notes: 'Writes short listings',
      sync: 'weekly',
      website: SITE,
      fb_profile: DEPOP,
    });
    const body = sellerSavePayload(form, { rename_from: 'ada' });
    assert.equal(body.contact, 'Ada');
    assert.equal(body.notes, 'Writes short listings');
    assert.equal(body.sync, 'weekly');
    assert.equal(body.website, SITE);
    assert.equal(body.fb_profile, DEPOP);
    assert.equal(body.rename_from, 'ada');
    assert.equal('shop_link' in body, false);
    assert.equal('shop_link_2' in body, false);
  });

  it('does not blank hidden fields when only visible fields are edited', () => {
    const form = sellerFormState({
      name: 'ada',
      display_name: 'Ada Boots',
      contact: 'Ada',
      notes: 'Keep me',
      sync: 'daily',
      terms: 'BJ = Black Jack',
      website: SITE,
    });
    form.display_name = 'Ada’s Shop';
    form.shop_link = EBAY;
    const body = sellerSavePayload(form);
    assert.equal(body.display_name, 'Ada’s Shop');
    assert.equal(body.website, EBAY);
    assert.equal(body.fb_profile, null);
    assert.equal(body.contact, 'Ada');
    assert.equal(body.notes, 'Keep me');
    assert.equal(body.sync, 'daily');
    assert.equal(body.terms, 'BJ = Black Jack');
  });
});

describe('seller settings form', () => {
  it('shows the short form and hides contact, notes, and automatic sync', () => {
    const src = readFileSync(new URL('../app/screen.js', import.meta.url), 'utf8');
    assert.match(src, /Shop link/);
    assert.match(src, /Seller login/);
    assert.match(src, /<summary>Advanced<\/summary>/);
    assert.match(src, /sellerSavePayload/);
    assert.equal(src.includes('Contact person'), false);
    assert.equal(src.includes('Automatic sync'), false);
    assert.equal(src.includes('Notes (how this seller writes listings)'), false);
  });
});

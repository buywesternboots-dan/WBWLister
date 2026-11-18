import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { SELLER_FIELDS } from '../lib/wbw.js';
import { WBW_STATUS_FLAGS, WBW_STATUS_PENDING, wbwSellerStatus, withWbwStatus } from '../lib/wbw-status.js';

const read = p => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('an unsynced seller shows three Pending WBW API badges', () => {
  const status = wbwSellerStatus({ name: 'ada', display_name: 'Ada' });
  assert.equal(status.pending, true);
  assert.equal(status.source, null);
  assert.equal(status.last_checked, null);
  assert.equal(status.badges.length, 3);
  assert.deepEqual(status.badges.map(b => b.label), [
    'Signed up for WBW',
    'Accepted as a seller',
    'Phone verified',
  ]);
  assert.deepEqual(status.badges.map(b => b.key), ['signed_up', 'accepted', 'phone_verified']);
  for (const b of status.badges) {
    assert.equal(b.text, 'Pending WBW API');
    assert.equal(b.text, WBW_STATUS_PENDING);
    assert.equal(b.value, null);
  }
});

test('after an API sync, badges use the stored flags and keep source plus last_checked', () => {
  const row = {
    wbw_signed_up: true,
    wbw_accepted: false,
    wbw_phone_verified: true,
    wbw_status_source: 'wbw-api',
    wbw_status_checked_at: '2026-11-16T16:00:00.000Z',
  };
  const status = wbwSellerStatus(row);
  assert.equal(status.pending, false);
  assert.equal(status.source, 'wbw-api');
  assert.equal(status.last_checked, '2026-11-16T16:00:00.000Z');
  assert.deepEqual(status.badges.map(b => [b.key, b.text, b.value]), [
    ['signed_up', 'Yes', true],
    ['accepted', 'No', false],
    ['phone_verified', 'Yes', true],
  ]);
  const wrapped = withWbwStatus({ name: 'ada', ...row });
  assert.equal(wrapped.name, 'ada');
  assert.equal(wrapped.wbw_status.source, 'wbw-api');
});

test('flags without last_checked stay pending so a partial row is not treated as a sync', () => {
  const status = wbwSellerStatus({ wbw_signed_up: true, wbw_accepted: true, wbw_phone_verified: true });
  assert.equal(status.pending, true);
  assert.ok(status.badges.every(b => b.text === 'Pending WBW API' && b.value == null));
});

test('the sellers schema is ready for a later API sync and the admin form cannot write those fields', () => {
  const wbw = read('lib/wbw.js');
  assert.match(wbw, /add column if not exists wbw_signed_up boolean/);
  assert.match(wbw, /add column if not exists wbw_accepted boolean/);
  assert.match(wbw, /add column if not exists wbw_phone_verified boolean/);
  assert.match(wbw, /add column if not exists wbw_status_source text/);
  assert.match(wbw, /add column if not exists wbw_status_checked_at timestamptz/);
  assert.match(wbw, /withWbwStatus/);
  for (const col of ['wbw_signed_up', 'wbw_accepted', 'wbw_phone_verified', 'wbw_status_source', 'wbw_status_checked_at']) {
    assert.equal(SELLER_FIELDS.includes(col), false, col);
  }
  assert.deepEqual(WBW_STATUS_FLAGS.map(f => f.field), ['wbw_signed_up', 'wbw_accepted', 'wbw_phone_verified']);
});

test('badges show only for the selected seller, not as a list of every seller', () => {
  const screen = read('app/screen.js');
  assert.match(screen, /function WbwStatusBadges/);
  assert.match(screen, /data-wbw-status-detail/);
  assert.match(screen, /where="detail"/);
  assert.match(screen, /wbwSellerStatus/);
  assert.equal(screen.includes('data-seller-list'), false);
  assert.equal(screen.includes('where="list"'), false);
  assert.equal(screen.includes('wbw_signed_up'), false);
  assert.equal(/type="checkbox"[^>]*wbw|wbw[^=]*type="checkbox"/.test(screen), false);
  assert.equal(screen.includes('setWbwStatus'), false);
  assert.equal(screen.includes('action: \'wbw-status\''), false);
  assert.match(screen, /admin && current\?\.name && <div className="wbw-seller-status-detail"/);
  assert.equal(screen.includes('sellers.filter(s => s.name).map'), false);
  assert.equal(screen.includes('{!admin && <WbwStatusBadges'), false);
});

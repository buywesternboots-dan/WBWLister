import test from 'node:test';
import assert from 'node:assert/strict';
import { approvalRecord, assertCanPublish, blocksApproval, clearedApproval, liveRecord, needsCheck, pushStub, REQUIRED } from '../lib/publish';

const ready = { id: 7, price: 100, title: 'Boot', brand: 'Ariat', sized_for: 'Men', condition: 'New', approved_at: '2026-01-02T00:00:00.000Z', approved_by: 'ada@shop.test', status: 'published' };

test('approving a listing publishes it immediately through the mock export', () => {
  const live = liveRecord('  Ada@Shop.TEST ', '2026-10-22T00:00:00.000Z');
  assert.equal(live.status, 'published');
  assert.equal(live.status_at, '2026-10-22T00:00:00.000Z');
  assert.equal(live.approved_by, 'ada@shop.test');
  assert.equal(live.approved_at, live.status_at);
  assert.deepEqual(live.guessed, []);
  assert.equal(needsCheck(live), false);
  assert.deepEqual(pushStub([live]), { export: 'stub', sync: 'stub', pushed: 1 });
  assert.throws(() => approvalRecord('ada'), /sign-in email/);
});

test('a listing needs the seller check until it has an approver, and a seller edit clears that', () => {
  assert.equal(needsCheck({ title: 'Boot' }), true);
  assert.equal(needsCheck(ready), false);
  assert.deepEqual(clearedApproval, { approved_at: null, approved_by: null });
});

test('approval waits for the required fields, including ones the seller just typed', () => {
  assert.deepEqual(blocksApproval({ ...ready, brand: '  ' }), ['brand']);
  assert.deepEqual(blocksApproval(ready), []);
  assert.deepEqual(REQUIRED, ['price', 'title', 'brand', 'sized_for', 'condition']);
});

test('a direct publish still cannot skip the seller check', () => {
  assert.doesNotThrow(() => assertCanPublish('seller', [ready]));
  assert.doesNotThrow(() => assertCanPublish('admin', [ready]));
  assert.throws(() => assertCanPublish('seller', [{ title: 'Bare' }]), /1 item still needs the seller's check/);
  assert.throws(() => assertCanPublish('admin', [ready, { title: 'Bare' }]), /1 item still needs the seller's check/);
  assert.throws(() => assertCanPublish('guest', [ready]), /Sign in/);
});

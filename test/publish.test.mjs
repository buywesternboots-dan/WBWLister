import test from 'node:test';
import assert from 'node:assert/strict';
import { approvalRecord, assertCanPublish, blocksApproval, canPublish, clearedApproval, needsCheck, pushStub, REQUIRED } from '../lib/publish';

const ready = { id: 7, price: 100, title: 'Boot', brand: 'Ariat', sized_for: 'Men', condition: 'New', approved_at: '2026-01-02T00:00:00.000Z', approved_by: 'ada@shop.test' };

test('the seller and the admin can each push an approved item', () => {
  assert.equal(canPublish('admin'), true);
  assert.equal(canPublish('seller'), true);
  assert.equal(canPublish('guest'), false);
});

test('a listing needs the seller check until it has an approver, and an edit clears that', () => {
  assert.equal(needsCheck({ title: 'Boot' }), true);
  assert.equal(needsCheck(ready), false);
  assert.deepEqual(clearedApproval, { approved_at: null, approved_by: null });
  const stamp = approvalRecord('  Ada@Shop.TEST ');
  assert.equal(stamp.approved_by, 'ada@shop.test');
  assert.deepEqual(stamp.guessed, []);
  assert.throws(() => approvalRecord('ada'), /sign-in email/);
});

test('approval waits for the required fields, including ones the seller just typed', () => {
  assert.deepEqual(blocksApproval({ ...ready, brand: '  ' }), ['brand']);
  assert.deepEqual(blocksApproval(ready), []);
  assert.deepEqual(REQUIRED, ['price', 'title', 'brand', 'sized_for', 'condition']);
});

test('one approved item can be pushed right away, and an unapproved item cannot', () => {
  assert.doesNotThrow(() => assertCanPublish('seller', [ready]));
  assert.doesNotThrow(() => assertCanPublish('admin', [ready]));
  assert.throws(() => assertCanPublish('seller', [{ title: 'Bare' }]), /1 item still needs the seller's check/);
  assert.throws(() => assertCanPublish('admin', [ready, { title: 'Bare' }]), /1 item still needs the seller's check/);
  assert.throws(() => assertCanPublish('guest', [ready]), /Sign in/);
  assert.deepEqual(pushStub([ready]), { export: 'stub', sync: 'stub', pushed: 1 });
});

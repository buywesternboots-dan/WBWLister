import test from 'node:test';
import assert from 'node:assert/strict';
import { approvalRecord, assertCanPublish, blocksApproval, canPublish, clearedApproval, needsCheck, PUBLISH_BY, REQUIRED } from '../lib/publish';

const ready = { price: 100, title: 'Boot', brand: 'Ariat', sized_for: 'Men', condition: 'New', approved_at: '2026-01-02T00:00:00.000Z', approved_by: 'ada@shop.test' };

test('the default is that the admin publishes, and that switch is one constant', () => {
  assert.equal(PUBLISH_BY, 'admin');
  assert.equal(canPublish('admin'), true);
  assert.equal(canPublish('seller'), false);
  assert.equal(canPublish('seller', 'seller'), true);
  assert.equal(canPublish('admin', 'seller'), true);
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

test('only a seller-approved item can be published, and a seller does not publish while the switch says admin', () => {
  assert.doesNotThrow(() => assertCanPublish('admin', [ready]));
  assert.throws(() => assertCanPublish('admin', [ready, { title: 'Bare' }]), /1 item still needs the seller's check/);
  assert.throws(() => assertCanPublish('admin', [{}, {}]), /2 items still need the seller's check/);
  assert.throws(() => assertCanPublish('seller', [ready]), /admin publishes/);
  assert.doesNotThrow(() => assertCanPublish('seller', [ready], 'seller'));
  assert.throws(() => assertCanPublish('seller', [{ title: 'Bare' }], 'seller'), /seller's check/);
});

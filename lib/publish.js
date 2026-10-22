// Seller approval publishes that item immediately. There is no second click and no admin step.
// This MVP does not talk to WBW. pushStub is the export and sync stand-in: the item is marked exported here.

// Required before a seller can approve. Same fields the edit form marks with *.
export const REQUIRED = ['price', 'title', 'brand', 'sized_for', 'condition'];

export const needsCheck = item => !item?.approved_at;
export const blocksApproval = item => REQUIRED.filter(f => item?.[f] === undefined || item?.[f] === null || String(item[f]).trim() === '');

export const approvalRecord = email => {
  const who = String(email ?? '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(who)) throw new Error('This seller has no sign-in email.');
  return { approved_by: who, guessed: [] };
};

// Approving is publishing. The mock layer marks the item exported; nothing is sent to WBW.
export const liveRecord = (email, at = new Date().toISOString()) => ({ ...approvalRecord(email), approved_at: at, status: 'published', status_at: at, changed_at: null });

// A later edit, price change, or source change sends the item back for another check.
export const clearedApproval = { approved_at: null, approved_by: null };

export const canPublish = role => role === 'admin' || role === 'seller';

// A direct publish still cannot skip the seller's check. Approval itself is what publishes.
export function assertCanPublish(role, items) {
  if (!canPublish(role)) throw new Error('Sign in to push an item live.');
  const waiting = (items ?? []).filter(needsCheck).length;
  if (waiting) throw new Error(waiting === 1 ? '1 item still needs the seller\'s check.' : `${waiting} items still need the seller's check.`);
}

// Local stand-in for export and sync. No request leaves this app.
export const pushStub = items => ({ export: 'stub', sync: 'stub', pushed: (items ?? []).length });

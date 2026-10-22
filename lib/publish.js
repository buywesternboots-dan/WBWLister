// Seller approval, then a one-item push. The seller or the admin can push an approved item right then.
// This MVP does not talk to WBW. pushStub is the export and sync stand-in.

// Required before a seller can approve. Same fields the edit form marks with *.
export const REQUIRED = ['price', 'title', 'brand', 'sized_for', 'condition'];

export const needsCheck = item => !item?.approved_at;
export const blocksApproval = item => REQUIRED.filter(f => item?.[f] === undefined || item?.[f] === null || String(item[f]).trim() === '');

export const approvalRecord = email => {
  const who = String(email ?? '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(who)) throw new Error('This seller has no sign-in email.');
  return { approved_by: who, guessed: [] };
};

// A later edit, price change, or source change sends the item back for another check.
export const clearedApproval = { approved_at: null, approved_by: null };

export const canPublish = role => role === 'admin' || role === 'seller';

// Each approved item can be pushed on its own. Unapproved items stay blocked.
export function assertCanPublish(role, items) {
  if (!canPublish(role)) throw new Error('Sign in to push an item live.');
  const waiting = (items ?? []).filter(needsCheck).length;
  if (waiting) throw new Error(waiting === 1 ? '1 item still needs the seller\'s check.' : `${waiting} items still need the seller's check.`);
}

// Local stand-in for export and sync. No request leaves this app.
export const pushStub = items => ({ export: 'stub', sync: 'stub', pushed: (items ?? []).length });

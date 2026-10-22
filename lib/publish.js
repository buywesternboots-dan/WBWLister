// Seller approval, then who pushes the item live.
// PUBLISH_BY is the switch: 'admin' (default) — the admin exports/publishes after the seller approves.
// Change it to 'seller' and the seller can export their own approved items too.
export const PUBLISH_BY = 'admin';

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

export const canPublish = (role, by = PUBLISH_BY) => by === 'seller' || role === 'admin';

// role is 'admin' or 'seller'. items need approved_at. Throws instead of publishing.
export function assertCanPublish(role, items, by = PUBLISH_BY) {
  if (!canPublish(role, by)) throw new Error('The admin publishes approved items.');
  const waiting = (items ?? []).filter(needsCheck).length;
  if (waiting) throw new Error(waiting === 1 ? '1 item still needs the seller\'s check.' : `${waiting} items still need the seller's check.`);
}

import { blocksApproval, needsCheck } from './publish';

export const missingFields = blocksApproval;
export const unverifiedFields = item => (item?.guessed ?? []).filter(field => String(item?.[field] ?? '').trim());
// Complete fields and approval are separate steps. Only both make a CSV-ready item.
export const exportReady = item => !needsCheck(item) && !missingFields(item).length && !unverifiedFields(item).length;

// Toggle only the currently visible group; preserve choices in every other group.
export function toggleVisibleSelection(selected, visible) {
  const next = new Set(selected);
  const clear = visible.length > 0 && visible.every(item => next.has(item.id));
  for (const item of visible) clear ? next.delete(item.id) : next.add(item.id);
  return next;
}

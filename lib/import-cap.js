// How many listing creates one import job may make. The number is applied in the database,
// not in a process-local map, so a second instance sees the same count.
// Blank or invalid means every eligible boot, still inside this bound.
export const IMPORT_WRITE_CAP = 100;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function clampImportLimit(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) return IMPORT_WRITE_CAP;
  return Math.min(n, IMPORT_WRITE_CAP);
}

export function nextImportCount(current, jobId, cap = IMPORT_WRITE_CAP) {
  const job = String(jobId || '').trim();
  if (!UUID.test(job)) {
    const err = new Error('This import write is missing its job.');
    err.status = 400;
    throw err;
  }
  const limit = clampImportLimit(cap);
  const n = Number(current) || 0;
  if (n >= limit) {
    const err = new Error(`This import already used its ${limit} listing writes.`);
    err.status = 429;
    throw err;
  }
  return n + 1;
}

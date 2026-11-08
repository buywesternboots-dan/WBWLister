// How many listing creates one import job may make. The number is applied in the database,
// not in a process-local map, so a second instance sees the same count.
export const IMPORT_WRITE_CAP = 2;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function nextImportCount(current, jobId) {
  const job = String(jobId || '').trim();
  if (!UUID.test(job)) {
    const err = new Error('This import write is missing its job.');
    err.status = 400;
    throw err;
  }
  const n = Number(current) || 0;
  if (n >= IMPORT_WRITE_CAP) {
    const err = new Error('This import already used its 2 listing writes.');
    err.status = 429;
    throw err;
  }
  return n + 1;
}

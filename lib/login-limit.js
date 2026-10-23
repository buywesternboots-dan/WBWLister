// Failed sign-ins. 8 per 15 minutes, counted separately for the IP and for the account.
export const MAX_ATTEMPTS = 8;
export const WINDOW_MS = 15 * 60 * 1000;

export function underLimit(rows, now = Date.now()) {
  return (rows ?? []).every(row => !row || now - Number(row.start) >= WINDOW_MS || Number(row.n) < MAX_ATTEMPTS);
}

export function bump(row, now = Date.now()) {
  if (!row || now - Number(row.start) >= WINDOW_MS) return { n: 1, start: now };
  return { n: Number(row.n) + 1, start: Number(row.start) };
}

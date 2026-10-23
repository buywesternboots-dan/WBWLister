// One CSV cell. A leading = + - or @ would be a formula in Excel, so those are quoted as text.
export function csvCell(v) {
  const s = String(Array.isArray(v) ? v.join('|') : v ?? '');
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
}

// One CSV cell. A leading = + - @, tab, or CR would be a formula in Excel, so those are quoted as text.
// A description that starts with "- " is prose, not a formula.
export function csvCell(v) {
  const s = String(Array.isArray(v) ? v.join('|') : v ?? '');
  const safe = /^[\t\r=+\-@]/.test(s) && !s.startsWith('- ') ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
}

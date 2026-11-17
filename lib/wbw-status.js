// WBW seller status placeholders until the WBW API can sync them.
// No writes and no toggles live here. A later API pass should set the three flags plus source and last_checked.

export const WBW_STATUS_PENDING = 'Pending WBW API';

export const WBW_STATUS_FLAGS = [
  { key: 'signed_up', field: 'wbw_signed_up', label: 'Signed up for WBW' },
  { key: 'accepted', field: 'wbw_accepted', label: 'Accepted as a seller' },
  { key: 'phone_verified', field: 'wbw_phone_verified', label: 'Phone verified' },
];

function flagValue(row, field, known) {
  if (!known) return null;
  const v = row?.[field];
  if (v === true || v === 't' || v === 'true' || v === 'yes' || v === 1) return true;
  if (v === false || v === 'f' || v === 'false' || v === 'no' || v === 0) return false;
  return null;
}

// Reads the stored API-sync columns on a sellers row. Until last_checked is set, every badge is pending.
export function wbwSellerStatus(row = {}) {
  const source = row.wbw_status_source != null && String(row.wbw_status_source).trim() !== ''
    ? String(row.wbw_status_source).trim() : null;
  const last_checked = row.wbw_status_checked_at ?? row.last_checked ?? null;
  const known = last_checked != null && String(last_checked).trim() !== '';
  const badges = WBW_STATUS_FLAGS.map(({ key, field, label }) => {
    const value = flagValue(row, field, known);
    return {
      key, label, value,
      text: value == null ? WBW_STATUS_PENDING : (value ? 'Yes' : 'No'),
    };
  });
  return { source, last_checked: known ? last_checked : null, pending: badges.every(b => b.value == null), badges };
}

export function withWbwStatus(row) {
  if (!row) return row;
  return { ...row, wbw_status: wbwSellerStatus(row) };
}

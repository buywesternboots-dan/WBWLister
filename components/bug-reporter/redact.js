// Runs on the cloned document html2canvas paints. The live page is left alone.
const PRIVATE = '[data-private], [data-sensitive]';
const HINT = /password|passwd|pwd|invite|token|secret|\bpin\b|e-?mail|phone|\btel\b|contact|username/i;

export function isSensitiveControl(el) {
  if (!el) return false;
  if (typeof el.closest === 'function' && el.closest(PRIVATE)) return true;
  if (el.hasAttribute?.('data-private') || el.hasAttribute?.('data-sensitive')) return true;
  const type = String(el.getAttribute?.('type') || el.type || '').toLowerCase();
  if (type === 'password' || type === 'email' || type === 'tel' || type === 'hidden') return true;
  const hint = ['name', 'id', 'placeholder', 'autocomplete', 'aria-label'].map(k => el.getAttribute?.(k) || '').join(' ');
  return HINT.test(hint);
}

export function redactClone(root) {
  if (!root?.querySelectorAll) return root;
  root.querySelectorAll('input, textarea, select').forEach(el => {
    if (!isSensitiveControl(el)) return;
    if ('value' in el) el.value = '';
    el.setAttribute?.('value', '');
    const tag = String(el.tagName || '').toLowerCase();
    if (tag === 'textarea') el.textContent = '';
  });
  root.querySelectorAll(PRIVATE).forEach(el => {
    el.removeAttribute?.('title');
    el.textContent = '';
  });
  return root;
}

// Page links stored with a bug report. Query secrets and fragments are dropped before anything is saved or shown.
const MAX_URL = 2000;
const SENSITIVE_NAME = /invite|password|passwd|pwd|secret|token|phone|e-?mail|contact/;

export function sensitiveQuery(name) {
  const key = String(name ?? '').trim().toLowerCase().replace(/-/g, '_');
  if (!key) return false;
  if (/^(invite|password|passwd|pwd|token|secret|pin|email|phone|tel|contact|session|auth|code|access_token|refresh_token|id_token|api_key|apikey)$/.test(key)) return true;
  return SENSITIVE_NAME.test(key);
}

// origin, when passed, rejects any other site. Hash, userinfo, and sensitive query keys are always removed.
export function redactPageUrl(value, origin) {
  let url;
  try { url = new URL(value); } catch { return ''; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
  if (origin && url.origin !== origin) return '';
  url.hash = '';
  url.username = '';
  url.password = '';
  for (const key of [...url.searchParams.keys()]) {
    if (sensitiveQuery(key)) url.searchParams.delete(key);
  }
  const href = url.origin + url.pathname + url.search;
  return href.length > MAX_URL ? '' : href;
}

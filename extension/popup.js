const $ = id => document.getElementById(id);
const PROFILE = /marketplace\/profile\/(\d+)/;
chrome.storage.sync.get(['server', 'seller'], s => { $('server').value = s.server || ''; $('seller').value = s.seller || 'demo'; });
chrome.tabs.query({ active: true, currentWindow: true }, ([t]) => { if (PROFILE.test(t.url)) $('profileUrl').value = t.url; });
// Fill the profile link from the seller's saved details.
$('seller').onchange = async () => {
  const name = $('seller').value.trim().toLowerCase(), server = $('server').value.trim().replace(/\/$/, '');
  const s = (await (await fetch(`${server}/api/sellers`)).json().catch(() => [])).find?.(s => s.seller === name);
  $('status').textContent = s?.name ? '' : 'No details saved for this seller yet — add them on the inventory page first.';
  if (s?.fb_profile && !$('profileUrl').value) $('profileUrl').value = s.fb_profile;
};

const show = () => chrome.storage.local.get(['log', 'progress'], s => {
  if (s.log) $('log').textContent = s.log.join('\n');
  const p = s.progress;
  $('bar').style.display = p ? '' : 'none'; $('barLabel').textContent = p ? `${p.done} of ${p.total} — ${p.label}` : '';
  if (p) Object.assign($('bar'), { value: p.done, max: p.total });
});
show(); chrome.storage.onChanged.addListener(show);

async function start(type, sync) {
  await chrome.storage.sync.set({ server: $('server').value.trim(), seller: $('seller').value.trim() });
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const sellerId = $('profileUrl').value.trim().match(PROFILE)?.[1];
  if (type === 'profile' && !sellerId) return $('status').textContent = 'Paste a Marketplace profile link (facebook.com/marketplace/profile/…).';
  if (type === 'listing' && !/marketplace\/item\//.test(tab.url)) return $('status').textContent = 'Open a Marketplace listing first.';
  $('status').textContent = type === 'profile' ? 'Working. You can close this; the icon shows items left.' : 'Adding…';
  const { r, error } = await chrome.runtime.sendMessage({ type, tabId: tab.id, sellerId, sync });
  $('status').textContent = error || (type === 'profile'
    ? `Done: ${r.added} added, ${r.updated} updated, ${r.removed} removed, ${r.failed} failed.`
    : r.duplicate ? 'Already imported.' : 'Added.');
}

$('profile').onclick = () => start('profile', false);
$('sync').onclick = () => start('profile', true);
$('listing').onclick = () => start('listing');

const $ = id => document.getElementById(id);
const PROFILE = /marketplace\/profile\/(\d+)/, DEPOP = /depop\.com\/(?!products\/)([\w.-]+)/;
// Seller dropdown from the server; picking one fills in their saved Facebook/Depop link.
let sellers = [];
const loadSellers = async saved => {
  const server = $('server').value.trim().replace(/\/$/, '');
  if (!server) return;
  sellers = await (await fetch(`${server}/api/sellers`, { headers: { 'x-app-password': $('password').value } })).json().catch(() => []);
  if (!Array.isArray(sellers)) return $('status').textContent = sellers.error ?? 'Could not load sellers.';
  $('seller').innerHTML = '<option value="">Pick a seller…</option>' + sellers.filter(s => s.name)
    .map(s => `<option value="${s.name}">${s.display_name}</option>`).join('');
  if (saved) $('seller').value = saved;
};
chrome.storage.sync.get(['server', 'seller', 'password'], async s => {
  $('server').value = s.server || ''; $('password').value = s.password || '';
  await loadSellers(s.seller);
});
$('server').onchange = $('password').onchange = () => loadSellers($('seller').value);
chrome.tabs.query({ active: true, currentWindow: true }, ([t]) => { if (PROFILE.test(t.url) || DEPOP.test(t.url)) $('profileUrl').value = t.url; });
$('seller').onchange = () => {
  const s = sellers.find(s => s.name === $('seller').value);
  $('profileUrl').value = s?.fb_profile ?? '';
  $('status').textContent = s && !s.fb_profile ? 'No Facebook/Depop link saved for this seller — add it in Seller settings, or paste one here.' : '';
};

const show = () => chrome.storage.local.get(['log', 'progress'], s => {
  if (s.log) $('log').textContent = s.log.join('\n');
  const p = s.progress;
  $('bar').style.display = p ? '' : 'none'; $('barLabel').textContent = p ? `${p.done} of ${p.total} — ${p.label}` : '';
  if (p) Object.assign($('bar'), { value: p.done, max: p.total });
});
show(); chrome.storage.onChanged.addListener(show);

async function start(type, sync) {
  await chrome.storage.sync.set({ server: $('server').value.trim(), seller: $('seller').value.trim(), password: $('password').value });
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const link = $('profileUrl').value.trim(), sellerId = link.match(PROFILE)?.[1], shop = link.match(DEPOP)?.[1];
  if (type === 'profile' && shop) type = 'depop';
  if (type === 'profile' && !sellerId) return $('status').textContent = 'Paste a Marketplace profile link (facebook.com/marketplace/profile/…) or a Depop shop link (depop.com/…).';
  if (type === 'listing' && !/marketplace\/item\//.test(tab.url)) return $('status').textContent = 'Open a Marketplace listing first.';
  $('status').textContent = type !== 'listing' ? 'Working. You can close this; the icon shows items left.' : 'Adding…';
  const { r, error } = await chrome.runtime.sendMessage({ type, tabId: tab.id, sellerId, shop, sync });
  $('status').textContent = error || (type !== 'listing'
    ? `Done: ${r.added} added, ${r.updated} updated, ${r.removed} removed, ${r.failed} failed.`
    : r.duplicate ? 'Already imported.' : 'Added.');
}

$('profile').onclick = () => start('profile', false);
$('sync').onclick = () => start('profile', true);
$('listing').onclick = () => start('listing');

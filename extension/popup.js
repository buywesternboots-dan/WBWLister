const $ = id => document.getElementById(id);
const IMPORTABLE = /marketplace\/profile\/\d+|depop\.com\/(?!products\/)[\w.-]+/;
const say = t => { $('status').textContent = t; };

// Seller dropdown from the server; picking a seller fills in their saved Facebook/Depop link.
let sellers = [];
async function loadSellers(selected) {
  const server = $('server').value.trim().replace(/\/$/, '');
  if (!server) return;
  sellers = await fetch(`${server}/api/sellers`, { headers: { 'x-app-password': $('password').value } }).then(r => r.json()).catch(() => []);
  if (!Array.isArray(sellers)) { say(sellers.error ?? 'Could not load sellers.'); sellers = []; return; }
  $('seller').innerHTML = '<option value="">Pick a seller…</option>' + sellers.filter(s => s.name).map(s => `<option value="${s.name}">${s.display_name}</option>`).join('');
  $('seller').value = selected || '';
}
$('seller').onchange = () => {
  const s = sellers.find(s => s.name === $('seller').value);
  $('profileUrl').value = s?.fb_profile ?? '';
  say(s && !s.fb_profile ? 'No Facebook/Depop link saved for this seller — add it in Seller settings, or paste one here.' : '');
};
$('server').onchange = $('password').onchange = () => loadSellers($('seller').value);
chrome.storage.sync.get(['server', 'seller', 'password'], s => {
  $('server').value = s.server || ''; $('password').value = s.password || '';
  loadSellers(s.seller);
});
// On a Facebook profile or Depop shop page, use it.
chrome.tabs.query({ active: true, currentWindow: true }, ([t]) => { if (IMPORTABLE.test(t?.url ?? '')) $('profileUrl').value = t.url; });

// Progress bar and problem log, written by the background script.
const show = () => chrome.storage.local.get(['log', 'progress'], ({ log, progress: p }) => {
  if (log) $('log').textContent = log.join('\n');
  $('bar').style.display = p ? '' : 'none';
  $('barLabel').textContent = p ? `${p.done} of ${p.total} — ${p.label}` : '';
  if (p) Object.assign($('bar'), { value: p.done, max: p.total });
});
show(); chrome.storage.onChanged.addListener(show);

async function start(message) {
  await chrome.storage.sync.set({ server: $('server').value.trim(), seller: $('seller').value, password: $('password').value });
  if (!$('seller').value) return say('Pick a seller first.');
  const { r, error } = await chrome.runtime.sendMessage(message);
  say(error || (message.type === 'link' ? `Done: ${r.added} new, ${r.updated} changed, ${r.removed} gone (now Pending sold), ${r.failed} failed.` : r.duplicate ? 'Already imported.' : 'Added.'));
}
const importLink = sync => {
  const link = $('profileUrl').value.trim();
  if (!IMPORTABLE.test(link)) return say('Paste a Facebook Marketplace profile link (facebook.com/marketplace/profile/…) or a Depop shop link (depop.com/…).');
  say('Working — you can close this; the icon shows items left.');
  start({ type: 'link', link, sync });
};
$('profile').onclick = () => importLink(false);
$('sync').onclick = () => importLink(true);
$('listing').onclick = async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!/marketplace\/item\//.test(tab.url)) return say('Open a Marketplace listing first.');
  say('Adding…');
  start({ type: 'listing', tabId: tab.id });
};

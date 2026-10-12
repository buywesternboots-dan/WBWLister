const $ = id => document.getElementById(id);
const PROFILE = /marketplace\/profile\/(\d+)/;
chrome.storage.sync.get(['server', 'seller'], s => { $('server').value = s.server || ''; $('seller').value = s.seller || 'demo'; });
chrome.tabs.query({ active: true, currentWindow: true }, ([t]) => { if (PROFILE.test(t.url)) $('profileUrl').value = t.url; });

async function start(type) {
  await chrome.storage.sync.set({ server: $('server').value.trim(), seller: $('seller').value.trim() });
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const sellerId = $('profileUrl').value.trim().match(PROFILE)?.[1];
  if (type === 'profile' && !sellerId) return $('status').textContent = 'Paste a Marketplace profile link (facebook.com/marketplace/profile/…).';
  if (type === 'listing' && !/marketplace\/item\//.test(tab.url)) return $('status').textContent = 'Open a Marketplace listing first.';
  $('status').textContent = type === 'profile' ? 'Importing. You can close this; the icon shows items left.' : 'Adding…';
  const { r, error } = await chrome.runtime.sendMessage({ type, tabId: tab.id, sellerId });
  $('status').textContent = error || (type === 'profile' ? `Done: ${r.total - r.failed} of ${r.total} imported.` : r.duplicate ? 'Already imported.' : 'Added.');
}

$('profile').onclick = () => start('profile');
$('listing').onclick = () => start('listing');

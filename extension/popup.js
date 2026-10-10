const $ = id => document.getElementById(id);
chrome.storage.sync.get(['server', 'seller'], s => { $('server').value = s.server || ''; $('seller').value = s.seller || 'demo'; });

async function start(type) {
  await chrome.storage.sync.set({ server: $('server').value.trim(), seller: $('seller').value.trim() });
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const page = type === 'profile' ? /marketplace\/profile\// : /marketplace\/item\//;
  if (!page.test(tab.url)) return $('status').textContent = `Open a Marketplace ${type === 'profile' ? 'profile' : 'listing'} first.`;
  $('status').textContent = type === 'profile' ? 'Importing. You can close this; the icon shows items left.' : 'Adding…';
  const { r, error } = await chrome.runtime.sendMessage({ type, tabId: tab.id });
  $('status').textContent = error || (type === 'profile' ? `Done: ${r.total - r.failed} of ${r.total} imported.` : r.duplicate ? 'Already imported.' : 'Added.');
}

$('profile').onclick = () => start('profile');
$('listing').onclick = () => start('listing');

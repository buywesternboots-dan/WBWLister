// Runs on the BootLister page: lets the page start Facebook/Depop imports here (those sites block servers, so they run
// in this browser) and shows their progress on the page.
const post = m => window.postMessage(m, location.origin);
chrome.storage.sync.get('server', s => s.server || chrome.storage.sync.set({ server: location.origin })); // first visit sets the popup's address
post({ wbwExtension: true });
window.addEventListener('message', e => {
  if (e.source !== window) return;
  if (e.data?.wbwPing) post({ wbwExtension: true });
  if (e.data?.wbwImport) chrome.runtime.sendMessage({ ...e.data.wbwImport, server: location.origin },
    r => post({ wbwDone: r ?? { error: chrome.runtime.lastError?.message ?? 'The extension stopped.' } }));
});
chrome.storage.onChanged.addListener(c => {
  if (c.progress) post({ wbwProgress: c.progress.newValue ?? null });
  if (c.log) post({ wbwLog: c.log.newValue?.[0] });
});

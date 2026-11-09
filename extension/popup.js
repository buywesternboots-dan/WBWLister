const $ = id => document.getElementById(id);
const IMPORTABLE = /marketplace\/profile\/\d+|depop\.com\/(?!products\/)[\w.-]+/;
const say = t => { $('status').textContent = t; };
let signedIn = false;

function showSignIn(url) {
  const link = $('signin');
  if (!url) { link.hidden = true; return; }
  link.href = url;
  link.hidden = false;
}

async function loadSession() {
  const res = await chrome.runtime.sendMessage({ type: 'who' });
  signedIn = !!res?.ok;
  showSignIn(res?.signIn);
  if (!signedIn) { say(res?.error || 'Sign in on BootLister in this browser, then try again. This extension does not have its own sign-in.'); return; }
  const sel = $('seller');
  sel.replaceChildren();
  const blank = document.createElement('option');
  blank.value = '';
  blank.textContent = 'Pick a seller…';
  sel.append(blank);
  for (const s of (res.sellers || []).filter(s => s.name)) {
    const opt = document.createElement('option');
    opt.value = s.name;
    opt.textContent = s.display_name || s.name;
    sel.append(opt);
  }
  if (res.role === 'seller' && res.seller) {
    sel.value = res.seller;
    sel.disabled = true;
  }
  const saved = await chrome.storage.sync.get('seller');
  if (res.role === 'admin' && saved.seller) sel.value = saved.seller;
  const current = (res.sellers || []).find(s => s.name === sel.value);
  if (current?.fb_profile) $('profileUrl').value = current.fb_profile;
}

$('seller').onchange = () => {
  chrome.storage.sync.set({ seller: $('seller').value });
};
chrome.tabs.query({ active: true, currentWindow: true }, ([t]) => { if (IMPORTABLE.test(t?.url ?? '')) $('profileUrl').value = t.url; });

const show = () => chrome.storage.local.get(['log', 'progress'], ({ log, progress: p }) => {
  if (log) $('log').textContent = log.join('\n');
  $('bar').style.display = p ? '' : 'none';
  $('barLabel').textContent = p ? `${p.done} of ${p.total} — ${p.label}` : '';
  if (p) Object.assign($('bar'), { value: p.done, max: p.total });
});
show(); chrome.storage.onChanged.addListener(show);

async function start(message) {
  if (!signedIn) { say('Sign in on BootLister in this browser, then try again. This extension does not have its own sign-in.'); return; }
  if (!$('seller').value && message.type !== 'listing') return say('Pick a seller first.');
  if ($('seller').value) message.seller = $('seller').value;
  const { r, error, signIn } = await chrome.runtime.sendMessage(message);
  showSignIn(signIn);
  const word = r?.partial ? 'Partial' : 'Done';
  const already = r?.recheck ? `${r?.duplicate || 0} already imported` : `${r?.duplicate || 0} already imported (skipped)`;
  const prior = r?.recheck ? '' : `, ${r?.prior || 0} previously not boots (skipped)`;
  const mode = r?.modeNote ? `${r.modeNote} ` : '';
  say(error || (message.type === 'link' ? `${mode}${word}: ${r.added} new, ${r.updated} changed, ${already}${prior}, ${r.removed} gone (now Pending sold), ${r.failed} failed.${r.scanLimit ? ` ${r.scanLimit}` : ''}${r.skipped ? ` ${r.skipped}` : ''}` : r.duplicate ? 'Already imported.' : 'Added.'));
}
const importLink = sync => {
  const link = $('profileUrl').value.trim();
  if (!IMPORTABLE.test(link)) return say('Paste a Facebook Marketplace profile link (facebook.com/marketplace/profile/…) or a Depop shop link (depop.com/…).');
  say('Working — you can close this; the icon shows items left.');
  const raw = $('limit').value.trim();
  const parsed = parseInt(raw, 10);
  const limit = raw && Number.isInteger(parsed) ? Math.min(100, Math.max(1, parsed)) : 100;
  const shopMode = $('shopMode')?.value === 'full' ? 'full' : 'boots';
  start({ type: 'link', link, sync, limit, recheck: $('recheck').checked, shopMode });
};
$('ver').textContent = `Extension ${chrome.runtime.getManifest().version}`;
$('profile').onclick = () => importLink(false);
$('sync').onclick = () => importLink(true);
$('listing').onclick = async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!/marketplace\/item\//.test(tab.url)) return say('Open a Marketplace listing first.');
  say('Adding…');
  start({ type: 'listing', tabId: tab.id, url: tab.url });
};
loadSession();

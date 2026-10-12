const ITEM = /facebook\.com\/marketplace\/item\/(\d+)/;
const wait = ms => new Promise(r => setTimeout(r, ms));
const badge = t => chrome.action.setBadgeText({ text: String(t) });

// Runs inside a Facebook listing page.
function readListing() {
  const meta = p => document.querySelector(`meta[property="${p}"]`)?.content?.trim() || '';
  const main = document.querySelector('[role="main"]') || document.body;
  const lines = main.innerText.split('\n').map(s => s.trim()).filter(Boolean);
  const after = label => { const i = lines.findIndex(l => l.toLowerCase() === label); return i >= 0 ? lines[i + 1] : ''; };
  const imgs = [...main.querySelectorAll('img')].filter(i => i.src.includes('scontent') && i.naturalWidth >= 200).map(i => i.src);
  return {
    source: 'facebook',
    source_id: location.href.match(/item\/(\d+)/)?.[1],
    seller_id: main.querySelector('a[href*="/marketplace/profile/"]')?.href.match(/profile\/(\d+)/)?.[1],
    title: meta('og:title') || document.title.replace(/^.*Marketplace\s*[-–]\s*/, '').replace(/\s*\|\s*Facebook$/, ''),
    price: (lines.find(l => /^\$[\d,]+(\.\d\d)?$/.test(l)) || '').replace(/[$,]/g, '') || null,
    description: meta('og:description') || after("seller's description"),
    condition: after('condition'),
    size: after('size'),
    photos: [...new Set([meta('og:image'), ...imgs].filter(Boolean))],
  };
}

// Runs inside a Marketplace profile page: scrolls until no new listings load.
async function collectIds() {
  const ids = () => new Set([...document.querySelectorAll('a[href*="/marketplace/item/"]')].map(a => a.href.match(/item\/(\d+)/)?.[1]).filter(Boolean));
  for (let n = 0, same = 0, k = 0; same < 3 && k++ < 40;) {
    scrollTo(0, document.body.scrollHeight);
    await new Promise(r => setTimeout(r, 1500));
    const c = ids().size; same = c === n ? same + 1 : 0; n = c;
  }
  return [...ids()];
}

const run = async (tabId, func) => (await chrome.scripting.executeScript({ target: { tabId }, func }))[0].result;

async function send(item) {
  const { server, seller } = await chrome.storage.sync.get(['server', 'seller']);
  if (!server) throw new Error('Set the WBW server URL in the extension popup.');
  const r = await fetch(`${server.replace(/\/$/, '')}/api/items`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${seller || 'demo'}` },
    body: JSON.stringify(item),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error);
  return j;
}

const loaded = tabId => new Promise(res => chrome.tabs.onUpdated.addListener(function l(id, info) {
  if (id === tabId && info.status === 'complete') { chrome.tabs.onUpdated.removeListener(l); res(); }
}));

async function importUrl(url, sellerId) {
  const tab = await chrome.tabs.create({ url, active: false });
  await loaded(tab.id);
  await wait(2500);
  try {
    const item = await run(tab.id, readListing);
    if (sellerId && item.seller_id && item.seller_id !== sellerId) return { other: true };
    return await send(item);
  }
  finally { chrome.tabs.remove(tab.id); }
}

// Opens the seller's Marketplace profile, then imports only their listings (profile pages also show other sellers').
async function importProfile(sellerId) {
  const tab = await chrome.tabs.create({ url: `https://www.facebook.com/marketplace/profile/${sellerId}/` });
  await loaded(tab.id);
  await wait(3000);
  const ids = await run(tab.id, collectIds);
  let total = 0, failed = 0, others = 0;
  for (const [i, id] of ids.entries()) {
    badge(ids.length - i);
    try {
      const r = await importUrl(`https://www.facebook.com/marketplace/item/${id}/`, sellerId);
      if (r.other) { if (++others >= 3) break; } else { others = 0; total++; }
    } catch { failed++; total++; }
    await wait(3000 + Math.random() * 3000);
  }
  badge('');
  return { total, failed };
}

const addCurrent = async tabId => send(await run(tabId, readListing));

chrome.runtime.onMessage.addListener((m, _, reply) => {
  (m.type === 'profile' ? importProfile(m.sellerId) : addCurrent(m.tabId)).then(r => reply({ r }), e => reply({ error: e.message }));
  return true;
});

chrome.runtime.onInstalled.addListener(() => chrome.contextMenus.create({
  id: 'wbw', title: 'Add to WBW', contexts: ['link', 'page'], documentUrlPatterns: ['https://*.facebook.com/*'],
}));

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const link = ITEM.test(info.linkUrl || '') ? info.linkUrl : null;
  try {
    if (!link && !ITEM.test(tab.url)) throw new Error();
    await (link ? importUrl(link) : addCurrent(tab.id));
    badge('✓');
  } catch { badge('!'); }
  setTimeout(() => badge(''), 3000);
});

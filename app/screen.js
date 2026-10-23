'use client';
import { useEffect, useRef, useState } from 'react';
import { CHOICES, searchMatch } from '../lib/vocab';
import { needsCheck, REQUIRED } from '../lib/publish';
import { csvCell } from '../lib/csv';
import { altText, photoUrl } from '../lib/seo';
import { CHANNELS, post } from '../lib/crosspost';

// Selected seller comes from ?seller= (the extension's seller dropdown uses the same names).
const seller = () => new URLSearchParams(location.search).get('seller') || '';
const switchTo = name => { if (name?.trim()) location.search = `?seller=${encodeURIComponent(name.trim().toLowerCase())}`; };
const api = (method, body, q = '', path = '/api/items') =>
  fetch(path + q, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${seller()}` }, body: body && JSON.stringify(body) })
    .then(async r => { const j = await r.json(); if (!r.ok) throw new Error(j.error); return j; });
const wait = ms => new Promise(r => setTimeout(r, ms));
// Runs fn; on failure tries twice more (after 1 s, then 2 s) before giving up.
const withRetry = async (fn, n = 1) => { try { return await fn(); } catch (e) { if (n >= 3) throw e; await wait(n * 1000); return withRetry(fn, n + 1); } };

const TABS = { review: 'Newly imported', published: 'Exported', pending: 'Pending sold', sold: 'Sold', removed: 'Removed', archived: 'Archived' };
const GROUPS = { boot: 'Boots', belt: 'Belts', unsure: 'Not sure', other: 'Other' };
// Item fields: key → label. * = required by WBW.
const LABELS = { title: 'Listing title*', wbw_price: 'Asking price', price: 'Source price*', brand: 'Brand*', sized_for: 'Sized for*', size: 'Size',
  size_estimated: 'Size estimated', condition: 'Condition*', width: 'Width', material_type: 'Material type', material: 'Material / hide',
  material_cut: 'Material specifics (cut)', made_in: 'Where made', color: 'Color', keywords: 'Keywords',
  sole_length: 'Sole length (in)', sole_width: 'Sole width (in)', heel_height: 'Heel height (in)', shaft_circ: 'Shaft circumference (in)', shaft_height: 'Shaft height (in)',
  sole: 'Sole', heel: 'Heel', toe: 'Toe', description: 'Description', id_text: 'Model / date codes' };
const FIELDS = Object.keys(LABELS);
const label = f => LABELS[f].replace(/\*$/, '');
const missing = i => REQUIRED.filter(f => !i[f]);
const ALERT = ['width']; // not required, but shown red when empty so the seller knows it isn't there
const flagged = i => [...missing(i), ...ALERT.filter(f => !i[f])];
const unverified = i => (i.guessed ?? []).filter(f => i[f]);
const isReady = i => !missing(i).length && !unverified(i).length;
const PRESETS = { brand: ['Unbranded', 'Custom'], size: ['Estimated'] }; // one-click values for items that genuinely have none
// Group header quick filters: Ready, To verify, one per missing required field, and the alert fields.
const FILTERS = { check: ['Needs a check', needsCheck], approved: ['Approved', i => !needsCheck(i)],
  ready: ['Ready', isReady], idinfo: ['Has ID info', i => i.id_photos?.length > 0], verify: ['To verify', i => unverified(i).length > 0],
  ...Object.fromEntries(REQUIRED.map(f => [f, [`Missing ${label(f)}`, i => !i[f]]])),
  ...Object.fromEntries(ALERT.map(f => [f, [`No ${label(f).toLowerCase()}`, i => !i[f]]])) };
// Sorts: most likely a boot first, or newest import day first (same day: most likely boot first).
const SORTS = {
  likely: (a, b) => (b.boot_score ?? 0) - (a.boot_score ?? 0) || b.created_at.localeCompare(a.created_at),
  newest: (a, b) => b.created_at.slice(0, 10).localeCompare(a.created_at.slice(0, 10)) || (b.boot_score ?? 0) - (a.boot_score ?? 0),
};
// Seller settings form: [field, label, kind] (kind: h = heading, area = multi-line, sync = sync choice, else one line).
const SELLER_FORM = [
  ['h1', 'Details', 'h'], ['name', 'WBW seller name* (the WBW account these items attach to)'], ['display_name', 'Display name*'],
  ['contact', 'Contact person'], ['email', 'Email'], ['phone', 'Phone'], ['location', 'Location (city, state)'],
  ['h2', 'Import & sync', 'h'], ['website', 'Website, Poshmark or eBay link (store, collection, poshmark.com/closet/…, or ebay.com/usr/<username>)'],
  ['fb_profile', 'Facebook Marketplace profile or Depop shop link (imported through the Chrome extension)'], ['sync', 'Automatic sync', 'sync'],
  ['h4', 'Shipping & returns (Google feed; blank = marketplace default, no returns)', 'h'], ['ship_price', 'Shipping price (USD)'], ['handle_days', 'Handling time (business days)'],
  ['return_days', 'Return window in days (blank = final sale)'],
  ['brand_context', 'Brand context on WBW listings (from the WBW brand page)', 'toggle'],
  ['h3', 'Listing style', 'h'], ['notes', 'Notes (how this seller writes listings)', 'area'],
  ['terms', 'Custom terms, one per line: their shorthand = meaning (e.g. BJ = Black Jack, Sz = Size)', 'area'],
  ['defaults', 'Defaults, one per line: field = value, used when a listing doesn\'t say (e.g. sized_for = Women, made_in = USA)', 'area'],
];
// Export: every field on the WBW "Sell a pair" form, then the extra columns this import still needs.
const SIZED = { Men: "Men's", Women: "Women's", Kids: 'Kids' };
const CSV = { photos: 'Photos', title: 'Listing title', wbw_price: 'Asking price', brand: 'Brand', sized_for: 'Sized for', size: 'Size', size_estimated: 'Size estimated', condition: 'Condition', width: 'Width', material_type: 'Material type', material: 'Material / hide', material_cut: 'Material specifics (cut)', made_in: 'Where made', color: 'Color', keywords: 'Keywords', sole_length: 'Sole length', sole_width: 'Sole width', heel_height: 'Heel height', shaft_circ: 'Shaft circumference', shaft_height: 'Shaft height', sole: 'Sole', heel: 'Heel', toe: 'Toe', description: 'Description', seller: 'WBW Seller Name', price: 'Source price', id_text: 'Model / date codes', category: 'Category', website_url: 'Seller Website Link', alts: 'Image Alt Text', brand_context: 'Brand Context', brand_link: 'Brand Page Link', seller_context: 'Seller Context', source_id: 'Source ID' };
const download = (rows, brands = {}, s = {}) => {
  const row = r => ({ ...r, seller_context: s.display_name ? `Sold by ${s.display_name}${s.location ? ` of ${s.location}` : ''}.` : '', brand_context: brands[r.brand] ? `${brands[r.brand].text} ${[r.material, r.size && `size ${r.size}`].filter(Boolean).join(', ')}.` : '', brand_link: brands[r.brand]?.link ?? '', website_url: ['facebook', 'depop', 'poshmark', 'ebay'].includes(r.source) ? '' : r.source_url, wbw_price: r.wbw_price ?? r.price,
    sized_for: SIZED[r.sized_for] ?? r.sized_for, size_estimated: r.size_estimated || (/^estimated$/i.test(String(r.size ?? '')) ? 'Yes' : ''), category: ['boot', 'belt'].includes(r.boot) ? GROUPS[r.boot] : '',
    photos: r.photos.map((_, n) => photoUrl(location.origin, r, n + 1)), alts: r.photos.map((_, n) => altText(r, n + 1)) });
  const csv = [Object.values(CSV), ...rows.map(r => Object.keys(CSV).map(k => row(r)[k]))].map(r => r.map(csvCell).join(',')).join('\r\n');
  Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([csv], { type: 'text/csv' })), download: `bootlister-export-${new Date().toISOString().slice(0, 10)}.csv` }).click();
};
// Copy-ready posts for other marketplaces; "Posted" tracks where and when each was posted.
function Share({ item, seller, reload }) {
  const copy = (p, ch) => navigator.clipboard.writeText([p.title, p.body, `Photos:\n${p.photos.join('\n')}`].join('\n\n'))
    .then(() => confirm('Copied. Mark as posted?') && api('POST', { id: item.id, channel: ch }, '', '/api/posted').then(reload));
  return <div className="share"><h3>Share to other marketplaces</h3>{Object.entries(CHANNELS).map(([ch, name]) => {
    const p = post(ch, item, location.origin, seller);
    return <details key={ch}><summary>{name}{item.posted?.[ch] && ` — posted ${item.posted[ch].slice(0, 10)}`}</summary>
      <input readOnly value={p.title} /><textarea readOnly rows="8" value={p.body} />
      <small>{p.photos.length} photo links are included when you copy.</small><button type="button" onClick={() => copy(p, ch)}>Copy post</button></details>;
  })}</div>;
}
const CONCURRENT = 4; // website products imported at once
const EXTENSION_LINK = /facebook\.com|depop\.com/i; // these sites block servers, so the Chrome extension imports them
const done = n => `Done: ${n.added} new, ${n.updated} changed${n.sold != null ? `, ${n.sold} already sold (skipped)` : ''}, ${n.removed} gone (now Pending sold), ${n.failed} failed`;
const daysLeft = i => Math.max(0, 30 - Math.floor((Date.now() - new Date(i.status_at)) / 864e5));

// Shared item screen. The admin interface passes admin; the seller interface at /seller does not, so those controls are not rendered.
export default function Screen({ admin = false }) {
  const [who, setWho] = useState('');
  const [sellers, setSellers] = useState([]);
  const [sellerForm, setSellerForm] = useState(null); // seller being added/edited
  const [inviteCode, setInviteCode] = useState('');
  const [tab, setTab] = useState('review');
  const [items, setItems] = useState([]);
  const [sel, setSel] = useState(new Set());
  const [edit, setEdit] = useState(null);
  const [adj, setAdj] = useState({ value: '', unit: '%' });
  const [q, setQ] = useState('');
  const [sort, setSort] = useState('likely');
  const [filter, setFilter] = useState({}); // group → FILTERS key
  const [link, setLink] = useState(''); // import source for the selected seller
  const [run, setRunState] = useState(null); // import progress: { label, done, total, busy }
  const [failed, setFailed] = useState([]);
  const [ext, setExt] = useState(false); // BootLister extension present on this page
  const [err, setErr] = useState('');
  const [me, setMe] = useState(null);

  const current = sellers.find(s => s.seller === who), hasDetails = !!current?.name;
  const setRun = patch => setRunState(r => ({ ...r, ...patch }));
  const loadSellers = () => api('GET', null, '', '/api/sellers').then(setSellers).catch(e => setErr(e.message));
  // A seller's login is always their own items (the server enforces it); an admin picks a seller via ?seller=.
  const load = () => (seller() || me?.seller ? api('GET', null, `?status=${tab}`).then(setItems).catch(e => setErr(e.message)) : setItems([]));
  const loadRef = useRef(load); loadRef.current = load;

  useEffect(() => {
    api('GET', null, '', '/api/me').then(m => { setMe(m); if (m.seller) setWho(m.seller); }).catch(() => {});
    if (admin) setWho(seller()); // a seller screen ignores ?seller=; the session names them
    loadSellers();
  }, []);
  useEffect(() => { setSel(new Set()); setEdit(null); setFilter({}); load(); }, [tab, me?.seller]);
  useEffect(() => { setLink(current?.website || current?.fb_profile || ''); }, [current?.website, current?.fb_profile]);
  // Facebook/Depop imports run in the extension (extension/bridge.js); it reports progress back here.
  useEffect(() => {
    const on = ({ source, data: d = {} }) => {
      if (source !== window) return;
      if (d.wbwExtension) setExt(true);
      if (d.wbwProgress) setRun({ ...d.wbwProgress, busy: true });
      if (d.wbwDone) { d.wbwDone.error ? (setErr(d.wbwDone.error), setRunState(null)) : setRunState({ label: done(d.wbwDone.r) }); loadRef.current(); loadSellers(); }
    };
    window.addEventListener('message', on);
    window.postMessage({ wbwPing: true }, location.origin);
    return () => window.removeEventListener('message', on);
  }, []);

  const act = body => { setErr(''); api('PATCH', body).then(() => { setSel(new Set()); setEdit(null); load(); loadSellers(); }).catch(e => setErr(e.message)); };
  const bulk = body => act({ ids: [...sel], ...body });
  const toggle = id => setSel(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const lower = () => { const v = Number(adj.value); if (v > 0) bulk({ action: 'price', [adj.unit === '%' ? 'percent' : 'amount']: v }); };
  const save = () => act({ ids: [edit.id], action: 'edit', ...Object.fromEntries(FIELDS.map(f => [f, edit[f]])) });
  const approve = item => {
    setErr('');
    api('PATCH', { ids: [item.id], action: 'approve', ...(edit?.id === item.id ? Object.fromEntries(FIELDS.map(f => [f, edit[f]])) : {}) })
      .then(() => { setSel(new Set()); setEdit(null); loadSellers(); tab === 'published' ? load() : setTab('published'); })
      .catch(e => setErr(e.message));
  };
  const scan = async () => { for (const id of sel) await api('POST', { id }, '', '/api/idcheck').catch(e => setErr(e.message)); load(); };
  const exportCsv = async () => {
    const picked = items.filter(i => sel.has(i.id)), rows = picked.filter(i => !needsCheck(i));
    if (!rows.length) return setErr(picked.length ? 'Nothing selected has the seller\'s approval yet.' : 'Select an approved item first.');
    const notReady = rows.filter(i => !isReady(i)).length;
    if (notReady && !confirm(`${notReady} of ${rows.length} approved items aren't ready (missing or unverified fields). Export anyway?`)) return;
    const names = current?.brand_context === 'off' ? [] : [...new Set(rows.map(r => r.brand).filter(Boolean))];
    const note = rows.length < picked.length ? `${picked.length - rows.length} still need the seller's check and were left out.` : '';
    download(rows, names.length ? await api('GET', null, `?names=${encodeURIComponent(names)}`, '/api/brand').catch(() => ({})) : {}, current);
    if (note) setErr(note);
  };
  const saveSeller = () => api('POST', { ...sellerForm, rename_from: sellerForm.created_at && current?.name }, '', '/api/sellers')
    .then(s => { setSellerForm(null); s.name === who ? loadSellers() : switchTo(s.name); }).catch(e => setErr(e.message));
  const deleteSeller = () => confirm(`Delete seller "${current.display_name}"?`) &&
    api('DELETE', null, `?name=${encodeURIComponent(current.name)}`, '/api/sellers').then(() => location.assign('/')).catch(e => setErr(e.message));

  // Import = new listings only. Sync = re-read all (refresh source-changed ones), then remove what's gone or sold.
  const startImport = (sync, only) => (EXTENSION_LINK.test(link) ? importViaExtension(sync) : importSite(sync, only));
  const importViaExtension = sync => {
    setErr('');
    if (!ext) return setErr('Facebook and Depop imports run through the BootLister Chrome extension. Install it (or reload it at chrome://extensions), then reload this page.');
    setFailed([]); setRunState({ label: 'Started in the Chrome extension — a Facebook/Depop tab will open…', busy: true });
    window.postMessage({ wbwImport: { type: 'link', link, sync, seller: who } }, location.origin);
  };
  // Website stores, server-side. only: just these product URLs (retrying failures). CONCURRENT at a time;
  // stops if 5 in a row fail (something's wrong with the site, not one product).
  const importSite = async (sync, only) => {
    setErr(''); setFailed([]); setRunState({ label: 'Reading the store\'s product list…', busy: true });
    try {
      const { source, urls, known, items } = only ? { urls: only, known: [] } : await api('GET', null, `?site=${encodeURIComponent(link)}`, '/api/import');
      const slug = u => u.split('/').filter(Boolean).pop(), have = new Set(known);
      const todo = sync ? urls : urls.filter(u => !have.has(u)), listed = new Set(urls.map(slug));
      const n = { added: 0, updated: 0, sold: 0, failed: 0, removed: 0 };
      let next = 0, streak = 0, stop = '';
      setRun({ label: sync ? 'Syncing' : 'Importing', done: 0, total: todo.length });
      const worker = async () => {
        while (next < todo.length && !stop) {
          const url = todo[next++];
          try {
            const r = await withRetry(() => api('POST', { url, item: items?.[url] }, '', '/api/import'));
            streak = 0;
            if (r.sold) { n.sold++; listed.delete(slug(url)); } else if (r.item?.updated) n.updated++; else if (r.item) n.added++;
          } catch (e) {
            n.failed++; setFailed(f => [...f, { url, error: e.message }]);
            if (++streak >= 5) stop = e.message;
          }
          setRun({ done: n.added + n.updated + n.sold + n.failed });
        }
      };
      await Promise.all(Array.from({ length: CONCURRENT }, worker));
      if (stop) throw new Error(`Import stopped — 5 products in a row failed: ${stop}`);
      if (sync) n.removed = (await api('PATCH', { action: 'sync', source, ids: [...listed] })).removed;
      setRunState({ label: done(n) });
    } catch (e) { setRunState(null); setErr(e.message); }
    load(); loadSellers();
  };

  const live = tab === 'review' || tab === 'published';
  const shown = items.filter(i => searchMatch(i, q)).sort(SORTS[sort]);
  const unchecked = shown.filter(needsCheck).length;
  const groups = tab === 'review' ? Object.entries(GROUPS).map(([k, l]) => [k, l, shown.filter(i => i.boot === k)]) : [[tab, TABS[tab], shown]];
  const setForm = f => e => setSellerForm({ ...sellerForm, [f]: e.target.value });
  const setField = f => e => setEdit({ ...edit, [f]: e.target.value });

  return (
    <main>
      <style>{css}</style>
      {Object.entries(CHOICES).map(([f, opts]) => <datalist key={f} id={`dl-${f}`}>{opts.map(o => <option key={o} value={o} />)}</datalist>)}

      <div className="who">
        {!admin ? <strong>{current?.display_name ?? who}</strong> : <>Seller: <select value={who} onChange={e => switchTo(e.target.value)}>
          {!current && <option value={who}>{who || 'Pick a seller…'}</option>}
          {sellers.map(s => <option key={s.seller} value={s.seller}>{s.display_name ?? s.seller} — {s.active} items{s.review ? `, ${s.review} new` : ''}</option>)}
        </select>
        {who && <button onClick={() => setSellerForm(hasDetails ? current : { name: who, sync: 'off' })}>{hasDetails ? 'Seller settings' : 'Set up seller'}</button>}
        <button className="primary" onClick={() => setSellerForm({ sync: 'off' })}>+ Add seller</button></>}
        {admin && <a className="src" href="/bootlister.zip" download title="Needed for Facebook and Depop imports">Chrome extension{ext ? ' ✓' : ''}</a>}
        <a className="src" href="/login" onClick={e => { e.preventDefault(); fetch('/api/login', { method: 'DELETE' }).then(() => location.assign('/login')); }}>Log out</a>
      </div>
      {!admin && <p className="help">Your job is to double-check each listing before it goes live, including anything shown in yellow. When you approve it, it is published right away. It is marked exported here — WBW is not connected yet, so nothing is sent to the live site.</p>}
      {admin && who && <p className="help">When a seller approves a listing, it is published here right away. You can still see and edit every listing. Export CSV is the file for WBW. Nothing is sent to the live site yet.</p>}
      {!ext && EXTENSION_LINK.test(link) && <p className="help">Facebook and Depop import through the BootLister Chrome extension:
        1) download it with the <a href="/bootlister.zip" download>Chrome extension</a> link and unzip it; 2) open chrome://extensions and turn on
        Developer mode; 3) click Load unpacked and pick the unzipped bootlister folder; 4) reload this page.</p>}

      {admin && sellerForm && <div className="panel">
        <strong>{sellerForm.created_at ? 'Edit seller' : 'New seller'}</strong>
        <small>{sellerForm.has_login ? 'This seller has a password. Setting a new one logs out their other sessions.' : 'This seller has no password yet. Set one here, or create an invite code they type on the sign-in page. Registration will not take over this seller.'}</small>
        <label>Initial password<input type="password" autoComplete="new-password" value={sellerForm.password ?? ''} onChange={setForm('password')} /></label>
        <button type="button" onClick={() => api('POST', { ...sellerForm, password: sellerForm.password || undefined, issue_invite: true, rename_from: sellerForm.created_at && current?.name }, '', '/api/sellers').then(s => { setInviteCode(s.invite); setSellerForm({ ...s, password: '' }); }).catch(e => setErr(e.message))}>Create invite code</button>
        {inviteCode && <p className="warn">Invite code, shown once: {inviteCode}. It expires in 7 days. They choose “Have an invite code?” on the sign-in page. Nothing is emailed.</p>}
        {SELLER_FORM.map(([f, l, kind]) => kind === 'h' ? <h3 key={f}>{l}</h3> :
          <label key={f}>{l}{kind === 'area' ? <textarea rows="3" value={sellerForm[f] ?? ''} onChange={setForm(f)} />
            : kind === 'toggle' ? <select value={sellerForm[f] ?? 'on'} onChange={setForm(f)}><option value="on">On</option><option value="off">Off</option></select>
            : kind === 'sync' ? <select value={sellerForm.sync ?? 'off'} onChange={setForm(f)}>
              <option value="off">Off (sync by hand)</option><option value="daily">Daily</option><option value="weekly">Weekly</option></select>
            : <input value={sellerForm[f] ?? ''} onChange={setForm(f)} />}</label>)}
        <span><button className="primary" onClick={saveSeller}>Save seller</button><button onClick={() => setSellerForm(null)}>Cancel</button>
          {sellerForm.created_at && !current?.active && <button onClick={deleteSeller}>Delete seller</button>}</span>
      </div>}
      {admin && !who && !sellerForm && <p className="empty">Pick a seller above, or add one.</p>}
      {admin && who && !hasDetails && !sellerForm && <p className="err">Set up this seller (details and import settings) before importing for them.</p>}

      {hasDetails && <div className="site">
        <input placeholder="Website, Poshmark, eBay, Facebook or Depop link (saved in Seller settings)" value={link} onChange={e => setLink(e.target.value.trim())} />
        <button disabled={!link || run?.busy} onClick={() => startImport(false)}>Import</button>
        <button disabled={!link || run?.busy} onClick={() => startImport(true)}>Sync</button>
        {run?.label && <div className="run">{run.total > 0 && <progress value={run.done} max={run.total} />}
          <small>{run.label}{run.total > 0 && run.done < run.total && ` — ${run.done} of ${run.total}`}</small></div>}
        {failed.length > 0 && <details className="failed">
          <summary>{failed.length} failed <button disabled={run?.busy} onClick={() => importSite(false, failed.map(f => f.url))}>Retry failed</button></summary>
          {failed.map(f => <div key={f.url}><a href={f.url} target="_blank">{f.url.split('/').pop()}</a> — {f.error}</div>)}
        </details>}
      </div>}

      <nav>{Object.entries(TABS).map(([k, l]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}</nav>
      {who && shown.length > 0 && <p className={unchecked ? 'warn' : ''}>{unchecked ? `${unchecked} of ${shown.length} still need ${admin ? "the seller's" : 'your'} check.` : `All ${shown.length} here are approved.`}</p>}
      {err && <p className="err">{err}</p>}

      <div className="tools">
        <input type="search" placeholder="Search (brand families & materials included, e.g. Rios, HBL)" value={q} onChange={e => setQ(e.target.value)} />
        <select value={sort} onChange={e => setSort(e.target.value)}>
          <option value="likely">Most likely boot first</option><option value="newest">Newest import first</option>
        </select>
      </div>

      {shown.length > 0 && <div className="bar">
        <label><input type="checkbox" checked={sel.size > 0 && sel.size === shown.length}
          onChange={() => setSel(sel.size === shown.length ? new Set() : new Set(shown.map(i => i.id)))} /> {sel.size} selected</label>
        {sel.size > 0 && <>
          {live && <span className="adj">
            <input inputMode="decimal" placeholder="Lower by" value={adj.value} onChange={e => setAdj({ ...adj, value: e.target.value })} />
            <select value={adj.unit} onChange={e => setAdj({ ...adj, unit: e.target.value })}><option>%</option><option>$</option></select>
            <button onClick={lower}>Apply</button>
          </span>}
          {admin && live && <button className="primary" onClick={exportCsv}>Export CSV</button>}
          {live && <button onClick={() => bulk({ action: 'remove' })}>Remove</button>}
          {tab === 'pending' && <button className="primary" onClick={() => bulk({ action: 'sold' })}>Mark sold</button>}
          {tab === 'pending' && <button onClick={() => bulk({ action: 'restore' })}>Still for sale</button>}
          {!live && tab !== 'pending' && <button onClick={() => bulk({ action: 'restore' })}>Restore</button>}
          {admin && <button onClick={scan}>Scan photos for ID info</button>}
          {admin && <button onClick={() => { const to = prompt('Move the selected items to which seller?'); if (to) bulk({ action: 'move', to }); }}>Move to seller…</button>}
          {admin && <button onClick={() => confirm(`Delete ${sel.size} items? Their photos and details stay in the WBW photo archive.`) && bulk({ action: 'delete' })}>Delete</button>}
        </>}
      </div>}

      {who && shown.length === 0 && <p className="empty">{q ? 'Nothing matches the search.' : tab === 'review' ? 'No new imports — use Import above.' : `Nothing ${TABS[tab].toLowerCase()} yet.`}</p>}

      {groups.filter(([, , list]) => list.length).map(([k, l, list]) => {
        const f = FILTERS[filter[k]], visible = f ? list.filter(f[1]) : list;
        return <section key={k}>
          <h2>{l} ({list.length})
            {Object.entries(FILTERS).map(([fk, [fl, test]]) => { const c = list.filter(test).length;
              return (c > 0 || fk === 'ready' || fk === 'check') && <button key={fk} className={`chip ${fk in LABELS ? 'miss' : ''} ${fk === 'check' ? 'miss' : ''} ${filter[k] === fk ? 'on' : ''}`}
                onClick={() => setFilter({ ...filter, [k]: filter[k] === fk ? null : fk })}>{fl} ({c})</button>; })}
          </h2>
          {visible.map(i => <div key={i.id} className="item">
            <input type="checkbox" checked={sel.has(i.id)} onChange={() => toggle(i.id)} />
            {i.photos[0] ? <img src={i.photos[0]} alt="" loading="lazy" /> : <div className="noimg" />}
            {edit?.id === i.id ? <div className="form">
              {FIELDS.map(f => <label key={f} className={unverified(i).includes(f) ? 'guess' : flagged(i).includes(f) ? 'miss' : ''}>
                <span>{LABELS[f]}{unverified(i).includes(f) && ' — auto-filled, verify'}
                  {PRESETS[f]?.map(p => <button key={p} type="button" className="preset" onClick={() => setEdit({ ...edit, [f]: p })}>{p}</button>)}</span>
                {f === 'description' ? <textarea rows="4" value={edit[f] ?? ''} onChange={setField(f)} />
                  : <input list={CHOICES[f] && `dl-${f}`} value={edit[f] ?? ''} onChange={setField(f)} />}</label>)}
              {i.status === 'published' && <Share item={i} seller={current} reload={load} />}
              <span><button className="primary" onClick={save}>Save (marks all verified)</button>
                {!admin && needsCheck(i) && <button type="button" className="primary" onClick={() => approve(i)}>Approve / ready to go live</button>}
                <button onClick={() => setEdit(null)}>Cancel</button></span>
              {!admin && i.approved_at && <small className="warn">Saving changes takes it off the exported list until you approve it again.</small>}
            </div> : <div className="info" onClick={() => setEdit(i)}>
              <strong>{i.title || 'Untitled'}</strong>
              {i.source_url && <a className="src" href={i.source_url} target="_blank" onClick={e => e.stopPropagation()}>
                View on {{ facebook: 'Facebook', depop: 'Depop', poshmark: 'Poshmark', ebay: 'eBay' }[i.source] ?? i.source}</a>}
              {i.changed_at && <small className="warn">Changed at source — review before it goes back to WBW</small>}
              {i.status === 'pending' && <small className="warn">Gone from the source — confirm sold, or it's marked sold in {daysLeft(i)} days</small>}
              {i.boot === 'unsure' && <small>{Math.round((i.boot_score ?? 0) * 100)}% likely a boot</small>}
              {missing(i).length > 0 && <small className="err">Missing: {missing(i).map(label).join(', ')}</small>}
              {unverified(i).length > 0 && <small className="warn">Verify: {unverified(i).map(label).join(', ')}</small>}
              {needsCheck(i) ? <small className="err">{admin ? "Needs the seller's check" : 'Needs your check'}</small> : <small>Approved by {i.approved_by} on {String(i.approved_at).slice(0, 10)}</small>}
              <dl>{FIELDS.filter(f => f !== 'title' && f !== 'description' && (i[f] || flagged(i).includes(f) || ['wbw_price', 'price', 'brand', 'sized_for', 'size', 'condition', 'material'].includes(f))).map(f =>
                <div key={f} className={flagged(i).includes(f) ? 'err' : unverified(i).includes(f) ? 'guess' : ''}>
                <dt>{label(f)}</dt><dd>{f.includes('price') && i[f] ? `$${Number(i[f]).toFixed(2)}` : i[f] || '—'}</dd></div>)}</dl>
              {i.description && <p className="desc">{i.description}</p>}
              <small>Tap to edit</small>
              {!admin && needsCheck(i) && <button type="button" className="primary" onClick={e => { e.stopPropagation(); approve(i); }}>Approve / ready to go live</button>}
            </div>}
          </div>)}
        </section>;
      })}
    </main>
  );
}

const css = `
body{margin:0;font:16px/1.4 system-ui,sans-serif;color:#2b2118;background:#faf8f5}
main{max-width:760px;margin:0 auto;padding:16px}
button,select,input,textarea{font:inherit;padding:8px 12px;border:1px solid #cfc6bb;border-radius:6px;background:#fff;color:inherit}
button:disabled{opacity:.5}
nav{display:flex;gap:8px;margin-bottom:16px;overflow-x:auto}
nav button.on,.primary{background:#1f6f6b;border-color:#1f6f6b;color:#fff}
label{display:flex;flex-direction:column;font-size:13px;color:#6b5a4a;gap:2px}
.who,.site,.tools,.bar{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-bottom:12px}
.who select,.site input,.tools input{flex:1;min-width:0}
.panel{display:flex;flex-direction:column;gap:6px;padding:12px;margin-bottom:12px;background:#fff;border:1px solid #e6dfd6;border-radius:8px}
.panel h3{margin:8px 0 0;font-size:14px;color:#1f6f6b}.panel span,.form span{display:flex;gap:6px}
.run{width:100%;display:flex;flex-direction:column;gap:2px}.run progress{width:100%}.run small{color:#6b5a4a}
.failed{width:100%;font-size:13px;color:#a3261b;max-height:200px;overflow:auto}.failed a{color:inherit}
.bar{position:sticky;top:0;padding:10px 0;background:#faf8f5;z-index:1}.bar label{flex-direction:row;align-items:center;gap:6px;font-size:16px}
.adj{display:flex;gap:4px}.adj input{width:90px}
h2{font-size:15px;margin:20px 0 8px;color:#6b5a4a;display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.chip{font-size:12px;padding:2px 8px;border-radius:12px}.chip.miss{color:#a3261b;border-color:#e3b3ad}.chip.on{background:#1f6f6b;border-color:#1f6f6b;color:#fff}
.item{display:flex;gap:12px;align-items:flex-start;padding:10px;background:#fff;border:1px solid #e6dfd6;border-radius:8px;margin-bottom:8px}
.item img,.noimg{width:72px;height:72px;object-fit:cover;border-radius:6px;background:#eee;flex-shrink:0}
.info{display:flex;flex-direction:column;cursor:pointer;flex:1;min-width:0}.info small{color:#8a7a6a}
.form{display:flex;flex-direction:column;gap:6px;flex:1}.form label>span{display:flex;align-items:center}
dl{display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:4px 12px;margin:6px 0;font-size:13px}dt{color:#8a7a6a;font-size:11px}dd{margin:0}
.desc{font-size:13px;color:#4a3d31;margin:4px 0;white-space:pre-line;max-height:4.2em;overflow:hidden}
.src{font-size:13px;color:#1f6f6b;align-self:flex-start}
.guess{background:#fff3c4;border-radius:4px;padding:0 4px}.miss{background:#fde8e6;border-radius:4px;padding:0 4px}
.preset{margin-left:6px;padding:0 6px;font-size:12px}
.help{font-size:13px;color:#6b5a4a;background:#fff;border:1px solid #e6dfd6;border-radius:8px;padding:10px}
.warn{color:#8a5a00!important}.err{color:#a3261b!important}.empty{color:#6b5a4a}
`;

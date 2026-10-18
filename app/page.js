'use client';
import { useEffect, useRef, useState } from 'react';
import { CHOICES, searchMatch } from '../lib/vocab';

// Selected seller comes from ?seller= (the extension's seller dropdown uses the same names).
const seller = () => new URLSearchParams(location.search).get('seller') || '';
const switchTo = name => { if (name?.trim()) location.search = `?seller=${encodeURIComponent(name.trim().toLowerCase())}`; };
const api = (method, body, q = '', path = '/api/items') =>
  fetch(path + q, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${seller()}` }, body: body && JSON.stringify(body) })
    .then(async r => { const j = await r.json(); if (!r.ok) throw new Error(j.error); return j; });
const wait = ms => new Promise(r => setTimeout(r, ms));
// Runs fn; on failure tries twice more (after 1 s, then 2 s) before giving up.
const withRetry = async (fn, n = 1) => { try { return await fn(); } catch (e) { if (n >= 3) throw e; await wait(n * 1000); return withRetry(fn, n + 1); } };

const TABS = { review: 'Newly imported', published: 'Exported', removed: 'Removed', archived: 'Archived' };
const GROUPS = { boot: 'Boots', belt: 'Belts', unsure: 'Not sure', other: 'Other' };
// Item fields: key → label. * = required by WBW.
const LABELS = { price: 'Price*', wbw_price: 'WBW Price', title: 'Title*', brand: 'Brand*', sized_for: 'Sized for (Men/Women)*', width: 'Width',
  material_type: 'Material type', material: 'Material', made_in: 'Where made', condition: 'Condition*', color: 'Color', sole: 'Sole', heel: 'Heel',
  toe: 'Toe', size: 'Size', description: 'Description' };
const FIELDS = Object.keys(LABELS);
const REQUIRED = FIELDS.filter(f => LABELS[f].endsWith('*'));
const ALERT = ['width']; // not required, but shown red when empty so the seller knows it isn't there
const label = f => LABELS[f].replace(/\*$/, '');
const missing = i => REQUIRED.filter(f => !i[f]);
const flagged = i => [...missing(i), ...ALERT.filter(f => !i[f])];
const unverified = i => (i.guessed ?? []).filter(f => i[f]);
const isReady = i => !missing(i).length && !unverified(i).length;
const PRESETS = { brand: ['Unbranded', 'Custom'], size: ['Estimated'] }; // one-click values for items that genuinely have none
// Group header quick filters: Ready, To verify, one per missing required field, and the alert fields.
const FILTERS = { ready: ['Ready', isReady], verify: ['To verify', i => unverified(i).length > 0],
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
  ['login_password', 'Seller login password (lets them log in to review their items; leave blank to keep the current one)', 'password'],
  ['h3', 'Listing style', 'h'], ['notes', 'Notes (how this seller writes listings)', 'area'],
  ['terms', 'Custom terms, one per line: their shorthand = meaning (e.g. BJ = Black Jack, Sz = Size)', 'area'],
  ['defaults', 'Defaults, one per line: field = value, used when a listing doesn\'t say (e.g. sized_for = Women, made_in = USA)', 'area'],
];
// Export: WBW import CSV columns, in WBW's order (until the direct WBW connection replaces it).
const CSV = { seller: 'WBW Seller Name', ...Object.fromEntries(FIELDS.map(f => [f, label(f)])), category: 'Category', website_url: 'Seller Website Link', photos: 'Image URLs', source_id: 'Source ID' };
const cell = v => `"${String(Array.isArray(v) ? v.join('|') : v ?? '').replace(/"/g, '""')}"`;
const download = rows => {
  const row = r => ({ ...r, website_url: ['facebook', 'depop', 'poshmark', 'ebay'].includes(r.source) ? '' : r.source_url, wbw_price: r.wbw_price ?? r.price,
    category: ['boot', 'belt'].includes(r.boot) ? GROUPS[r.boot] : '' });
  const csv = [Object.values(CSV), ...rows.map(r => Object.keys(CSV).map(k => row(r)[k]))].map(r => r.map(cell).join(',')).join('\r\n');
  Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([csv], { type: 'text/csv' })), download: `wbw-import-${new Date().toISOString().slice(0, 10)}.csv` }).click();
};
const CONCURRENT = 4; // website products imported at once
const EXTENSION_LINK = /facebook\.com|depop\.com/i; // these sites block servers, so the Chrome extension imports them
const done = n => `Done: ${n.added} added, ${n.updated} updated${n.sold != null ? `, ${n.sold} sold (skipped)` : ''}, ${n.removed} removed, ${n.failed} failed`;

export default function Inventory() {
  const [who, setWho] = useState('');
  const [sellers, setSellers] = useState([]);
  const [sellerForm, setSellerForm] = useState(null); // seller being added/edited
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
  const [ext, setExt] = useState(false); // WBW Importer extension present on this page
  const [err, setErr] = useState('');
  const [me, setMe] = useState({ role: 'team' }); // a seller's own login is locked to their items
  const team = me.role === 'team';

  const current = sellers.find(s => s.seller === who), hasDetails = !!current?.name;
  const setRun = patch => setRunState(r => ({ ...r, ...patch }));
  const loadSellers = () => api('GET', null, '', '/api/sellers').then(setSellers).catch(e => setErr(e.message));
  // A seller's login is always their own items (the server enforces it); the team picks a seller via ?seller=.
  const load = () => (seller() || me.seller ? api('GET', null, `?status=${tab}`).then(setItems).catch(e => setErr(e.message)) : setItems([]));
  const loadRef = useRef(load); loadRef.current = load;

  useEffect(() => {
    api('GET', null, '', '/api/me').then(m => { setMe(m); if (m.seller) setWho(m.seller); }).catch(() => {});
    setWho(seller()); loadSellers();
  }, []);
  useEffect(() => { setSel(new Set()); setEdit(null); setFilter({}); load(); }, [tab, me.seller]);
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
  const exportCsv = () => {
    const rows = items.filter(i => sel.has(i.id)), notReady = rows.filter(i => !isReady(i)).length;
    if (notReady && !confirm(`${notReady} of ${rows.length} items aren't ready (missing or unverified fields). Export anyway?`)) return;
    download(rows); if (tab === 'review') bulk({ action: 'publish' });
  };
  const saveSeller = () => api('POST', { ...sellerForm, rename_from: sellerForm.created_at && current?.name }, '', '/api/sellers')
    .then(s => { setSellerForm(null); s.name === who ? loadSellers() : switchTo(s.name); }).catch(e => setErr(e.message));
  const deleteSeller = () => confirm(`Delete seller "${current.display_name}"?`) &&
    api('DELETE', null, `?name=${encodeURIComponent(current.name)}`, '/api/sellers').then(() => location.assign('/')).catch(e => setErr(e.message));

  // Import = new listings only. Sync = re-read all (refresh source-changed ones), then remove what's gone or sold.
  const startImport = (sync, only) => (EXTENSION_LINK.test(link) ? importViaExtension(sync) : importSite(sync, only));
  const importViaExtension = sync => {
    setErr('');
    if (!ext) return setErr('Facebook and Depop imports run through the WBW Importer Chrome extension. Install it (or reload it at chrome://extensions), then reload this page.');
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

  const gone = tab === 'removed' || tab === 'archived';
  const shown = items.filter(i => searchMatch(i, q)).sort(SORTS[sort]);
  const groups = tab === 'review' ? Object.entries(GROUPS).map(([k, l]) => [k, l, shown.filter(i => i.boot === k)]) : [[tab, TABS[tab], shown]];
  const setForm = f => e => setSellerForm({ ...sellerForm, [f]: e.target.value });
  const setField = f => e => setEdit({ ...edit, [f]: e.target.value });

  return (
    <main>
      <style>{css}</style>
      {Object.entries(CHOICES).map(([f, opts]) => <datalist key={f} id={`dl-${f}`}>{opts.map(o => <option key={o} value={o} />)}</datalist>)}

      <div className="who">
        {!team ? <strong>{current?.display_name ?? who}</strong> : <>Seller: <select value={who} onChange={e => switchTo(e.target.value)}>
          {!current && <option value={who}>{who || 'Pick a seller…'}</option>}
          {sellers.map(s => <option key={s.seller} value={s.seller}>{s.display_name ?? s.seller} — {s.active} items{s.review ? `, ${s.review} new` : ''}</option>)}
        </select>
        {who && <button onClick={() => setSellerForm(hasDetails ? current : { name: who, sync: 'off' })}>{hasDetails ? 'Seller settings' : 'Set up seller'}</button>}
        <button className="primary" onClick={() => setSellerForm({ sync: 'off' })}>+ Add seller</button></>}
        {team && <a className="src" href="/wbw-importer.zip" download title="Needed for Facebook and Depop imports">Chrome extension{ext ? ' ✓' : ''}</a>}
        <a className="src" href="/login" onClick={e => { e.preventDefault(); fetch('/api/login', { method: 'DELETE' }).then(() => location.assign('/login')); }}>Log out</a>
      </div>
      {!ext && EXTENSION_LINK.test(link) && <p className="help">Facebook and Depop import through the WBW Importer Chrome extension:
        1) download it with the <a href="/wbw-importer.zip" download>Chrome extension</a> link and unzip it; 2) open chrome://extensions and turn on
        Developer mode; 3) click Load unpacked and pick the unzipped wbw-importer folder; 4) reload this page.</p>}

      {sellerForm && <div className="panel">
        <strong>{sellerForm.created_at ? 'Edit seller' : 'New seller'}</strong>
        {SELLER_FORM.map(([f, l, kind]) => kind === 'h' ? <h3 key={f}>{l}</h3> :
          <label key={f}>{l}{kind === 'area' ? <textarea rows="3" value={sellerForm[f] ?? ''} onChange={setForm(f)} />
            : kind === 'sync' ? <select value={sellerForm.sync ?? 'off'} onChange={setForm(f)}>
              <option value="off">Off (sync by hand)</option><option value="daily">Daily</option><option value="weekly">Weekly</option></select>
            : <input type={kind === 'password' ? 'password' : 'text'} autoComplete="new-password" value={sellerForm[f] ?? ''} onChange={setForm(f)}
              placeholder={kind === 'password' ? (sellerForm.has_login ? 'Login set — type to change' : 'No login yet') : ''} />}</label>)}
        <span><button className="primary" onClick={saveSeller}>Save seller</button><button onClick={() => setSellerForm(null)}>Cancel</button>
          {sellerForm.created_at && !current?.active && <button onClick={deleteSeller}>Delete seller</button>}</span>
      </div>}
      {team && !who && !sellerForm && <p className="empty">Pick a seller above, or add one.</p>}
      {team && who && !hasDetails && !sellerForm && <p className="err">Set up this seller (details and import settings) before importing for them.</p>}

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
          {!gone && <span className="adj">
            <input inputMode="decimal" placeholder="Lower by" value={adj.value} onChange={e => setAdj({ ...adj, value: e.target.value })} />
            <select value={adj.unit} onChange={e => setAdj({ ...adj, unit: e.target.value })}><option>%</option><option>$</option></select>
            <button onClick={lower}>Apply</button>
          </span>}
          {!gone && <button className="primary" onClick={exportCsv}>Export CSV</button>}
          {!gone && <button onClick={() => bulk({ action: 'remove' })}>Remove</button>}
          {gone && <button onClick={() => bulk({ action: 'restore' })}>Restore</button>}
          {team && <button onClick={() => { const to = prompt('Move the selected items to which seller?'); if (to) bulk({ action: 'move', to }); }}>Move to seller…</button>}
          {team && <button onClick={() => confirm(`Delete ${sel.size} items for good? This can't be undone.`) && bulk({ action: 'delete' })}>Delete</button>}
        </>}
      </div>}

      {who && shown.length === 0 && <p className="empty">{q ? 'Nothing matches the search.' : tab === 'review' ? 'No new imports — use Import above.' : `Nothing ${TABS[tab].toLowerCase()} yet.`}</p>}

      {groups.filter(([, , list]) => list.length).map(([k, l, list]) => {
        const f = FILTERS[filter[k]], visible = f ? list.filter(f[1]) : list;
        return <section key={k}>
          <h2>{l} ({list.length})
            {Object.entries(FILTERS).map(([fk, [fl, test]]) => { const c = list.filter(test).length;
              return (c > 0 || fk === 'ready') && <button key={fk} className={`chip ${fk in LABELS ? 'miss' : ''} ${filter[k] === fk ? 'on' : ''}`}
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
              <span><button className="primary" onClick={save}>Save (marks all verified)</button><button onClick={() => setEdit(null)}>Cancel</button></span>
            </div> : <div className="info" onClick={() => setEdit(i)}>
              <strong>{i.title || 'Untitled'}</strong>
              {i.source_url && <a className="src" href={i.source_url} target="_blank" onClick={e => e.stopPropagation()}>
                View on {{ facebook: 'Facebook', depop: 'Depop', poshmark: 'Poshmark', ebay: 'eBay' }[i.source] ?? i.source}</a>}
              {i.boot === 'unsure' && <small>{Math.round((i.boot_score ?? 0) * 100)}% likely a boot</small>}
              {missing(i).length > 0 && <small className="err">Missing: {missing(i).map(label).join(', ')}</small>}
              {unverified(i).length > 0 && <small className="warn">Verify: {unverified(i).map(label).join(', ')}</small>}
              <dl>{FIELDS.filter(f => f !== 'title' && f !== 'description').map(f =>
                <div key={f} className={flagged(i).includes(f) ? 'err' : unverified(i).includes(f) ? 'guess' : ''}>
                <dt>{label(f)}</dt><dd>{f.includes('price') && i[f] ? `$${Number(i[f]).toFixed(2)}` : i[f] || '—'}</dd></div>)}</dl>
              {i.description && <p className="desc">{i.description}</p>}
              <small>Tap to edit</small>
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

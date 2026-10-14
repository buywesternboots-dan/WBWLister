'use client';
import { useEffect, useState } from 'react';

// Mock auth: seller name from ?seller= (default demo), same as the extension's Seller box.
const seller = () => new URLSearchParams(location.search).get('seller') || 'demo';
const api = (method, body, q = '', path = '/api/items') =>
  fetch(path + q, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${seller()}` }, body: body && JSON.stringify(body) })
    .then(async r => { const j = await r.json(); if (!r.ok) throw new Error(j.error); return j; });

const TABS = { review: 'Newly imported', published: 'Exported', removed: 'Removed', archived: 'Archived' };
// Item fields: key → label. * = required by WBW.
const LABELS = { price: 'Price*', wbw_price: 'WBW Price', title: 'Title*', brand: 'Brand*', sized_for: 'Sized for (Men/Women)*', width: 'Width*',
  material_type: 'Material type', material: 'Material', made_in: 'Where made', condition: 'Condition*', color: 'Color', sole: 'Sole', heel: 'Heel',
  toe: 'Toe', size: 'Size', description: 'Description' };
const FIELDS = Object.keys(LABELS);
const REQUIRED = FIELDS.filter(f => LABELS[f].endsWith('*'));
const missing = i => REQUIRED.filter(f => !i[f]).map(f => LABELS[f].replace(/\*$/, ''));
const unverified = i => (i.guessed ?? []).filter(f => i[f]);
// One-click values for items that genuinely have none.
const PRESETS = { brand: 'Unbranded', size: 'Estimated' };
// WBW import CSV columns, in WBW's order.
const CSV = { seller: 'WBW Seller Name', ...Object.fromEntries(FIELDS.map(f => [f, LABELS[f].replace(/\*$/, '')])), category: 'Category', photos: 'Image URLs', source_id: 'Source ID' };
const cell = v => `"${String(Array.isArray(v) ? v.join('|') : v ?? '').replace(/"/g, '""')}"`;
const download = rows => {
  const csv = [Object.values(CSV), ...rows.map(r => ({ ...r, wbw_price: r.wbw_price ?? r.price, category: GROUPS[r.boot] === 'Unsure' ? '' : GROUPS[r.boot] })).map(r => Object.keys(CSV).map(k => r[k]))].map(r => r.map(cell).join(',')).join('\r\n');
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([csv], { type: 'text/csv' })), download: `wbw-import-${new Date().toISOString().slice(0, 10)}.csv` });
  a.click();
};
// Saved stores for "Import from website" (any other address can be typed).
const SITES = { 'The Boot Whisperer': 'thebootwhisperer.net', 'Nashville Booted (boots)': 'https://nashvillebooted.com/collections/the-boots', 'Bootitude': 'bootitude.net' };
const GROUPS = { boot: 'Boots', belt: 'Belts', unsure: 'Unsure' };

export default function Inventory() {
  const [tab, setTab] = useState('review');
  const [items, setItems] = useState([]);
  const [sel, setSel] = useState(new Set());
  const [edit, setEdit] = useState(null);
  const [adj, setAdj] = useState({ value: '', unit: '%' });
  const [err, setErr] = useState('');
  const [who, setWho] = useState('');
  const [site, setSite] = useState({ url: '', overwrite: false, progress: '' });

  const load = () => api('GET', null, `?status=${tab}`).then(setItems).catch(e => setErr(e.message));
  useEffect(() => { setWho(seller()); setSel(new Set()); setEdit(null); load(); }, [tab]);

  const act = body => { setErr(''); api('PATCH', body).then(() => { setSel(new Set()); setEdit(null); load(); }).catch(e => setErr(e.message)); };
  const bulk = body => act({ ids: [...sel], ...body });
  const toggle = id => setSel(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const lower = () => { const v = Number(adj.value); if (v > 0) bulk({ action: 'price', [adj.unit === '%' ? 'percent' : 'amount']: v }); };
  const exportCsv = () => {
    const rows = items.filter(i => sel.has(i.id)), todo = rows.filter(i => unverified(i).length).length;
    if (todo && !confirm(`${todo} of ${rows.length} items still have auto-filled fields nobody verified (yellow). Export anyway?`)) return;
    download(rows); if (tab === 'review') bulk({ action: 'publish' });
  };
  const save = () => act({ ids: [edit.id], action: 'edit', ...Object.fromEntries(FIELDS.map(f => [f, edit[f]])) });

  // Website import: list the store's products, import them one by one, then (sync) remove what's gone or sold.
  const importSite = async sync => {
    setErr('');
    const say = progress => setSite(s => ({ ...s, progress }));
    try {
      say('Reading the store\'s product list…');
      const { source, urls, known } = await api('GET', null, `?site=${encodeURIComponent(site.url)}`, '/api/import');
      const slug = u => u.split('/').filter(Boolean).pop(), have = new Set(known);
      const todo = site.overwrite ? urls : urls.filter(u => !have.has(u)), listed = new Set(urls.map(slug));
      const n = { added: 0, updated: 0, sold: 0, failed: 0, removed: 0 };
      for (const [i, url] of todo.entries()) {
        say(`Product ${i + 1} of ${todo.length} (${known.length} already imported) — ${n.added} added, ${n.updated} updated, ${n.sold} sold, ${n.failed} failed`);
        try {
          const r = await api('POST', { url, overwrite: site.overwrite }, '', '/api/import');
          if (r.sold) { n.sold++; listed.delete(slug(url)); } else if (r.item?.updated) n.updated++; else if (r.item) n.added++;
        } catch { n.failed++; }
      }
      if (sync) n.removed = (await api('PATCH', { action: 'sync', source, ids: [...listed] })).removed;
      say(`Done: ${n.added} added, ${n.updated} updated, ${n.sold} sold (skipped), ${n.removed} removed, ${n.failed} failed.`);
      load();
    } catch (e) { say(''); setErr(e.message); }
  };

  const gone = tab === 'removed' || tab === 'archived';
  const groups = tab === 'review'
    ? Object.entries(GROUPS).map(([k, label]) => [label, items.filter(i => i.boot === k)])
    : [[TABS[tab], items]];

  return (
    <main>
      <style>{css}</style>
      <form className="who" onSubmit={e => { e.preventDefault(); location.search = `?seller=${encodeURIComponent(e.target.s.value.trim())}`; }}>
        Seller: <input name="s" key={who} defaultValue={who} /> <button>Switch</button>
      </form>
      <div className="site">
        <select value={Object.values(SITES).includes(site.url) ? site.url : ''} onChange={e => setSite({ ...site, url: e.target.value })}>
          <option value="">Import from website…</option>
          {Object.entries(SITES).map(([name, url]) => <option key={url} value={url}>{name}</option>)}
        </select>
        <input placeholder="or type a store address" value={site.url} onChange={e => setSite({ ...site, url: e.target.value.trim() })} />
        <button disabled={!site.url} onClick={() => importSite(false)}>Import</button>
        <button disabled={!site.url} onClick={() => importSite(true)}>Sync</button>
        <label><input type="checkbox" checked={site.overwrite} onChange={e => setSite({ ...site, overwrite: e.target.checked })} /> Update changed</label>
        {site.progress && <small>{site.progress}</small>}
      </div>
      <nav>{Object.entries(TABS).map(([k, label]) =>
        <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{label}</button>)}</nav>

      {err && <p className="err">{err}</p>}

      {items.length > 0 && <div className="bar">
        <label><input type="checkbox" checked={sel.size === items.length}
          onChange={() => setSel(sel.size === items.length ? new Set() : new Set(items.map(i => i.id)))} /> {sel.size} selected</label>
        {sel.size > 0 && <>
          {!gone && <span className="adj">
            <input inputMode="decimal" placeholder="Lower by" value={adj.value} onChange={e => setAdj({ ...adj, value: e.target.value })} />
            <select value={adj.unit} onChange={e => setAdj({ ...adj, unit: e.target.value })}><option>%</option><option>$</option></select>
            <button onClick={lower}>Apply</button>
          </span>}
          {!gone && <button className="primary" onClick={exportCsv}>Export CSV</button>}
          {!gone && <button onClick={() => bulk({ action: 'remove' })}>Remove</button>}
          {gone && <button onClick={() => bulk({ action: 'restore' })}>Restore</button>}
        </>}
      </div>}

      {items.length === 0 && <p className="empty">{tab === 'review' ? 'No new imports. Use the extension on a Marketplace profile to import listings.' : `Nothing ${TABS[tab].toLowerCase()} yet.`}</p>}

      {groups.filter(([, list]) => list.length).map(([label, list]) => <section key={label}>
        <h2>{label} ({list.length})</h2>
        {list.map(i => <div key={i.id} className="item">
          <input type="checkbox" checked={sel.has(i.id)} onChange={() => toggle(i.id)} />
          {i.photos[0] ? <img src={i.photos[0]} alt="" /> : <div className="noimg" />}
          {edit?.id === i.id ? <div className="form">
            {FIELDS.map(f => <label key={f} className={unverified(i).includes(f) ? 'guess' : ''}>
              <span>{LABELS[f]}{unverified(i).includes(f) && ' — auto-filled, verify'}
                {PRESETS[f] && <button type="button" className="preset" onClick={() => setEdit({ ...edit, [f]: PRESETS[f] })}>{PRESETS[f]}</button>}</span>
              {f === 'description'
              ? <textarea rows="4" value={edit[f] ?? ''} onChange={e => setEdit({ ...edit, [f]: e.target.value })} />
              : <input value={edit[f] ?? ''} onChange={e => setEdit({ ...edit, [f]: e.target.value })} />}</label>)}
            <span><button className="primary" onClick={save}>Save (marks all verified)</button><button onClick={() => setEdit(null)}>Cancel</button></span>
          </div> : <div className="info" onClick={() => setEdit(i)}>
            <strong>{i.title || 'Untitled'}</strong>
            {missing(i).length > 0 && <small className="err">Missing: {missing(i).join(', ')}</small>}
            {unverified(i).length > 0 && <small className="warn">Verify: {unverified(i).map(f => LABELS[f].replace(/\*$/, '')).join(', ')}</small>}
            <dl>{FIELDS.filter(f => f !== 'title' && f !== 'description').map(f =>
              <div key={f} className={!i[f] && REQUIRED.includes(f) ? 'err' : unverified(i).includes(f) ? 'guess' : ''}>
              <dt>{LABELS[f].replace(/\*$/, '')}</dt><dd>{f.includes('price') && i[f] ? `$${Number(i[f]).toFixed(2)}` : i[f] || '—'}</dd></div>)}</dl>
            {i.description && <p className="desc">{i.description}</p>}
            <small>Tap to edit</small>
          </div>}
        </div>)}
      </section>)}
    </main>
  );
}

const css = `
body{margin:0;font:16px/1.4 system-ui,sans-serif;color:#2b2118;background:#faf8f5}
main{max-width:760px;margin:0 auto;padding:16px}
nav{display:flex;gap:8px;margin-bottom:16px;overflow-x:auto}
button,select,input,textarea{font:inherit;padding:8px 12px;border:1px solid #cfc6bb;border-radius:6px;background:#fff;color:inherit}
nav button.on,.primary{background:#1f6f6b;border-color:#1f6f6b;color:#fff}
.bar{position:sticky;top:0;display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:10px 0;background:#faf8f5;z-index:1}
.adj{display:flex;gap:4px}.adj input{width:90px}
h2{font-size:15px;margin:20px 0 8px;color:#6b5a4a}
.item{display:flex;gap:12px;align-items:flex-start;padding:10px;background:#fff;border:1px solid #e6dfd6;border-radius:8px;margin-bottom:8px}
.item img,.noimg{width:72px;height:72px;object-fit:cover;border-radius:6px;background:#eee;flex-shrink:0}
.info{display:flex;flex-direction:column;cursor:pointer;flex:1}.info small{color:#8a7a6a}
.form{display:flex;flex-direction:column;gap:6px;flex:1}.form label{display:flex;flex-direction:column;font-size:13px;color:#6b5a4a;gap:2px}.form span{display:flex;gap:6px}
dl{display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:4px 12px;margin:6px 0;font-size:13px}dt{color:#8a7a6a;font-size:11px}dd{margin:0}
.desc{font-size:13px;color:#4a3d31;margin:4px 0;white-space:pre-line;max-height:4.2em;overflow:hidden}
.guess{background:#fff3c4;border-radius:4px;padding:0 4px}.warn{color:#8a5a00}
.preset{margin-left:6px;padding:0 6px;font-size:12px}.form label>span{display:flex;align-items:center}
.site{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-bottom:12px}.site input:not([type]){flex:1;min-width:220px}.site small{width:100%;color:#6b5a4a}
.who{display:flex;gap:6px;align-items:center;margin-bottom:12px}.who input{width:160px}
.err{color:#a3261b}.empty{color:#6b5a4a}
`;

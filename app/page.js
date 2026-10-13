'use client';
import { useEffect, useState } from 'react';

// Mock auth: seller name from ?seller= (default demo), same as the extension's Seller box.
const seller = () => new URLSearchParams(location.search).get('seller') || 'demo';
const api = (method, body, q = '') =>
  fetch('/api/items' + q, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${seller()}` }, body: body && JSON.stringify(body) })
    .then(async r => { const j = await r.json(); if (!r.ok) throw new Error(j.error); return j; });

const TABS = { review: 'Newly imported', published: 'Exported', removed: 'Removed', archived: 'Archived' };
// Item fields: key → label. * = required by WBW.
const LABELS = { price: 'Price*', wbw_price: 'WBW Price', title: 'Title*', brand: 'Brand*', sized_for: 'Sized for (Men/Women)*', width: 'Width*',
  material_type: 'Material type', material: 'Material', made_in: 'Where made', condition: 'Condition*', color: 'Color', sole: 'Sole', heel: 'Heel',
  toe: 'Toe', size: 'Size', description: 'Description' };
const FIELDS = Object.keys(LABELS);
const REQUIRED = FIELDS.filter(f => LABELS[f].endsWith('*'));
const missing = i => REQUIRED.filter(f => !i[f]).map(f => LABELS[f].replace(/\*$/, ''));
// WBW import CSV columns, in WBW's order.
const CSV = { seller: 'WBW Seller Name', ...Object.fromEntries(FIELDS.map(f => [f, LABELS[f].replace(/\*$/, '')])), category: 'Category', photos: 'Image URLs', source_id: 'Source ID' };
const cell = v => `"${String(Array.isArray(v) ? v.join('|') : v ?? '').replace(/"/g, '""')}"`;
const download = rows => {
  const csv = [Object.values(CSV), ...rows.map(r => ({ ...r, wbw_price: r.wbw_price ?? r.price, category: GROUPS[r.boot] === 'Unsure' ? '' : GROUPS[r.boot] })).map(r => Object.keys(CSV).map(k => r[k]))].map(r => r.map(cell).join(',')).join('\r\n');
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([csv], { type: 'text/csv' })), download: `wbw-import-${new Date().toISOString().slice(0, 10)}.csv` });
  a.click();
};
const GROUPS = { boot: 'Boots', belt: 'Belts', unsure: 'Unsure' };

export default function Inventory() {
  const [tab, setTab] = useState('review');
  const [items, setItems] = useState([]);
  const [sel, setSel] = useState(new Set());
  const [edit, setEdit] = useState(null);
  const [adj, setAdj] = useState({ value: '', unit: '%' });
  const [err, setErr] = useState('');
  const [who, setWho] = useState('');

  const load = () => api('GET', null, `?status=${tab}`).then(setItems).catch(e => setErr(e.message));
  useEffect(() => { setWho(seller()); setSel(new Set()); setEdit(null); load(); }, [tab]);

  const act = body => { setErr(''); api('PATCH', body).then(() => { setSel(new Set()); setEdit(null); load(); }).catch(e => setErr(e.message)); };
  const bulk = body => act({ ids: [...sel], ...body });
  const toggle = id => setSel(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const lower = () => { const v = Number(adj.value); if (v > 0) bulk({ action: 'price', [adj.unit === '%' ? 'percent' : 'amount']: v }); };
  const exportCsv = () => { download(items.filter(i => sel.has(i.id))); if (tab === 'review') bulk({ action: 'publish' }); };
  const save = () => act({ ids: [edit.id], action: 'edit', ...Object.fromEntries(FIELDS.map(f => [f, edit[f]])) });

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
            {FIELDS.map(f => <label key={f}>{LABELS[f]}{f === 'description'
              ? <textarea rows="4" value={edit[f] ?? ''} onChange={e => setEdit({ ...edit, [f]: e.target.value })} />
              : <input value={edit[f] ?? ''} onChange={e => setEdit({ ...edit, [f]: e.target.value })} />}</label>)}
            <span><button className="primary" onClick={save}>Save</button><button onClick={() => setEdit(null)}>Cancel</button></span>
          </div> : <div className="info" onClick={() => setEdit(i)}>
            <strong>{i.title || 'Untitled'}</strong>
            <span>WBW ${Number(i.wbw_price ?? i.price ?? 0).toFixed(2)}{i.sized_for && ` · ${i.sized_for}`}{i.size && ` · ${i.size}${i.width ?? ''}`}{i.material && ` · ${i.material}`}{i.condition && ` · ${i.condition}`}</span>
            {missing(i).length > 0 && <small className="err">Missing: {missing(i).join(', ')}</small>}
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
.who{display:flex;gap:6px;align-items:center;margin-bottom:12px}.who input{width:160px}
.err{color:#a3261b}.empty{color:#6b5a4a}
`;

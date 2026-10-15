'use client';
import { useEffect, useState } from 'react';
import { CHOICES, searchMatch } from '../lib/vocab';

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
const label = f => LABELS[f].replace(/\*$/, '');
// Missing = required and empty, or filled with a default because the listing didn't say (e.g. width "M").
const missing = i => REQUIRED.filter(f => !i[f] || (i.defaulted ?? []).includes(f));
const unverified = i => (i.guessed ?? []).filter(f => i[f]);
const isReady = i => !missing(i).length && !unverified(i).length;
// One-click values for items that genuinely have none.
const PRESETS = { brand: 'Unbranded', size: 'Estimated' };
// WBW import CSV columns, in WBW's order.
const CSV = { seller: 'WBW Seller Name', ...Object.fromEntries(FIELDS.map(f => [f, label(f)])), category: 'Category', website_url: 'Seller Website Link', photos: 'Image URLs', source_id: 'Source ID' };
const cell = v => `"${String(Array.isArray(v) ? v.join('|') : v ?? '').replace(/"/g, '""')}"`;
const download = rows => {
  const csv = [Object.values(CSV), ...rows.map(r => ({ ...r, website_url: r.source === 'facebook' ? '' : r.source_url, wbw_price: r.wbw_price ?? r.price, category: ['boot', 'belt'].includes(r.boot) ? GROUPS[r.boot] : '' })).map(r => Object.keys(CSV).map(k => r[k]))].map(r => r.map(cell).join(',')).join('\r\n');
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([csv], { type: 'text/csv' })), download: `wbw-import-${new Date().toISOString().slice(0, 10)}.csv` });
  a.click();
};
// Saved stores for "Import from website" (any other address can be typed).
const SITES = { 'The Boot Whisperer': 'thebootwhisperer.net', 'Nashville Booted (boots)': 'https://nashvillebooted.com/collections/the-boots', 'Bootitude': 'bootitude.net' };
const GROUPS = { boot: 'Boots', belt: 'Belts', unsure: 'Not sure', other: 'Other' };
// Sorts: most likely a boot first, or newest import day first (same day: most likely boot first).
const SORTS = {
  likely: (a, b) => (b.boot_score ?? 0) - (a.boot_score ?? 0) || b.created_at.localeCompare(a.created_at),
  newest: (a, b) => b.created_at.slice(0, 10).localeCompare(a.created_at.slice(0, 10)) || (b.boot_score ?? 0) - (a.boot_score ?? 0),
};
// Group header quick filters: Ready, To verify, and one per missing required field.
const FILTERS = { ready: ['Ready', isReady], verify: ['To verify', i => unverified(i).length > 0],
  ...Object.fromEntries(REQUIRED.map(f => [f, [`Missing ${label(f)}`, i => missing(i).includes(f)]])) };
const CONCURRENT = 4; // website products imported at once

export default function Inventory() {
  const [tab, setTab] = useState('review');
  const [items, setItems] = useState([]);
  const [sel, setSel] = useState(new Set());
  const [edit, setEdit] = useState(null);
  const [adj, setAdj] = useState({ value: '', unit: '%' });
  const [err, setErr] = useState('');
  const [who, setWho] = useState('');
  const [sellers, setSellers] = useState([]);
  const [q, setQ] = useState('');
  const [sort, setSort] = useState('likely');
  const [filter, setFilter] = useState({}); // group → FILTERS key
  const [site, setSite] = useState({ url: '', run: null, failed: [] });

  const load = () => api('GET', null, `?status=${tab}`).then(setItems).catch(e => setErr(e.message));
  useEffect(() => { api('GET', null, '?sellers').then(setSellers).catch(() => {}); }, []);
  const switchTo = name => { if (name?.trim()) location.search = `?seller=${encodeURIComponent(name.trim().toLowerCase())}`; };
  useEffect(() => { setWho(seller()); setSel(new Set()); setEdit(null); setFilter({}); load(); }, [tab]);

  const act = body => { setErr(''); api('PATCH', body).then(() => { setSel(new Set()); setEdit(null); load(); }).catch(e => setErr(e.message)); };
  const bulk = body => act({ ids: [...sel], ...body });
  const toggle = id => setSel(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const lower = () => { const v = Number(adj.value); if (v > 0) bulk({ action: 'price', [adj.unit === '%' ? 'percent' : 'amount']: v }); };
  const exportCsv = () => {
    const rows = items.filter(i => sel.has(i.id)), todo = rows.filter(i => !isReady(i)).length;
    if (todo && !confirm(`${todo} of ${rows.length} items aren't ready (missing or unverified fields). Export anyway?`)) return;
    download(rows); if (tab === 'review') bulk({ action: 'publish' });
  };
  const save = () => act({ ids: [edit.id], action: 'edit', ...Object.fromEntries(FIELDS.map(f => [f, edit[f]])) });

  // Website import: Import = new products only. Sync = re-read all (refresh changed ones), then remove what's gone or sold.
  // retry: just these product URLs. Runs CONCURRENT at a time; stops if 5 in a row fail (something's wrong, not just one product).
  const importSite = async (sync, retry) => {
    setErr('');
    const run = patch => setSite(s => ({ ...s, run: { ...s.run, ...patch } }));
    setSite(s => ({ ...s, failed: [], run: { label: 'Reading the store\'s product list…', done: 0, total: 0 } }));
    try {
      const { source, urls, known } = retry ? { urls: retry, known: [] } : await api('GET', null, `?site=${encodeURIComponent(site.url)}`, '/api/import');
      const slug = u => u.split('/').filter(Boolean).pop(), have = new Set(known);
      const todo = sync ? urls : urls.filter(u => !have.has(u)), listed = new Set(urls.map(slug));
      const n = { added: 0, updated: 0, sold: 0, failed: 0, removed: 0 };
      let next = 0, streak = 0, stop = '';
      run({ label: sync ? 'Syncing' : 'Importing', total: todo.length });
      const worker = async () => {
        while (next < todo.length && !stop) {
          const url = todo[next++];
          try {
            const r = await api('POST', { url }, '', '/api/import');
            streak = 0;
            if (r.sold) { n.sold++; listed.delete(slug(url)); } else if (r.item?.updated) n.updated++; else if (r.item) n.added++;
          } catch (e) {
            n.failed++; setSite(s => ({ ...s, failed: [...s.failed, { url, error: e.message }] }));
            if (++streak >= 5) stop = e.message;
          }
          run({ done: n.added + n.updated + n.sold + n.failed });
        }
      };
      await Promise.all(Array.from({ length: CONCURRENT }, worker));
      if (stop) throw new Error(`Import stopped — 5 products in a row failed: ${stop}`);
      if (sync) n.removed = (await api('PATCH', { action: 'sync', source, ids: [...listed] })).removed;
      run({ label: `Done: ${n.added} added, ${n.updated} updated, ${n.sold} sold (skipped), ${n.removed} removed, ${n.failed} failed`, done: todo.length });
      load();
    } catch (e) { run({ label: '' }); setErr(e.message); load(); }
  };

  const gone = tab === 'removed' || tab === 'archived';
  const shown = items.filter(i => searchMatch(i, q)).sort(SORTS[sort]);
  const groups = tab === 'review' ? Object.entries(GROUPS).map(([k, l]) => [k, l, shown.filter(i => i.boot === k)]) : [[tab, TABS[tab], shown]];
  const r = site.run;

  return (
    <main>
      <style>{css}</style>
      {Object.entries(CHOICES).map(([f, opts]) => <datalist key={f} id={`dl-${f}`}>{opts.map(o => <option key={o} value={o} />)}</datalist>)}
      <div className="who">
        Seller: <select value={who} onChange={e => e.target.value === '+' ? switchTo(prompt('New seller name (their WBW seller name):')) : switchTo(e.target.value)}>
          {!sellers.some(s => s.seller === who) && <option value={who}>{who}</option>}
          {sellers.map(s => <option key={s.seller} value={s.seller}>{s.seller} — {s.active} items{s.review ? `, ${s.review} new` : ''}</option>)}
          <option value="+">+ New seller…</option>
        </select>
      </div>
      <div className="site">
        <select value={Object.values(SITES).includes(site.url) ? site.url : ''} onChange={e => setSite({ ...site, url: e.target.value })}>
          <option value="">Import from website…</option>
          {Object.entries(SITES).map(([name, url]) => <option key={url} value={url}>{name}</option>)}
        </select>
        <input placeholder="or type a store address" value={site.url} onChange={e => setSite({ ...site, url: e.target.value.trim() })} />
        <button disabled={!site.url} onClick={() => importSite(false)}>Import</button>
        <button disabled={!site.url} onClick={() => importSite(true)}>Sync</button>
        {r?.label && <div className="run">{r.total > 0 && <progress value={r.done} max={r.total} />}
          <small>{r.label}{r.total > 0 && r.done < r.total && ` — ${r.done} of ${r.total}`}</small></div>}
        {site.failed.length > 0 && <details className="failed">
          <summary>{site.failed.length} failed <button onClick={() => importSite(false, site.failed.map(f => f.url))}>Retry failed</button></summary>
          {site.failed.map(f => <div key={f.url}><a href={f.url} target="_blank">{f.url.split('/').pop()}</a> — {f.error}</div>)}
        </details>}
      </div>
      <nav>{Object.entries(TABS).map(([k, l]) =>
        <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}</nav>

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
          <button onClick={() => { const to = prompt('Move the selected items to which seller?'); if (to) bulk({ action: 'move', to }); }}>Move to seller…</button>
          {gone && <button onClick={() => bulk({ action: 'restore' })}>Restore</button>}
        </>}
      </div>}

      {shown.length === 0 && <p className="empty">{q ? 'Nothing matches the search.' : tab === 'review' ? 'No new imports. Use the extension or Import from website.' : `Nothing ${TABS[tab].toLowerCase()} yet.`}</p>}

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
            {i.photos[0] ? <img src={i.photos[0]} alt="" /> : <div className="noimg" />}
            {edit?.id === i.id ? <div className="form">
              {FIELDS.map(f => <label key={f} className={unverified(i).includes(f) ? 'guess' : missing(i).includes(f) ? 'miss' : ''}>
                <span>{LABELS[f]}{unverified(i).includes(f) && ' — auto-filled, verify'}{(i.defaulted ?? []).includes(f) && ' — not in listing, default used'}
                  {PRESETS[f] && <button type="button" className="preset" onClick={() => setEdit({ ...edit, [f]: PRESETS[f] })}>{PRESETS[f]}</button>}</span>
                {f === 'description'
                ? <textarea rows="4" value={edit[f] ?? ''} onChange={e => setEdit({ ...edit, [f]: e.target.value })} />
                : <input list={CHOICES[f] && `dl-${f}`} value={edit[f] ?? ''} onChange={e => setEdit({ ...edit, [f]: e.target.value })} />}</label>)}
              <span><button className="primary" onClick={save}>Save (marks all verified)</button><button onClick={() => setEdit(null)}>Cancel</button></span>
            </div> : <div className="info" onClick={() => setEdit(i)}>
              <strong>{i.title || 'Untitled'}</strong>
              {i.source_url && <a className="src" href={i.source_url} target="_blank" onClick={e => e.stopPropagation()}>View on {i.source === 'facebook' ? 'Facebook' : i.source}</a>}
              {i.boot === 'unsure' && <small>{Math.round((i.boot_score ?? 0) * 100)}% likely a boot</small>}
              {missing(i).length > 0 && <small className="err">Missing: {missing(i).map(label).join(', ')}</small>}
              {unverified(i).length > 0 && <small className="warn">Verify: {unverified(i).map(label).join(', ')}</small>}
              <dl>{FIELDS.filter(f => f !== 'title' && f !== 'description').map(f =>
                <div key={f} className={missing(i).includes(f) ? 'err' : unverified(i).includes(f) ? 'guess' : ''}>
                <dt>{label(f)}</dt><dd>{f.includes('price') && i[f] ? `$${Number(i[f]).toFixed(2)}` : i[f] || '—'}{(i.defaulted ?? []).includes(f) && ' (default)'}</dd></div>)}</dl>
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
nav{display:flex;gap:8px;margin-bottom:16px;overflow-x:auto}
button,select,input,textarea{font:inherit;padding:8px 12px;border:1px solid #cfc6bb;border-radius:6px;background:#fff;color:inherit}
nav button.on,.primary{background:#1f6f6b;border-color:#1f6f6b;color:#fff}
.bar{position:sticky;top:0;display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:10px 0;background:#faf8f5;z-index:1}
.adj{display:flex;gap:4px}.adj input{width:90px}
.tools{display:flex;gap:6px;margin-bottom:4px}.tools input{flex:1;min-width:0}
h2{font-size:15px;margin:20px 0 8px;color:#6b5a4a;display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.chip{font-size:12px;padding:2px 8px;border-radius:12px}.chip.miss{color:#a3261b;border-color:#e3b3ad}.chip.on{background:#1f6f6b;border-color:#1f6f6b;color:#fff}
.item{display:flex;gap:12px;align-items:flex-start;padding:10px;background:#fff;border:1px solid #e6dfd6;border-radius:8px;margin-bottom:8px}
.item img,.noimg{width:72px;height:72px;object-fit:cover;border-radius:6px;background:#eee;flex-shrink:0}
.info{display:flex;flex-direction:column;cursor:pointer;flex:1;min-width:0}.info small{color:#8a7a6a}
.form{display:flex;flex-direction:column;gap:6px;flex:1}.form label{display:flex;flex-direction:column;font-size:13px;color:#6b5a4a;gap:2px}.form span{display:flex;gap:6px}
dl{display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:4px 12px;margin:6px 0;font-size:13px}dt{color:#8a7a6a;font-size:11px}dd{margin:0}
.desc{font-size:13px;color:#4a3d31;margin:4px 0;white-space:pre-line;max-height:4.2em;overflow:hidden}
.guess{background:#fff3c4;border-radius:4px;padding:0 4px}.warn{color:#8a5a00!important}
.miss{background:#fde8e6;border-radius:4px;padding:0 4px}
.preset{margin-left:6px;padding:0 6px;font-size:12px}.form label>span{display:flex;align-items:center}
.site{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-bottom:12px}.site input:not([type]){flex:1;min-width:220px}
.run{width:100%;display:flex;flex-direction:column;gap:2px}.run progress{width:100%}.run small{color:#6b5a4a}
.failed{width:100%;font-size:13px;color:#a3261b;max-height:200px;overflow:auto}.failed a{color:inherit}
.who{display:flex;gap:6px;align-items:center;margin-bottom:12px}.who select{flex:1;min-width:0}
.src{font-size:13px;color:#1f6f6b;align-self:flex-start}
.err{color:#a3261b!important}.empty{color:#6b5a4a}
`;

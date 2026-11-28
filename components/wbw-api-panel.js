'use client';
import { useEffect, useState } from 'react';

const SHIP = [['conus', 'Continental US'], ['usa', 'USA'], ['global', 'Global'], ['pickup', 'Pickup']];

// Admin WBW panel. Sends seller id, listing ids, and the publish choice. The server fills in the account.
export default function WbwApiPanel({ seller, selected = [], api, onSaved }) {
  const [authorized, setAuthorized] = useState(false);
  const [health, setHealth] = useState(null);
  const [mode, setMode] = useState('draft');
  const [shippingType, setShippingType] = useState('conus');
  const [shippingCost, setShippingCost] = useState(seller?.ship_price || '');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [results, setResults] = useState([]);
  const [err, setErr] = useState('');

  useEffect(() => {
    setAuthorized(false);
    setHealth(null);
    setResults([]);
    setNote('');
    setErr('');
    setShippingCost(seller?.ship_price || '');
  }, [seller?.seller, seller?.ship_price]);

  const call = (method, body, q = '') => api(method, body, q, '/api/wbw');
  const run = async (work) => {
    setErr('');
    setBusy(true);
    try { await work(); }
    catch (e) { setErr(e.message || 'Something went wrong.'); }
    finally { setBusy(false); }
  };
  const test = () => run(async () => { setHealth(await call('GET', null, '?action=health')); });
  const connect = () => run(async () => {
    if (!authorized) throw new Error('Tick authorized to confirm the seller permitted account setup.');
    await call('POST', { action: 'seller', seller: seller.seller, authorized: true });
    setNote('Seller connected.');
    onSaved?.();
  });
  const refresh = () => run(async () => {
    await call('GET', null, `?action=status&seller=${encodeURIComponent(seller.seller)}`);
    setNote('Status refreshed.');
    onSaved?.();
  });
  const sendIds = async ids => {
    const publish = mode === 'publish';
    if (!ids.length) throw new Error('Select at least one listing.');
    if (publish && !String(shippingCost).trim()) throw new Error('Enter the shipping cost.');
    const out = [];
    for (let i = 0; i < ids.length; i++) {
      setNote(`Sending ${i + 1} of ${ids.length}…`);
      try {
        const body = { action: 'import', seller: seller.seller, ids: [ids[i]], publish };
        if (publish) { body.shipping_type = shippingType; body.shipping_cost = String(shippingCost).trim(); }
        const res = await call('POST', body);
        out.push(...(res.results || []));
      } catch (e) {
        out.push({ id: ids[i], kind: 'error', message: e.message, unconfirmed: true });
      }
      setResults([...out]);
    }
    setNote('Send finished.');
    onSaved?.();
  };
  const send = () => run(() => sendIds(selected));
  const retry = () => run(() => sendIds(results.filter(r => r.unconfirmed && r.id != null).map(r => r.id)));
  const checked = seller?.wbw_status?.last_checked;

  return (
    <section className="panel wbw-api" data-wbw-api aria-label="WBW connection">
      <h3>WBW</h3>
      <p className="hint">Email, display name, and location come from this seller’s saved record.</p>
      <p>{seller?.email || 'No email on file'} · {seller?.display_name || 'No display name'} · {seller?.location || 'No location'}</p>
      {(seller?.wbw_seller_id || checked) && <p>WBW profile {seller.wbw_seller_id || '—'}{checked ? ` · last checked ${String(checked).replace('T', ' ').slice(0, 16)}` : ''}</p>}
      <span>
        <button type="button" disabled={busy} onClick={test}>Test connection</button>
        <label className="check"><input type="checkbox" checked={authorized} onChange={e => setAuthorized(e.target.checked)} /> Seller authorized account setup and inventory transfer</label>
        <button type="button" disabled={busy} onClick={connect}>Connect seller</button>
        <button type="button" disabled={busy} onClick={refresh}>Refresh status</button>
      </span>
      {health && <p data-wbw-health>Connection {health.ok ? 'ok' : 'not ok'}{Array.isArray(health.capabilities) ? ` · ${health.capabilities.join(', ')}` : ''}{health.limits ? ` · ${health.limits.itemsPerRequest} per request, ${health.limits.photosPerItem} photos` : ''}</p>}
      <span>
        <label className="check"><input type="radio" name="wbw-mode" checked={mode === 'draft'} onChange={() => setMode('draft')} /> Draft</label>
        <label className="check"><input type="radio" name="wbw-mode" checked={mode === 'publish'} onChange={() => setMode('publish')} /> Request publication</label>
        {mode === 'publish' && <>
          <select value={shippingType} onChange={e => setShippingType(e.target.value)} aria-label="Shipping type">
            {SHIP.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
          </select>
          <input value={shippingCost} onChange={e => setShippingCost(e.target.value)} placeholder="Shipping cost" aria-label="Shipping cost" />
        </>}
        <button type="button" className="primary" disabled={busy} onClick={send}>Send to WBW ({selected.length})</button>
        {results.some(r => r.unconfirmed) && <button type="button" disabled={busy} onClick={retry}>Retry unconfirmed</button>}
      </span>
      {note && <p>{note}</p>}
      {err && <p className="err" role="alert">{err}</p>}
      {results.length > 0 && <ul data-wbw-results>
        {results.map((r, n) => <li key={`${n}-${r.id}`} data-wbw-result={r.kind}>{r.id}: {r.kind}{r.message ? ` — ${r.message}` : ''}</li>)}
      </ul>}
    </section>
  );
}

'use client';
import { useEffect, useState } from 'react';

const et = v => v ? new Date(v).toLocaleString('en-US', { timeZone: 'America/New_York', dateStyle: 'medium', timeStyle: 'short' }) + ' ET' : 'never';
const LABEL = { new: 'New on WBW', price: 'Price changed', update: 'Details changed', 'mark-sold': 'Mark sold on WBW', held: 'Waiting for approval' };

// WBW sync view (admin). BootLister cannot write to WBW: download the delta, apply it on WBW by hand, then Mark applied.
export default function WbwSyncPanel({ api, seller, onChange }) {
  const [data, setData] = useState(null), [err, setErr] = useState(''), [busy, setBusy] = useState('');
  const load = () => api('GET', null, '', '/api/sync').then(setData).catch(e => setErr(e.message));
  useEffect(() => { setData(null); if (seller) load(); }, [seller]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!seller) return null;
  const run = (label, fn) => { setErr(''); setBusy(label); return fn().then(() => { load(); onChange?.(); }).catch(e => setErr(e.message)).finally(() => setBusy('')); };
  const download = () => run('csv', async () => {
    const { csv } = await api('GET', null, '?format=csv', '/api/sync');
    Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([csv], { type: 'text/csv' })), download: `wbw-sync-${seller}-${new Date().toISOString().slice(0, 10)}.csv` }).click();
  });
  const rows = (data?.delta ?? []).filter(r => r.action !== 'held');
  const applied = () => rows.length && confirm(`Mark ${rows.length} change${rows.length === 1 ? '' : 's'} as applied on WBW?`) && run('applied', () => api('POST', { action: 'applied', ids: rows.map(r => r.id) }, '', '/api/sync'));
  const rescan = () => run('rescan', async () => { const r = await api('POST', { action: 'rescan' }, '', '/api/sync'); setErr(`Re-scan: ${r.added} new, ${r.updated} changed, ${r.unchanged} unchanged, ${r.sold + r.removed} gone${r.failed ? `, ${r.failed} failed` : ''}${r.partial ? ` (stopped at the time limit, ${r.left} not read; nothing marked sold)` : ''}.`); });
  return <div className="panel" data-wbw-sync>
    <strong>WBW sync</strong>
    <small>Primary inventory tool: {data?.primary_source || 'not set (Seller settings › Advanced)'} · Last applied on WBW: {et(data?.last_synced_at)} · Last re-scan: {et(data?.last_scan_at)}</small>
    {data && <small>{Object.entries(data.counts).map(([k, n]) => `${LABEL[k]}: ${n}`).join(' · ')}</small>}
    <span>
      <button onClick={download} disabled={!!busy || !rows.length}>Download WBW changes (CSV)</button>
      <button onClick={applied} disabled={!!busy || !rows.length}>Mark applied on WBW</button>
      <button onClick={rescan} disabled={!!busy}>{busy === 'rescan' ? 'Re-scanning…' : 'Re-scan source'}</button>
    </span>
    {rows.length > 0 && <ul>{rows.slice(0, 20).map(r => <li key={r.id}>{LABEL[r.action]}: {r.title}{r.changed?.length ? ` (${r.changed.join(', ')})` : ''}{r.reason ? ` (${r.reason})` : ''}</li>)}</ul>}
    {err && <small className="warn">{err}</small>}
  </div>;
}

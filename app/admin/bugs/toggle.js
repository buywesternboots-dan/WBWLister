'use client';
import { useState } from 'react';

export default function MarkFixed({ id, status }) {
  const [current, setCurrent] = useState(status === 'fixed' ? 'fixed' : 'open');
  const [err, setErr] = useState('');
  const fixed = current === 'fixed';
  return <>
    <button type="button" aria-pressed={fixed} onClick={async () => {
      setErr('');
      const next = fixed ? 'open' : 'fixed';
      const r = await fetch('/api/bug-reports', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, status: next }),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) { setErr(body.error || 'Could not update.'); return; }
      setCurrent(body.status === 'fixed' ? 'fixed' : 'open');
    }} style={{ font: 'inherit', padding: '8px 12px', borderRadius: 6, border: '1px solid #cfc6bb', background: fixed ? '#1f6f6b' : '#fff', color: fixed ? '#fff' : '#2b2118' }}>{fixed ? 'Marked fixed' : 'Mark fixed'}</button>
    {err && <small style={{ color: '#a3261b' }}>{err}</small>}
  </>;
}

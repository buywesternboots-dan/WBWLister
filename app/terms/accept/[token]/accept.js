'use client';
import { useState } from 'react';

const fmt = iso => new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

export default function AcceptTerms({ token, acceptedAt }) {
  const [at, setAt] = useState(acceptedAt);
  const [ok, setOk] = useState(false);
  const [name, setName] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  if (at) return <p className="ok" role="status">Accepted on {fmt(at)}.</p>;
  const submit = async e => {
    e.preventDefault(); setErr(''); setBusy(true);
    try {
      const r = await fetch('/api/terms-accept', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, accepted: ok, full_name: name }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'Could not save that.');
      setAt(j.accepted_at);
    } catch (ex) { setErr(ex.message); } finally { setBusy(false); }
  };
  return (
    <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <label className="check"><input type="checkbox" checked={ok} onChange={e => setOk(e.target.checked)} required /> I accept these terms</label>
      <label>Type your full name<input required maxLength={200} value={name} onChange={e => setName(e.target.value)} autoComplete="name" /></label>
      {err && <p className="err" role="alert">{err}</p>}
      <button type="submit" className="primary" disabled={busy}>{busy ? 'Saving…' : 'Accept'}</button>
    </form>
  );
}

'use client';
import { useState } from 'react';

// Team: password only. Sellers: their WBW seller name + the password set for them in Seller settings.
export default function Login() {
  const [err, setErr] = useState('');
  const submit = async e => {
    e.preventDefault();
    const body = { seller: e.target.seller.value, password: e.target.pw.value };
    const r = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    r.ok ? location.assign('/') : setErr((await r.json()).error);
  };
  const field = { font: 'inherit', padding: 8, border: '1px solid #cfc6bb', borderRadius: 6 };
  return <form onSubmit={submit} style={{ maxWidth: 320, margin: '20vh auto', display: 'flex', flexDirection: 'column', gap: 8, font: '16px system-ui', padding: 16 }}>
    <strong>WBW Lister</strong>
    <input name="seller" placeholder="Seller name (sellers only)" autoComplete="username" style={field} />
    <input name="pw" type="password" placeholder="Password" autoComplete="current-password" autoFocus style={field} />
    <button style={{ ...field, background: '#1f6f6b', color: '#fff', borderColor: '#1f6f6b' }}>Log in</button>
    <small style={{ color: '#6b5a4a' }}>Team members: leave the seller name empty.</small>
    {err && <small style={{ color: '#a3261b' }}>{err}</small>}
  </form>;
}

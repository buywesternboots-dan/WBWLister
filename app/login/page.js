'use client';
import { useState } from 'react';

// One form for the team and for sellers. Username is always an email; the PIN has no complexity rules.
export default function Login() {
  const [err, setErr] = useState('');
  const submit = async e => {
    e.preventDefault();
    const body = { email: e.target.email.value, pin: e.target.pin.value };
    const r = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (r.ok) return location.assign('/');
    setErr((await r.json().catch(() => ({}))).error || 'Could not sign in.');
  };
  const field = { font: 'inherit', padding: 8, border: '1px solid #cfc6bb', borderRadius: 6 };
  return <form onSubmit={submit} style={{ maxWidth: 380, margin: '16vh auto', display: 'flex', flexDirection: 'column', gap: 8, font: '16px system-ui', padding: 16 }}>
    <strong>WBW Lister</strong>
    <input name="email" type="email" placeholder="Email" autoComplete="username" required autoFocus style={field} />
    <input name="pin" type="password" placeholder="PIN or password" autoComplete="current-password" required style={field} />
    <button style={{ ...field, background: '#1f6f6b', color: '#fff', borderColor: '#1f6f6b' }}>Log in</button>
    <small style={{ color: '#6b5a4a' }}>
      Username is always an email. Nothing here is a built-in account. Team login: set TEAM_EMAIL and TEAM_PIN (any PIN — it is stored hashed) plus APP_PASSWORD (that only signs the session, it is not the PIN). Seller login: save their Email and a PIN in Seller settings. A seller only sees their own items.
    </small>
    {err && <small style={{ color: '#a3261b' }}>{err}</small>}
  </form>;
}

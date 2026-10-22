'use client';
import { useState } from 'react';
import { HOME } from '../../lib/home';

// One form for an admin and for sellers. Username is always an email; the PIN has no complexity rules.
// Both land on the same screen (HOME). An admin gets every tool there; a seller only sees their items.
export default function Login() {
  const [err, setErr] = useState('');
  const submit = async e => {
    e.preventDefault();
    const body = { email: e.target.email.value, pin: e.target.pin.value };
    const r = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (r.ok) return location.assign(HOME);
    setErr((await r.json().catch(() => ({}))).error || 'Could not sign in.');
  };
  const field = { font: 'inherit', padding: 8, border: '1px solid #cfc6bb', borderRadius: 6 };
  return <form onSubmit={submit} style={{ maxWidth: 380, margin: '16vh auto', display: 'flex', flexDirection: 'column', gap: 8, font: '16px system-ui', padding: 16 }}>
    <strong>WBW Lister</strong>
    <input name="email" type="email" placeholder="Email" autoComplete="username" required autoFocus style={field} />
    <input name="pin" type="password" placeholder="PIN or password" autoComplete="current-password" required style={field} />
    <button style={{ ...field, background: '#1f6f6b', color: '#fff', borderColor: '#1f6f6b' }}>Log in</button>
    <small style={{ color: '#6b5a4a' }}>
      Username is always an email. An admin and a seller use this same form and land on one screen: sellers, import, review, export, sync, and settings. A seller stays on that screen and only sees their own items. Admin login: set TEAM_EMAIL and TEAM_PIN (any PIN — stored hashed) plus APP_PASSWORD (it only signs the session). Seller login: save their Email and a PIN in Seller settings.
    </small>
    {err && <small style={{ color: '#a3261b' }}>{err}</small>}
  </form>;
}

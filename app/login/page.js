'use client';
import { useState } from 'react';
import { homeFor } from '../../lib/home';

// One form for an admin and for sellers. Username is always an email; the PIN has no complexity rules.
// Sign-in sends an admin to the admin screen and a seller to the seller screen.
export default function Login() {
  const [err, setErr] = useState('');
  const submit = async e => {
    e.preventDefault();
    const body = { email: e.target.email.value, pin: e.target.pin.value };
    const r = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (r.ok) return location.assign(homeFor(j.role));
    setErr(j.error || 'Could not sign in.');
  };
  const field = { font: 'inherit', padding: 8, border: '1px solid #cfc6bb', borderRadius: 6 };
  return <form onSubmit={submit} style={{ maxWidth: 380, margin: '16vh auto', display: 'flex', flexDirection: 'column', gap: 8, font: '16px system-ui', padding: 16 }}>
    <strong>WBW Lister</strong>
    <input name="email" type="email" placeholder="Email" autoComplete="username" required autoFocus style={field} />
    <input name="pin" type="password" placeholder="PIN or password" autoComplete="current-password" required style={field} />
    <button style={{ ...field, background: '#1f6f6b', color: '#fff', borderColor: '#1f6f6b' }}>Log in</button>
    <small style={{ color: '#6b5a4a' }}>
      Username is always an email. An admin and a seller use this same form. An admin then gets one screen with every tool: sellers, import, review, export, sync, and settings. A seller gets a separate screen with only their own items — no seller admin, and no move or delete. Admin login: set TEAM_EMAIL and TEAM_PIN (any PIN — stored hashed) plus APP_PASSWORD (it only signs the session). Seller login: save their Email and a PIN in Seller settings.
    </small>
    {err && <small style={{ color: '#a3261b' }}>{err}</small>}
  </form>;
}

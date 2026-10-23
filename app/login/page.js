'use client';
import { useState } from 'react';
import { homeFor } from '../../lib/home';

// Sellers register with an email or a phone number and a password. Staff use the username "admin".
const field = { font: 'inherit', padding: 8, border: '1px solid #cfc6bb', borderRadius: 6 };

export default function Login() {
  const [err, setErr] = useState('');
  const [reg, setReg] = useState(false);
  const submit = async e => {
    e.preventDefault();
    setErr('');
    const f = e.target;
    const body = reg
      ? { display_name: f.shop.value, email: f.email.value, phone: f.phone.value, password: f.password.value }
      : { email: f.email.value, password: f.password.value };
    if (reg && !body.email.trim() && !body.phone.trim()) return setErr('Add an email or a phone number.');
    const r = await fetch(reg ? '/api/register' : '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (r.ok) return location.assign(homeFor(j.role));
    setErr(j.error || 'Could not sign in.');
  };
  return <form onSubmit={submit} style={{ maxWidth: 420, margin: '12vh auto', display: 'flex', flexDirection: 'column', gap: 8, font: '16px system-ui', padding: 16 }}>
    <strong>WBW Lister</strong>
    {reg && <input name="shop" placeholder="Shop name" required autoFocus style={field} />}
    <input name="email" type={reg ? 'email' : 'text'} placeholder={reg ? 'Email (or leave blank and use phone)' : 'Email, phone, or admin'} autoComplete="username" required={!reg} autoFocus={!reg} style={field} />
    {reg && <input name="phone" type="tel" placeholder="Phone (or leave blank and use email)" autoComplete="tel" style={field} />}
    <input name="password" type="password" placeholder={reg ? 'Password (at least 8 characters)' : 'Password'} autoComplete={reg ? 'new-password' : 'current-password'} required minLength={reg ? 8 : undefined} style={field} />
    <button style={{ ...field, background: '#1f6f6b', color: '#fff', borderColor: '#1f6f6b' }}>{reg ? 'Create account' : 'Log in'}</button>
    <button type="button" onClick={() => { setReg(!reg); setErr(''); }} style={{ ...field, background: '#fff' }}>{reg ? 'Have an account? Log in' : 'New seller? Create an account'}</button>
    <small style={{ color: '#6b5a4a' }}>
      Sellers register with an email or a phone number and a password, then only see their own items. Approving a listing marks it exported here — nothing is sent to the live site yet. WBW staff sign in with the username admin and the admin password. In production the site stays closed until that password is set (ADMIN_PASSWORD, or APP_PASSWORD if that is the one configured).
    </small>
    {err && <small style={{ color: '#a3261b' }}>{err}</small>}
  </form>;
}

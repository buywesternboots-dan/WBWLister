'use client';
import { useEffect, useState } from 'react';
import { homeFor } from '../../lib/home';

// Sellers register with an email or a phone number and a password. Staff use the username "admin".
// An invite code (from an admin, shown once) is the only way to take over a seller the admin already created.
const field = { font: 'inherit', padding: 8, border: '1px solid #cfc6bb', borderRadius: 6 };

export default function Login() {
  const [err, setErr] = useState('');
  const [mode, setMode] = useState('in');
  const [code, setCode] = useState('');
  useEffect(() => { const q = new URLSearchParams(location.search).get('invite'); if (q) { setMode('invite'); setCode(q); } }, []);
  const submit = async e => {
    e.preventDefault();
    setErr('');
    const f = e.target;
    const body = mode === 'reg'
      ? { display_name: f.shop.value, email: f.email.value, phone: f.phone.value, password: f.password.value }
      : mode === 'invite' ? { invite: code, password: f.password.value }
      : { email: f.email.value, password: f.password.value };
    if (mode === 'reg' && !body.email.trim() && !body.phone.trim()) return setErr('Add an email or a phone number.');
    if (mode === 'invite' && !code.trim()) return setErr('Paste the invite code.');
    const r = await fetch(mode === 'in' ? '/api/login' : '/api/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (r.ok) return location.assign(homeFor(j.role));
    setErr(j.error || 'Could not sign in.');
  };
  return <form onSubmit={submit} style={{ maxWidth: 420, margin: '12vh auto', display: 'flex', flexDirection: 'column', gap: 8, font: '16px system-ui', padding: 16 }}>
    <strong>BootLister</strong>
    {mode === 'reg' && <input name="shop" placeholder="Shop name" required autoFocus style={field} />}
    {mode === 'invite' ? <input value={code} onChange={e => setCode(e.target.value)} placeholder="Invite code" autoFocus required style={field} />
      : <input name="email" type={mode === 'reg' ? 'email' : 'text'} placeholder={mode === 'reg' ? 'Email (or leave blank and use phone)' : 'Email, phone, or admin'} autoComplete="username" required={mode === 'in'} autoFocus={mode === 'in'} style={field} />}
    {mode === 'reg' && <input name="phone" type="tel" placeholder="Phone (or leave blank and use email)" autoComplete="tel" style={field} />}
    <input name="password" type="password" placeholder={mode === 'in' ? 'Password' : 'Password (at least 8 characters)'} autoComplete={mode === 'in' ? 'current-password' : 'new-password'} required minLength={mode === 'in' ? undefined : 8} style={field} />
    <button style={{ ...field, background: '#1f6f6b', color: '#fff', borderColor: '#1f6f6b' }}>{mode === 'reg' ? 'Create account' : mode === 'invite' ? 'Set password' : 'Log in'}</button>
    <button type="button" onClick={() => { setMode(mode === 'reg' ? 'in' : 'reg'); setErr(''); }} style={{ ...field, background: '#fff' }}>{mode === 'reg' ? 'Have an account? Log in' : 'New seller? Create an account'}</button>
    <button type="button" onClick={() => { setMode(mode === 'invite' ? 'in' : 'invite'); setErr(''); }} style={{ ...field, background: '#fff' }}>{mode === 'invite' ? 'Back to log in' : 'Have an invite code?'}</button>
    <small style={{ color: '#6b5a4a' }}>
      Sellers register with an email or a phone number and a password, then only see their own items. An existing seller is not claimed by registering again — an admin sets the password or gives you an invite code. Approving a listing marks it exported here — nothing is sent to the live site yet. Staff sign in with the username admin and the admin password. In production the site stays closed until that password is set (ADMIN_PASSWORD, or APP_PASSWORD if that is the one configured).
    </small>
    {err && <small style={{ color: '#a3261b' }}>{err}</small>}
  </form>;
}

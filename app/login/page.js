'use client';
import { useState } from 'react';

export default function Login() {
  const [err, setErr] = useState('');
  const submit = async e => {
    e.preventDefault();
    const r = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: e.target.pw.value }) });
    r.ok ? location.assign('/') : setErr((await r.json()).error);
  };
  return <form onSubmit={submit} style={{ maxWidth: 320, margin: '20vh auto', display: 'flex', flexDirection: 'column', gap: 8, font: '16px system-ui', padding: 16 }}>
    <strong>WBW Lister</strong>
    <input name="pw" type="password" placeholder="Password" autoFocus style={{ font: 'inherit', padding: 8 }} />
    <button style={{ font: 'inherit', padding: 8 }}>Log in</button>
    {err && <small style={{ color: '#a3261b' }}>{err}</small>}
  </form>;
}

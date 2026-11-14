'use client';
import { useEffect, useState } from 'react';
import { HONEYPOT, MAX_PHOTO_BYTES } from '../lib/public-intake';

const CHANNELS = [
  ['depop', 'Depop shop'],
  ['facebook', 'Facebook Marketplace profile'],
  ['ebay', 'eBay store'],
  ['poshmark', 'Poshmark closet'],
  ['website', 'Your website'],
];

async function resizePhoto(file) {
  if (file.size > MAX_PHOTO_BYTES) throw new Error('Please use a photo of 5 MB or less.');
  if (!/^image\/(jpeg|png|webp)$/i.test(file.type)) throw new Error('Please use a JPG, PNG, or WebP photo.');
  const bitmap = await createImageBitmap(file);
  const max = 800;
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error('That photo could not be resized.')), 'image/jpeg', 0.82));
  const buf = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < buf.length; i += chunk) binary += String.fromCharCode(...buf.subarray(i, i + chunk));
  return btoa(binary);
}

const empty = {
  display_name: '', email: '', phone: '', location: '',
  depop: '', facebook: '', ebay: '', poshmark: '', website: '',
  terms: '', defaults: '', brand_context: 'on',
  photo_ok: false, import_ok: false, password: '', password_confirm: '',
  [HONEYPOT]: '',
};

export default function PublicIntakeForm() {
  const [form, setForm] = useState(empty);
  const [code, setCode] = useState('');
  const [photo, setPhoto] = useState('');
  const [preview, setPreview] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [done, setDone] = useState(false);
  useEffect(() => { setCode(new URLSearchParams(location.search).get('code') || ''); }, []);
  const set = f => e => setForm({ ...form, [f]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const onPhoto = async e => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setErr('');
    try {
      const data = await resizePhoto(file);
      setPhoto(data);
      setPreview(`data:image/jpeg;base64,${data}`);
    } catch (ex) { setErr(ex.message); setPhoto(''); setPreview(''); }
  };
  const submit = async e => {
    e.preventDefault();
    setErr(''); setBusy(true);
    try {
      const r = await fetch('/api/public-intake', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, code, photo }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'Could not send the form.');
      setDone(true);
    } catch (ex) { setErr(ex.message); }
    finally { setBusy(false); }
  };

  if (done) return (
    <div className="panel thanks">
      <strong>Thanks — we have your form.</strong>
      <p>Dan will use this to set up your Western Boot World account. Nothing goes live until you review your listings.</p>
    </div>
  );

  return (
    <form className="panel" onSubmit={submit}>
      <p className="lead">Your WBW profile will have the longer bio, shipping, and contact details. This is only what we need to get you started.</p>

      <fieldset>
        <legend>Required</legend>
        <label>Name to show on WBW<input required value={form.display_name} onChange={set('display_name')} autoComplete="name" /></label>
        <label>Email<input required type="email" data-private="" value={form.email} onChange={set('email')} autoComplete="email" /></label>
        <p className="hint">Shop links — add at least one place you sell now.</p>
        {CHANNELS.map(([k, l]) => <label key={k}>{l}<input inputMode="url" autoComplete="off" placeholder="https://" value={form[k]} onChange={set(k)} /></label>)}
        <label>Temporary password for WBW registration<input required data-private="" type="password" minLength={8} autoComplete="new-password" value={form.password} onChange={set('password')} /></label>
        <small>At least 8 characters. Dan uses this only to register you on Western Boot World, then it is cleared.</small>
        <label>Confirm temporary password<input required data-private="" type="password" minLength={8} autoComplete="new-password" value={form.password_confirm} onChange={set('password_confirm')} /></label>
        <label className="check"><input type="checkbox" checked={form.photo_ok} onChange={set('photo_ok')} required /> I own these photos and I’m okay with BootLister renaming and optimizing them.</label>
        <label className="check"><input type="checkbox" checked={form.import_ok} onChange={set('import_ok')} required /> I’m okay with copying my current listings into BootLister so I can review them here. Nothing goes live until I approve it.</label>
      </fieldset>

      <fieldset>
        <legend>Optional</legend>
        <label>Phone<input data-private="" type="tel" value={form.phone} onChange={set('phone')} autoComplete="tel" /></label>
        <label>Location (city, state)<input value={form.location} onChange={set('location')} autoComplete="address-level2" /></label>
        <label>Shorthand you use, one per line<textarea rows="3" placeholder={"BJ = Black Jack\nSz = Size"} value={form.terms} onChange={set('terms')} /></label>
        <label>Defaults when a listing doesn’t say, one per line<textarea rows="3" placeholder={"sized_for = Women\nmade_in = USA"} value={form.defaults} onChange={set('defaults')} /></label>
        <label>Add a short brand note from Western Boot World to your listings?
          <select value={form.brand_context} onChange={set('brand_context')}>
            <option value="on">On (recommended)</option>
            <option value="off">Off</option>
          </select>
        </label>
        <label>Profile picture (JPG, PNG, or WebP, 5 MB or less)
          <input type="file" accept="image/jpeg,image/png,image/webp" onChange={onPhoto} />
        </label>
        {preview && <img src={preview} alt="Profile preview" className="preview" />}
      </fieldset>

      <div className="hp" aria-hidden="true">
        <label>Company<input tabIndex={-1} autoComplete="off" value={form[HONEYPOT]} onChange={set(HONEYPOT)} /></label>
      </div>

      {err && <p className="err">{err}</p>}
      <button type="submit" className="primary" disabled={busy}>{busy ? 'Sending…' : 'Send intake form'}</button>
    </form>
  );
}

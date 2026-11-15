'use client';
import { useEffect, useState } from 'react';
import { EMAIL_PREFS, EMAIL_PREFS_INTRO, HONEYPOT, IMPORT_MODES, INTAKE_LIMITS as L, MAX_PHOTO_BYTES, USERNAME_RE } from '../lib/public-intake-constants';

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
  display_name: '', username: '', email: '', phone: '', location: '', aliases: '',
  bio: '', fun_fact: '', sells_where: '', boot_types: '', pairs_estimate: '', notes: '',
  terms: '', defaults: '', brand_context: 'on',
  email_prefs: Object.fromEntries(EMAIL_PREFS.map(([k]) => [k, true])),
  import_mode: '', password: '',
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
  const setPref = k => e => setForm({ ...form, email_prefs: { ...form.email_prefs, [k]: e.target.checked } });
  const field = (k, props = {}) => ({ value: form[k], onChange: set(k), maxLength: L[k], ...props });
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
    setErr('');
    if (!USERNAME_RE.test(form.username.trim())) return setErr('Username must be 3 to 20 letters, numbers, or underscores.');
    if (!form.import_mode) return setErr('Please choose how we should import your listings (live or as drafts).');
    setBusy(true);
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
      <p>Dan will use this to set up your Western Boot World account.</p>
    </div>
  );

  return (
    <form className="panel" onSubmit={submit}>
      <p className="lead">Two parts: the <b>Required</b> questions first, then <b>Optional</b> ones you can skip or fill in later.</p>

      <fieldset>
        <legend>Required</legend>
        <label>Display name<input required {...field('display_name', { autoComplete: 'name' })} /><small>The name to show on WBW.</small></label>
        <label>Username<input required {...field('username', { autoComplete: 'username', pattern: '[A-Za-z0-9_]{3,20}', autoCapitalize: 'none', spellCheck: false })} /><small>3 to 20 letters, numbers, or underscores. Your unique handle.</small></label>
        <label>Best email to reach you<input required type="email" data-private="" {...field('email', { autoComplete: 'email' })} /></label>
        <label>Temporary password for WBW registration<input required data-private="" type="password" minLength={8} maxLength={200} autoComplete="new-password" value={form.password} onChange={set('password')} />
          <small>At least 8 characters. Dan uses this only to register you on Western Boot World, then it is cleared.</small></label>
        <fieldset className="choice" role="radiogroup">
          <legend>How should we import your listings to Western Boot World?</legend>
          {IMPORT_MODES.map(([k, l]) => <label key={k} className="check"><input type="radio" name="import_mode" value={k} checked={form.import_mode === k} onChange={set('import_mode')} required /> {l}</label>)}
        </fieldset>
      </fieldset>

      <fieldset>
        <legend>Optional</legend>
        <label>Profile photo (JPG, PNG, or WebP, 5 MB or less)
          <input type="file" accept="image/jpeg,image/png,image/webp" onChange={onPhoto} />
        </label>
        {preview && <img src={preview} alt="Profile preview" className="preview" />}
        <label>Aliases<input {...field('aliases')} /><small>Optional. Comma-separated other names you go by</small></label>
        <label>Location<input {...field('location', { autoComplete: 'address-level2', placeholder: 'City, state' })} /></label>
        <label>Bio<textarea rows="4" placeholder="Tell buyers what you collect, your shipping turnaround, anything that builds trust." {...field('bio')} /></label>
        <label>Fun fact about you<input placeholder="Your first pair, a grail boot, how long you've been collecting..." {...field('fun_fact')} /></label>
        <label>Where do you sell boots today?<input {...field('sells_where')} /></label>
        <label>What kind of boots do you deal in?<input {...field('boot_types')} /></label>
        <label>Roughly how many pairs would you list?<input inputMode="numeric" {...field('pairs_estimate')} /></label>
        <label>Anything else we should know?<textarea rows="3" {...field('notes')} /></label>
        <label>Phone<input data-private="" type="tel" {...field('phone', { autoComplete: 'tel' })} /></label>
        <label>Shorthand you use, one per line<textarea rows="3" placeholder={"BJ = Black Jack\nSz = Size"} {...field('terms')} /></label>
        <label>Defaults when a listing doesn’t say, one per line<textarea rows="3" placeholder={"sized_for = Women\nmade_in = USA"} {...field('defaults')} /></label>
        <label>Add a short brand note from Western Boot World to your listings?
          <select value={form.brand_context} onChange={set('brand_context')}>
            <option value="on">On (recommended)</option>
            <option value="off">Off</option>
          </select>
        </label>
        <p className="hint"><b>Email preferences</b> — {EMAIL_PREFS_INTRO}</p>
        {EMAIL_PREFS.map(([k, l, h]) => (
          <label key={k} className="check"><input type="checkbox" checked={form.email_prefs[k]} onChange={setPref(k)} />
            <span>{l}<small>{h}</small></span></label>
        ))}
      </fieldset>

      <div className="hp" aria-hidden="true">
        <label>Company<input tabIndex={-1} autoComplete="off" value={form[HONEYPOT]} onChange={set(HONEYPOT)} /></label>
      </div>

      {err && <p className="err" role="alert">{err}</p>}
      <button type="submit" className="primary" disabled={busy}>{busy ? 'Sending…' : 'Send intake form'}</button>
    </form>
  );
}

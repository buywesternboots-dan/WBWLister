'use client';
import { useEffect, useRef, useState } from 'react';
import { WBW_ACCOUNT_LABEL, WBW_ACCOUNT_URL } from '../lib/wbw-account';
import { DUPLICATE_MESSAGES, PAYMENT_METHODS, PRICE_FREQUENCIES, EMAIL_PREFS, EMAIL_PREFS_INTRO, HONEYPOT, IMPORT_MODES, INTAKE_LIMITS as L, MAX_PHOTO_BYTES, USERNAME_RE } from '../lib/public-intake-constants';

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
  bio: '', fun_fact: '', sells_where: '', boot_types: '', sells_belts: '', measurement_method: '',
  encyclopedia_help: '', encyclopedia_permission: '', price_change_frequency: '', price_change_frequency_other: '', pairs_estimate: '', notes: '',
  terms: '', defaults: '', brand_context: 'on',
  email_prefs: Object.fromEntries(EMAIL_PREFS.map(([k]) => [k, true])),
  import_mode: '', has_wbw_account: '', password: '',
  pricing_change: '', pricing_notes: '', shipping_policy: '', return_policy: '', payment_methods: { methods: [], other: '' },
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
  const checkId = useRef(0);
  const [status, setStatus] = useState(''); // '' unchecked, 'none' ok to continue, 'seller' or 'intake' already known
  const ready = () => USERNAME_RE.test(form.username.trim()) && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim());
  const check = async (loud = false) => {
    if (!ready()) { if (loud) setErr('Enter your email and a username (3 to 20 letters, numbers, or underscores).'); return; }
    const id = ++checkId.current;
    setErr(''); setBusy(true);
    try {
      const q = new URLSearchParams({ email: form.email.trim(), username: form.username.trim() });
      const r = await fetch(`/api/public-intake/check?${q}`);
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'Could not check that right now.');
      if (id === checkId.current) setStatus(j.status);
    } catch (ex) { if (loud && id === checkId.current) setErr(ex.message); }
    finally { setBusy(false); }
  };
  useEffect(() => { setCode(new URLSearchParams(location.search).get('code') || ''); }, []);
  const set = f => e => { if (f === 'email' || f === 'username') { checkId.current++; setStatus(''); } setForm({ ...form, [f]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }); };
  const pay = form.payment_methods;
  const setPay = k => e => setForm({ ...form, payment_methods: { ...pay, methods: e.target.checked ? [...pay.methods, k] : pay.methods.filter(m => m !== k) } });
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
    if (status !== 'none') return check(true);
    if (!form.has_wbw_account) return setErr('Please tell us whether you already have a Western Boot World account.');
    if (!form.import_mode) return setErr('Please choose how we should import your listings (live or as drafts).');
    setBusy(true);
    try {
      const r = await fetch('/api/public-intake', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, password: form.has_wbw_account === 'yes' ? '' : form.password, code, photo }),
      });
      const j = await r.json().catch(() => ({}));
      const dup = Object.keys(DUPLICATE_MESSAGES).find(k => DUPLICATE_MESSAGES[k] === j.error);
      if (r.status === 409 && dup) return setStatus(dup);
      if (!r.ok) throw new Error(j.error || 'Could not send the form.');
      setDone(true);
    } catch (ex) { setErr(ex.message); }
    finally { setBusy(false); }
  };

  if (done) return (
    <div className="panel thanks">
      <strong>Thanks — we have your form.</strong>
      <p>{form.has_wbw_account === 'yes' ? 'We’ll link your existing Western Boot World account for you.' : 'We’ll set up your Western Boot World account for you.'}</p>
      <p><a href={WBW_ACCOUNT_URL} target="_blank" rel="noopener noreferrer">{WBW_ACCOUNT_LABEL}</a></p>
    </div>
  );

  return (
    <form className="panel" onSubmit={submit}>
      <p className="lead">Two parts: the <b>Required</b> questions first, then <b>Optional</b> ones you can skip or fill in later.</p>

      <fieldset>
        <legend>Required</legend>
        <label>Best email to reach you<input required type="email" data-private="" {...field('email', { autoComplete: 'email', onBlur: () => check() })} /></label>
        <label>Username<input required {...field('username', { autoComplete: 'username', pattern: '[A-Za-z0-9_]{3,20}', autoCapitalize: 'none', spellCheck: false, onBlur: () => check() })} /><small>3 to 20 letters, numbers, or underscores. Your unique handle.</small></label>
        {!status && <button type="button" className="primary" disabled={busy} onClick={() => check(true)}>{busy ? 'Checking…' : 'Continue'}</button>}
        {status === 'seller' && <p className="known" role="status">{DUPLICATE_MESSAGES.seller.replace(/ Sign in here$/, '')} <a href="/login">Sign in here</a>.</p>}
        {status === 'intake' && <p className="known" role="status">{DUPLICATE_MESSAGES.intake}</p>}
        {status === 'none' && <>
        <label>Display name<input required {...field('display_name', { autoComplete: 'name' })} /><small>The name to show on WBW.</small></label>
        <fieldset className="choice" role="radiogroup">
          <legend>Do you already have a Western Boot World account?</legend>
          <label className="check"><input type="radio" name="has_wbw_account" value="yes" checked={form.has_wbw_account === 'yes'} onChange={set('has_wbw_account')} required /> Yes</label>
          <label className="check"><input type="radio" name="has_wbw_account" value="no" checked={form.has_wbw_account === 'no'} onChange={set('has_wbw_account')} required /> No</label>
        </fieldset>
        {form.has_wbw_account === 'yes' && <p className="hint">No password needed. We'll link your existing WBW account for you.</p>}
        {form.has_wbw_account === 'no' && <label>Temporary password for WBW registration<input required data-private="" type="password" minLength={8} maxLength={200} autoComplete="new-password" value={form.password} onChange={set('password')} />
          <small>At least 8 characters. We set up your Western Boot World account for you with this password, then it is cleared.</small></label>}
        <fieldset className="choice" role="radiogroup">
          <legend>How should we import your listings to Western Boot World?</legend>
          {IMPORT_MODES.map(([k, l]) => <label key={k} className="check"><input type="radio" name="import_mode" value={k} checked={form.import_mode === k} onChange={set('import_mode')} required /> {l}</label>)}
        </fieldset>
        </>}
      </fieldset>

      {status === 'none' && <>
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
        <fieldset className="choice" role="radiogroup">
          <legend>Do you also sell belts?</legend>
          <label className="check"><input type="radio" name="sells_belts" value="yes" checked={form.sells_belts === 'yes'} onChange={set('sells_belts')} /> Yes</label>
          <label className="check"><input type="radio" name="sells_belts" value="no" checked={form.sells_belts === 'no'} onChange={set('sells_belts')} /> No</label>
        </fieldset>
        <label>How do you measure your boots?<input {...field('measurement_method')} /></label>
        <label>Roughly how many boots (and belts, if you sell them) do you have to list?<input placeholder="e.g. 40 boots, 10 belts" {...field('pairs_estimate')} /></label>
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
        <h3>Store policies</h3>
        <fieldset className="choice" role="radiogroup">
          <legend>Do you want to change the pricing of your items?</legend>
          <label className="check"><input type="radio" name="pricing_change" value="no" checked={form.pricing_change === 'no'} onChange={set('pricing_change')} /> No, keep my prices</label>
          <label className="check"><input type="radio" name="pricing_change" value="yes" checked={form.pricing_change === 'yes'} onChange={set('pricing_change')} /> Yes</label>
        </fieldset>
        {form.pricing_change === 'yes' && <label>How should we change your prices?<textarea rows="3" {...field('pricing_notes')} /></label>}
        <fieldset className="choice" role="radiogroup">
          <legend>How often do you change your prices?</legend>
          {PRICE_FREQUENCIES.map(([k, l]) => <label key={k} className="check"><input type="radio" name="price_change_frequency" value={k} checked={form.price_change_frequency === k} onChange={set('price_change_frequency')} /> {l}</label>)}
        </fieldset>
        {form.price_change_frequency === 'other' && <label>How often?<input {...field('price_change_frequency_other')} /></label>}
        <label>What are your shipping policies?<textarea rows="3" {...field('shipping_policy')} /></label>
        <fieldset className="choice">
          <legend>What payment methods do you accept?</legend>
          {PAYMENT_METHODS.map(([k, l]) => <label key={k} className="check"><input type="checkbox" checked={pay.methods.includes(k)} onChange={setPay(k)} /> {l}</label>)}
        </fieldset>
        {pay.methods.includes('other') && <label>Other payment method<input maxLength={L.payment_other} value={pay.other} onChange={e => setForm({ ...form, payment_methods: { ...pay, other: e.target.value } })} /></label>}
        <label>What is your return policy?<textarea rows="3" {...field('return_policy')} /></label>
        <h3>Boot encyclopedia</h3>
        <fieldset className="choice" role="radiogroup">
          <legend>Would you like to help build the Western Boot World boot encyclopedia?</legend>
          <label className="check"><input type="radio" name="encyclopedia_help" value="yes" checked={form.encyclopedia_help === 'yes'} onChange={set('encyclopedia_help')} /> Yes</label>
          <label className="check"><input type="radio" name="encyclopedia_help" value="no" checked={form.encyclopedia_help === 'no'} onChange={set('encyclopedia_help')} /> No</label>
        </fieldset>
        <fieldset className="choice" role="radiogroup">
          <legend>May we use your photos and listing details in the boot encyclopedia?</legend>
          <label className="check"><input type="radio" name="encyclopedia_permission" value="yes" checked={form.encyclopedia_permission === 'yes'} onChange={set('encyclopedia_permission')} /> Yes</label>
          <label className="check"><input type="radio" name="encyclopedia_permission" value="no" checked={form.encyclopedia_permission === 'no'} onChange={set('encyclopedia_permission')} /> No</label>
        </fieldset>
        <p className="hint"><b>Email preferences</b> — {EMAIL_PREFS_INTRO}</p>
        {EMAIL_PREFS.map(([k, l, h]) => (
          <label key={k} className="check"><input type="checkbox" checked={form.email_prefs[k]} onChange={setPref(k)} />
            <span>{l}<small>{h}</small></span></label>
        ))}
      </fieldset>

      </>}

      <div className="hp" aria-hidden="true">
        <label>Company<input tabIndex={-1} autoComplete="off" value={form[HONEYPOT]} onChange={set(HONEYPOT)} /></label>
      </div>

      {err && <p className="err" role="alert">{err}</p>}
      {status === 'none' && <button type="submit" className="primary" disabled={busy}>{busy ? 'Sending…' : 'Send intake form'}</button>}
    </form>
  );
}

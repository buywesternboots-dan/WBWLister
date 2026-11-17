'use client';
import { useState } from 'react';
import WbwSetupPanel from './wbw-setup-panel';
import { WBW_PASSWORD_RULE } from '../lib/wbw-account';
import { PAYMENT_METHODS, PRICE_FREQUENCIES, EMAIL_PREFS, EMAIL_PREFS_INTRO, HONEYPOT, IMPORT_MODES, INTAKE_LIMITS as L, MAX_PHOTO_BYTES, USERNAME_RE } from '../lib/public-intake-constants';

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

function YesNo({ name, legend, form, set, required = false, labels = ['Yes', 'No'] }) {
  return (
    <fieldset className="choice" role="radiogroup">
      <legend>{legend}</legend>
      <label className="check"><input type="radio" name={name} value="yes" checked={form[name] === 'yes'} onChange={set(name)} required={required} /> {labels[0]}</label>
      <label className="check"><input type="radio" name={name} value="no" checked={form[name] === 'no'} onChange={set(name)} required={required} /> {labels[1]}</label>
    </fieldset>
  );
}

// Open intake form (no sign-in). Worded as prompts Dan reads to the seller on a call.
// The result panel is built only from this browser's own answers; the server returns nothing else.
export default function PublicIntakeForm() {
  const [form, setForm] = useState(empty);
  const [photo, setPhoto] = useState('');
  const [preview, setPreview] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [done, setDone] = useState(null);
  const [showPw, setShowPw] = useState(false);
  const set = f => e => setForm({ ...form, [f]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
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
    if (!form.has_wbw_account) return setErr('Answer: does the seller already have a WBW account?');
    if (form.has_wbw_account === 'no' && !/\d/.test(form.password)) return setErr(`Temporary password: ${WBW_PASSWORD_RULE}`);
    if (!form.import_mode) return setErr('Answer: import listings live or as drafts?');
    setBusy(true);
    try {
      const r = await fetch('/api/public-intake', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, password: form.has_wbw_account === 'yes' ? '' : form.password, photo }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'Could not save the sheet.');
      setDone({ seller_name: j.seller_name || '' });
      window.scrollTo?.(0, 0);
    } catch (ex) { setErr(ex.message); }
    finally { setBusy(false); }
  };

  if (done) {
    const freq = form.price_change_frequency === 'other' && form.price_change_frequency_other ? `other: ${form.price_change_frequency_other}` : form.price_change_frequency;
    const row = { ...form, price_change_frequency: freq, photo_url: preview || null };
    const pw = form.has_wbw_account === 'no' ? form.password : null;
    return (
      <div className="panel">
        <p className="known" role="status">Saved. BootLister seller {done.seller_name ? <b>{done.seller_name}</b> : ''} is set up.</p>
        <WbwSetupPanel row={row} password={pw} />
        <p><a href="/intake">Start a new form</a></p>
      </div>
    );
  }

  return (
    <form className="panel" onSubmit={submit}>
      <p className="lead">Read each prompt to the seller and type the answer. Do <b>Required</b> first; <b>Optional</b> can be skipped.</p>

      <fieldset>
        <legend>Required</legend>
        <label>Seller’s display name<input required {...field('display_name', { autoComplete: 'off' })} /><small>The name buyers see on WBW.</small></label>
        <label>Ask: what username do you want?<input required {...field('username', { autoComplete: 'off', pattern: '[A-Za-z0-9_]{3,20}', autoCapitalize: 'none', spellCheck: false })} /><small>3 to 20 letters, numbers, or underscores.</small></label>
        <label>Seller’s email<input required type="email" data-private="" {...field('email', { autoComplete: 'off', autoCapitalize: 'none' })} /></label>
        <YesNo name="has_wbw_account" legend="Ask: do you already have a Western Boot World account?" form={form} set={set} required />
        {form.has_wbw_account === 'yes' && <p className="hint">No password needed. Link their existing WBW account.</p>}
        {form.has_wbw_account === 'no' && <label>Temporary WBW password (you pick it, tell the seller)<span className="pw">
          <input required data-private="" type={showPw ? 'text' : 'password'} minLength={8} maxLength={200} autoComplete="new-password" value={form.password} onChange={set('password')} />
          <button type="button" className="eye" aria-label={showPw ? 'Hide password' : 'Show password'} aria-pressed={showPw} onClick={() => setShowPw(v => !v)}>
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z" /><circle cx="12" cy="12" r="3" />{showPw && <path d="M3 3l18 18" />}</svg>
          </button>
        </span>
          <small>{WBW_PASSWORD_RULE} Saved encrypted; you copy it into WBW after saving.</small></label>}
        <fieldset className="choice" role="radiogroup">
          <legend>Ask: should we import your listings live, or as drafts you review first?</legend>
          {IMPORT_MODES.map(([k, l]) => <label key={k} className="check"><input type="radio" name="import_mode" value={k} checked={form.import_mode === k} onChange={set('import_mode')} required /> {l}</label>)}
        </fieldset>
      </fieldset>

      <fieldset>
        <legend>Optional</legend>
        <h3>Profile</h3>
        <label>Profile photo (seller texts or emails it to you; JPG, PNG, or WebP, 5 MB or less)
          <input type="file" accept="image/jpeg,image/png,image/webp" onChange={onPhoto} />
        </label>
        {preview && <img src={preview} alt="Profile preview" className="preview" />}
        <label>Ask: any other names you go by?<input {...field('aliases')} /><small>Aliases, comma-separated.</small></label>
        <label>Ask: where are you located?<input {...field('location', { placeholder: 'City, state' })} /></label>
        <label>Ask: how would you describe yourself to buyers?<textarea rows="3" {...field('bio')} /><small>Bio. WBW allows 280 characters.</small></label>
        <label>Ask: what’s a fun fact about you?<input {...field('fun_fact')} /></label>
        <label>Seller’s phone<input data-private="" type="tel" {...field('phone', { autoComplete: 'off' })} /></label>

        <h3>Their business</h3>
        <label>Ask: where do you sell boots today?<input {...field('sells_where')} /></label>
        <label>Ask: what kind of boots do you deal in?<input {...field('boot_types')} /></label>
        <YesNo name="sells_belts" legend="Ask: do you also sell belts?" form={form} set={set} />
        <label>Ask: how do you measure your boots?<input {...field('measurement_method')} /></label>
        <label>Ask: roughly how many boots (and belts) do you have to list?<input placeholder="e.g. 40 boots, 10 belts" {...field('pairs_estimate')} /></label>

        <h3>Store policies</h3>
        <YesNo name="pricing_change" legend="Ask: do you want your prices changed when we import?" form={form} set={set} labels={['Yes', 'No, keep my prices']} />
        {form.pricing_change === 'yes' && <label>Ask: how should we change them?<textarea rows="2" {...field('pricing_notes')} /></label>}
        <fieldset className="choice" role="radiogroup">
          <legend>Ask: how often do you change prices?</legend>
          {PRICE_FREQUENCIES.map(([k, l]) => <label key={k} className="check"><input type="radio" name="price_change_frequency" value={k} checked={form.price_change_frequency === k} onChange={set('price_change_frequency')} /> {l}</label>)}
        </fieldset>
        {form.price_change_frequency === 'other' && <label>How often?<input {...field('price_change_frequency_other')} /></label>}
        <label>Ask: what’s your shipping policy?<textarea rows="2" {...field('shipping_policy')} /></label>
        <fieldset className="choice">
          <legend>Ask: what payment methods do you take?</legend>
          {PAYMENT_METHODS.map(([k, l]) => <label key={k} className="check"><input type="checkbox" checked={pay.methods.includes(k)} onChange={setPay(k)} /> {l}</label>)}
        </fieldset>
        {pay.methods.includes('other') && <label>Other payment method<input maxLength={L.payment_other} value={pay.other} onChange={e => setForm({ ...form, payment_methods: { ...pay, other: e.target.value } })} /></label>}
        <label>Ask: what’s your return policy?<textarea rows="2" {...field('return_policy')} /></label>
        <p className="hint">WBW puts shipping, returns, and payment in one 400-character box.</p>

        <h3>Boot encyclopedia</h3>
        <YesNo name="encyclopedia_help" legend="Ask: would you like to help build the WBW boot encyclopedia?" form={form} set={set} />
        <YesNo name="encyclopedia_permission" legend="Ask: may we use your photos and listing details in the encyclopedia?" form={form} set={set} />

        <h3>Email preferences</h3>
        <p className="hint">Ask which of these they want by email. {EMAIL_PREFS_INTRO}</p>
        {EMAIL_PREFS.map(([k, l, h]) => (
          <label key={k} className="check"><input type="checkbox" checked={form.email_prefs[k]} onChange={setPref(k)} />
            <span>{l}<small>{h}</small></span></label>
        ))}

        <h3>Listing import</h3>
        <label>Ask: any shorthand you use in listings? One per line.<textarea rows="3" placeholder={"BJ = Black Jack\nSz = Size"} {...field('terms')} /></label>
        <label>Ask: anything we should assume when a listing doesn’t say? One per line.<textarea rows="3" placeholder={"sized_for = Women\nmade_in = USA"} {...field('defaults')} /></label>
        <label>Add a short WBW brand note to their listings?
          <select value={form.brand_context} onChange={set('brand_context')}>
            <option value="on">On (recommended)</option>
            <option value="off">Off</option>
          </select>
        </label>
        <label>Ask: anything else we should know?<textarea rows="3" {...field('notes')} /></label>
      </fieldset>

      <div className="hp" aria-hidden="true">
        <label>Company<input tabIndex={-1} autoComplete="off" value={form[HONEYPOT]} onChange={set(HONEYPOT)} /></label>
      </div>

      {err && <p className="err" role="alert">{err}</p>}
      <button type="submit" className="primary" disabled={busy}>{busy ? 'Saving…' : 'Save and create seller'}</button>
    </form>
  );
}

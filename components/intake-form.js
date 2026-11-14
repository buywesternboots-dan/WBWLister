'use client';
import { useEffect, useState } from 'react';
import { isOn, intakeStatus } from '../lib/intake';
import { parseShopLinks, SHOP_CHANNELS } from '../lib/seller-links';

const CHANNELS = [
  ['depop', 'Depop shop'],
  ['facebook', 'Facebook Marketplace profile'],
  ['ebay', 'eBay store'],
  ['poshmark', 'Poshmark closet'],
  ['website', 'Your website'],
];

const fromSeller = s => {
  const channels = parseShopLinks(s);
  return {
    ...Object.fromEntries(SHOP_CHANNELS.map(k => [k, channels[k] ?? ''])),
    terms: s?.terms ?? '',
    defaults: s?.defaults ?? '',
    brand_context: s?.brand_context === 'off' ? 'off' : 'on',
    photo_ok: isOn(s?.photo_ok),
    import_ok: isOn(s?.import_ok),
  };
};

// Short seller-facing intake. The bug report button stays in the site layout.
export default function IntakeForm({ seller, admin, busy, error, onSave, onClose }) {
  const [form, setForm] = useState(() => fromSeller(seller));
  useEffect(() => { setForm(fromSeller(seller)); }, [seller?.name, seller?.shop_links, seller?.website, seller?.fb_profile]);
  const set = f => e => setForm({ ...form, [f]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const incomplete = !intakeStatus({ ...seller, ...form, photo_ok: form.photo_ok ? 'on' : 'off', import_ok: form.import_ok ? 'on' : 'off' }).done;
  const save = () => onSave({
    ...Object.fromEntries(SHOP_CHANNELS.map(k => [k, form[k]])),
    terms: form.terms, defaults: form.defaults, brand_context: form.brand_context,
    photo_ok: form.photo_ok ? 'on' : 'off', import_ok: form.import_ok ? 'on' : 'off',
  });

  return (
    <div className="panel intake">
      <strong>{admin ? `Seller intake — ${seller.display_name || seller.name}` : 'A few things we need from you'}</strong>
      <p className="help" style={{ margin: 0 }}>Your WBW profile already has your name, location, contact, and shipping. This is only what BootLister needs to import and write your listings.</p>

      <h3>1. Shop links</h3>
      <small>Paste every place you sell now. Leave a line blank if you don’t use that one.</small>
      {CHANNELS.map(([k, l]) => <label key={k}>{l}<input inputMode="url" autoComplete="off" placeholder="https://" value={form[k]} onChange={set(k)} /></label>)}

      <h3>2. Listing habits</h3>
      <label>Shorthand you use, one per line (optional)<textarea rows="3" placeholder={"BJ = Black Jack\nSz = Size"} value={form.terms} onChange={set('terms')} /></label>
      <small>BootLister uses this only to read a listing. The wording you wrote stays as you wrote it.</small>
      <label>Defaults when a listing doesn’t say, one per line (optional)<textarea rows="3" placeholder={"sized_for = Women\nmade_in = USA"} value={form.defaults} onChange={set('defaults')} /></label>

      <h3>3. Brand context</h3>
      <label>Add a short brand note from Western Boot World to your listings?
        <select value={form.brand_context} onChange={set('brand_context')}>
          <option value="on">On (recommended)</option>
          <option value="off">Off</option>
        </select>
      </label>

      <h3>4. Photos</h3>
      <label className="check"><input type="checkbox" checked={form.photo_ok} onChange={set('photo_ok')} /> I own these photos and I’m okay with BootLister renaming and optimizing them.</label>

      <h3>5. Import</h3>
      <label className="check"><input type="checkbox" checked={form.import_ok} onChange={set('import_ok')} /> I’m okay with copying my current listings into BootLister so I can review them here. Nothing goes live until I approve it.</label>

      {error && <p className="err">{error}</p>}
      <span>
        <button type="button" className="primary" disabled={busy} onClick={save}>Save intake</button>
        {onClose && (admin || !incomplete) && <button type="button" disabled={busy} onClick={onClose}>Close</button>}
      </span>
    </div>
  );
}

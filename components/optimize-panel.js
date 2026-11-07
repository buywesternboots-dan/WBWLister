'use client';
import { useState } from 'react';

const obj = v => {
  if (!v) return null;
  if (typeof v === 'string') { try { return JSON.parse(v); } catch { return null; } }
  return v;
};

// Original against the draft. Apply is the only write of title and description.
export default function OptimizePanel({ item, proposal, title, description, busy, onTitle, onDescription, onPrepare, onSave, onApply, onAdd }) {
  const p = obj(proposal) ?? {};
  const original = obj(item.opt_original) ?? { title: item.title ?? '', description: item.description ?? '' };
  const [ref, setRef] = useState({ maker: item.brand ?? '', model: '', status: 'candidate', provenance: '', notes: '' });
  const set = k => e => setRef({ ...ref, [k]: e.target.value });
  return <div className="opt" data-optimize-panel>
    <strong>Optimize listing</strong>
    <small>{p.reference_note}</small>
    <small>{p.width_note}</small>
    <div className="compare">
      <label>Original title
        <textarea readOnly rows="3" data-original-title value={original.title ?? ''} /></label>
      <label>Proposed title
        <textarea rows="3" data-proposed-title value={title ?? ''} onChange={e => onTitle(e.target.value)} /></label>
      <label>Original description
        <textarea readOnly rows="8" data-original-description value={original.description ?? ''} /></label>
      <label>Proposed description
        <textarea rows="8" data-proposed-description value={description ?? ''} onChange={e => onDescription(e.target.value)} /></label>
    </div>
    {p.omitted?.length > 0 && <small>Left out: {p.omitted.map(o => `${o.field} (${o.reason})`).join(' ')}</small>}
    {p.matches?.length > 0 && <ul>{p.matches.map((m, i) => <li key={i}>{m.use ? 'Used' : 'Not used'} — {m.status}: {m.maker} {m.model} — {m.reason}</li>)}</ul>}
    <div>
      <small>Photo copy names for the CSV. Stored files and the seller’s source images are not renamed. Pixels are not changed.</small>
      <ul>{(p.images ?? []).map(im => <li key={im.n}>{im.file} — {im.alt}<br />stored: {im.stored_url}</li>)}</ul>
    </div>
    <label>SEO description (not exported — the sell-a-pair file has no meta description column)
      <textarea readOnly rows="3" value={p.portable?.seo_description ?? ''} /></label>
    <small>{p.portable?.note}</small>
    <span>
      <button type="button" data-prepare-optimize disabled={busy} onClick={onPrepare}>Prepare again</button>
      <button type="button" disabled={busy} onClick={onSave}>Save draft</button>
      <button type="button" className="primary" data-apply-optimize disabled={busy} onClick={onApply}>Apply to listing</button>
    </span>
    <form onSubmit={e => { e.preventDefault(); onAdd(ref); }} className="panel">
      <h3>Maker / model note</h3>
      <small>The maker library and boot lookup are not connected. A confirmed note is used only when this listing already names that model.</small>
      <label>Maker <input value={ref.maker} onChange={set('maker')} required /></label>
      <label>Model <input value={ref.model} onChange={set('model')} /></label>
      <label>Status <select value={ref.status} onChange={set('status')}><option value="candidate">Candidate</option><option value="confirmed">Confirmed</option></select></label>
      <label>Where you checked this <input value={ref.provenance} onChange={set('provenance')} required /></label>
      <label>Notes <input value={ref.notes} onChange={set('notes')} /></label>
      <button type="submit" disabled={busy}>Add note</button>
    </form>
  </div>;
}

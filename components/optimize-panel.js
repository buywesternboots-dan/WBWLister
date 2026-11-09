'use client';
import { useEffect, useState } from 'react';

const obj = v => {
  if (!v) return null;
  if (typeof v === 'string') { try { return JSON.parse(v); } catch { return null; } }
  return v;
};

// Original against the draft. Apply is the only write of title and description.
export default function OptimizePanel({ item, proposal, title, description, busy, onPrepare, onSave, onApply, onAdd, onKeepStyle, onMakerNote }) {
  const p = obj(proposal) ?? {};
  const original = obj(item.opt_original) ?? { title: item.title ?? '', description: item.description ?? '' };
  const first = obj(original.first);
  const [draftTitle, setDraftTitle] = useState(title ?? p.title ?? '');
  const [draftDescription, setDraftDescription] = useState(description ?? p.description ?? '');
  const seed = `${p.title ?? ''}\n${p.description ?? ''}`;
  useEffect(() => {
    setDraftTitle(title ?? p.title ?? '');
    setDraftDescription(description ?? p.description ?? '');
  }, [seed]);
  const [ref, setRef] = useState({ maker: item.brand ?? '', model: '', status: 'candidate', provenance: '', notes: '' });
  const set = k => e => setRef({ ...ref, [k]: e.target.value });
  return <div className="opt" data-optimize-panel>
    <strong>Optimize listing</strong>
    <small>{p.reference_note}</small>
    {first && (first.description !== original.description || first.title !== original.title) && <small>The first import is kept. The text below is the latest source copy.</small>}
    <small>{p.width_note}</small>
    <div className="compare">
      <label>Original title
        <textarea readOnly rows="3" data-original-title value={original.title ?? ''} /></label>
      <label>Proposed title
        <textarea rows="3" data-proposed-title value={draftTitle} onChange={e => setDraftTitle(e.target.value)} /></label>
      <label>Original description
        <textarea readOnly rows="8" data-original-description value={original.description ?? ''} /></label>
      <label>Proposed description
        <textarea rows="8" data-proposed-description value={draftDescription} onChange={e => setDraftDescription(e.target.value)} /></label>
    </div>
    {p.directory?.suggestion && <small data-maker-directory>Directory lists the name {p.directory.suggestion.name}. That is not where this pair was made. Model lookup is not in this snapshot.</small>}
    {p.maker_note && item.description === `${original.description ?? ''}${original.description ? '\n\n' : ''}${p.maker_note}` && <div data-maker-note>
      <small>A maker note was added after the imported description. The imported text is unchanged above it.</small>
      <button type="button" disabled={busy} onClick={() => onMakerNote?.('remove')}>Remove maker note</button>
      <button type="button" disabled={busy} onClick={() => onMakerNote?.('regenerate')}>Regenerate maker note</button>
    </div>}
    {p.style_sample && <div data-style-sample>
      <small>{p.style_sample.note}</small>
      <small>{p.style_sample.partial_sample ? `Style sample: ${p.style_sample.sample_records} of ${p.style_sample.displayed_records} displayed cards.` : `Catalog: ${p.style_sample.sample_records} cards${p.style_sample.snapshot_date ? ` from ${p.style_sample.snapshot_date}` : ''}.`}</small>
      {(p.style_sample.matches ?? []).map(m => <div key={m.record_url}>
        <div>Candidate for review. {m.maker_name} style {m.style_number} is in the snapshot. The heading “{m.record_title}” is not a verified model name.</div>
        {m.other_card_text && <div>Catalog card text, not verified for this pair: {m.other_card_text}</div>}
        <a href={m.record_url} target="_blank" rel="noreferrer">Catalog record</a>
        <button type="button" data-keep-style disabled={busy} onClick={() => onKeepStyle(m.record_url)}>Keep this reference</button>
      </div>)}
      {item.style_ref?.record_url && <small>Kept reference: {item.style_ref.maker_name} {item.style_ref.style_number}. Listing text was not changed.</small>}
    </div>}
    {p.omitted?.length > 0 && <small>Left out: {p.omitted.map(o => `${o.field} (${o.reason})`).join(' ')}</small>}
    {p.matches?.length > 0 && <ul>{p.matches.map((m, i) => <li key={i}>{m.use ? 'Used' : 'Not used'} — {m.status}: {m.maker} {m.model} — {m.reason}{m.provenance ? ` Source note (not published): ${m.provenance}` : ''}</li>)}</ul>}
    <div>
      <small>Photo copy names for the CSV. Stored files and the seller’s source images are not renamed. Pixels are not changed.</small>
      <ul>{(p.images ?? []).map(im => <li key={im.n}>{im.file} — {im.alt}<br />stored: {im.stored_url}</li>)}</ul>
    </div>
    <label>SEO description (not exported — the sell-a-pair file has no meta description column)
      <textarea readOnly rows="3" value={p.portable?.seo_description ?? ''} /></label>
    <small>{p.portable?.note}</small>
    <span>
      <button type="button" data-prepare-optimize disabled={busy} onClick={onPrepare}>Prepare again</button>
      <button type="button" disabled={busy} onClick={() => onSave(draftTitle, draftDescription)}>Save draft</button>
      <button type="button" className="primary" data-apply-optimize disabled={busy} onClick={() => onApply(draftTitle, draftDescription)}>Apply to listing</button>
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

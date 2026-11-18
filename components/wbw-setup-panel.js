'use client';
import { useState } from 'react';
import { bootListerOnly, WBW_SIGNUP_HINT, WBW_SIGNUP_URL, wbwSetupSections } from '../lib/wbw-account';

// Hand-off panel: every intake answer next to the WBW field it goes in, with a copy button.
// Nothing is sent to WBW. password: plain text if the caller has it; otherwise reveal() fetches it (audited).
export default function WbwSetupPanel({ row, password = null, reveal = null }) {
  const [copied, setCopied] = useState('');
  const [err, setErr] = useState('');
  const pw = password;
  const sections = wbwSetupSections(row, { password: pw });
  const extra = bootListerOnly(row);
  const copy = async (key, value) => {
    setErr('');
    try {
      let v = value;
      if ((key === 'password' || key === 'confirm_password') && !v) {
        if (!reveal) throw new Error('No password saved.');
        v = await reveal();
      }
      await navigator.clipboard.writeText(v);
      setCopied(key);
      setTimeout(() => setCopied(c => c === key ? '' : c), 1500);
    } catch (ex) { setErr(ex.message || 'Could not copy.'); }
  };
  return (
    <section className="wbw-setup" aria-label="WBW account setup">
      <h2>WBW account setup</h2>
      <p className="hint">Open WBW, then paste each answer into the field with the same name. Nothing is sent to WBW for you.</p>
      <p><a className="wbw-link" href={WBW_SIGNUP_URL} target="_blank" rel="noopener noreferrer">Create WBW account</a> <small>{WBW_SIGNUP_HINT}</small></p>
      {sections.map(s => (
        <div key={s.key} className="wbw-section">
          <h3>{s.title}</h3>
          {s.hint && <p className="hint">{s.hint}</p>}
          {s.fields.map(x => {
            const shown = x.secret ? (pw ? '••••••••' : '(hidden, copy to reveal)') : x.value;
            const over = x.max && x.value && x.value.length > x.max;
            return (
              <div key={x.key} className="wbw-row">
                <div className="wbw-label">{x.label}</div>
                <div className="wbw-value">{x.link ? <a href={x.link} target="_blank" rel="noopener noreferrer">Open photo</a> : shown}
                  {x.note && <small> {x.note}</small>}
                  {over && <small className="warn"> Over WBW’s {x.max}-character limit; trim before pasting.</small>}
                </div>
                {x.copy && (x.value || x.secret) && <button type="button" className="copy" onClick={() => copy(x.key, x.value)}>{copied === x.key ? 'Copied' : 'Copy'}</button>}
              </div>
            );
          })}
        </div>
      ))}
      {extra.length > 0 && <div className="wbw-section">
        <h3>BootLister only (no WBW field)</h3>
        {extra.map(([l, v]) => <div key={l} className="wbw-row"><div className="wbw-label">{l}</div><div className="wbw-value">{v}</div><button type="button" className="copy" onClick={() => copy(l, v)}>{copied === l ? 'Copied' : 'Copy'}</button></div>)}
      </div>}
      {err && <p className="err" role="alert">{err}</p>}
    </section>
  );
}

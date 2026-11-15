'use client';
import { useRef, useState } from 'react';
import { SELLER_TERMS, TERMS_HEADING, TERMS_SOURCE, termsCopyText } from '../lib/seller-terms';

// Collapsible, copyable seller terms. With acceptanceUrl (admin, per application) the copied text ends with that link.
// compact: just the copy button (admin list).
export default function SellerTerms({ acceptanceUrl = '', compact = false, open = false }) {
  const ref = useRef(null);
  const [note, setNote] = useState('');
  const text = termsCopyText(acceptanceUrl && typeof window !== 'undefined' ? new URL(acceptanceUrl, location.origin).href : acceptanceUrl);
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); setNote('Copied.'); }
    catch {
      const el = ref.current;
      if (el) { el.hidden = false; el.focus(); el.select(); try { document.execCommand('copy'); } catch {} }
      setNote('Selected — press Copy (or Ctrl/Cmd+C).');
    }
  };
  const button = <button type="button" onClick={copy}>{acceptanceUrl ? 'Copy terms + acceptance link' : 'Copy terms'}</button>;
  if (compact) return <span>{button}<textarea ref={ref} hidden readOnly value={text} rows="4" aria-label="Terms text" />{note && <small> {note}</small>}</span>;
  return (
    <details className="terms" open={open}>
      <summary>Seller terms</summary>
      <strong>{TERMS_HEADING}</strong>
      <div className="terms-text" style={{ whiteSpace: 'pre-wrap', userSelect: 'text' }}>{SELLER_TERMS}</div>
      <p><a href={TERMS_SOURCE} target="_blank" rel="noopener noreferrer">Read the full Western Boot World Terms of Service</a></p>
      {button}{note && <small> {note}</small>}
      <textarea ref={ref} hidden readOnly value={text} rows="6" aria-label="Terms text" />
    </details>
  );
}

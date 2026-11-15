'use client';
import { EMAIL_PREFS, PAYMENT_METHODS, PRICE_FREQUENCIES } from '../lib/public-intake-constants';
import SellerTerms from './seller-terms';
import { WBW_SIGNUP_STEPS, WBW_SIGNUP_URL, wbwCopyFields } from '../lib/wbw-account';
const day = v => new Date(v).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const termsStatus = r => r.terms_accepted_at ? `Accepted ${day(r.terms_accepted_at)}${r.terms_accepted_name ? ` by ${r.terms_accepted_name}` : ''}` : r.terms_sent_at ? `Sent ${day(r.terms_sent_at)}` : 'Not sent';
const copyLink = async path => { const url = new URL(path, location.origin).href; try { await navigator.clipboard.writeText(url); } catch { prompt('Copy this acceptance link:', url); } };

const EXTRA = [['aliases', 'Aliases'], ['bio', 'Bio'], ['fun_fact', 'Fun fact'], ['sells_where', 'Sells today'],
  ['boot_types', 'Boots'], ['measurement_method', 'Measures boots by'], ['pairs_estimate', 'Pairs to list'], ['notes', 'Notes'],
  ['pricing_notes', 'Pricing change'], ['shipping_policy', 'Shipping policy'], ['return_policy', 'Return policy']];
const payLabel = p => [...(p?.methods || []).filter(k => k !== 'other').map(k => PAYMENT_METHODS.find(([m]) => m === k)?.[1] || k), ...(p?.other ? [p.other] : p?.methods?.includes('other') ? ['Other'] : [])].join(', ');
const STATUS = { pending: 'Pending application', approved: 'Approved', declined: 'Declined' };
const copyText = async (v, label) => { try { await navigator.clipboard.writeText(v); } catch { prompt(`Copy ${label}:`, v); } };

const api = (method, body, path = '/api/intake-submissions') =>
  fetch(path, { method, headers: { 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) })
    .then(async r => { const j = await r.json(); if (!r.ok) throw new Error(j.error); return j; });

export default function IntakeSubmissions({ rows = [], onChange, busy, setBusy, setErr }) {
  const act = async (body, ok) => {
    setErr(''); setBusy(true);
    try {
      const r = await api('POST', body);
      if (ok) ok(r);
      if (body.action !== 'reveal') onChange?.();
      if (body.action === 'review') dispatchEvent(new Event('intake-reviewed'));
      return r;
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };
  const reveal = async id => {
    if (!confirm('Show the temporary WBW password? This is recorded.')) return;
    const r = await act({ action: 'reveal', id });
    if (r?.password) {
      const shown = document.getElementById(`pw-${id}`);
      if (shown) shown.value = r.password;
    }
  };

  const copyPassword = async id => {
    if (!confirm('Copy the temporary WBW password? This is recorded.')) return;
    const r = await act({ action: 'reveal', id });
    if (r?.password) await copyText(r.password, 'temporary password');
  };

  return (
    <div className="panel" id="applications">
      <strong>Public seller intake</strong>
      <small>Share <a href="/intake">/intake</a> or create a one-time link. Approve creates the BootLister seller from the application (once; approving again links the same seller). Decline only marks it declined. Temporary passwords are for WBW registration only. Reveal is recorded. Clear the password after you register them on WBW.</small>
      <span><button type="button" disabled={busy} onClick={() => act({ action: 'invite' }, r => { if (r?.url) { const el = document.getElementById('intake-invite-url'); if (el) el.value = `${location.origin}${r.url}`; } })}>Create intake link</button></span>
      <label>Intake link (shown once)<input id="intake-invite-url" readOnly data-private="" placeholder="Create a link to fill this" /></label>
      {!rows.length && <p className="empty">No public intake forms yet.</p>}
      {rows.map(r => (
        <div className="packet" key={r.id}>
          {r.photo_url && <img src={r.photo_url} alt="" width="48" height="48" />}
          <div>
            <strong>{r.display_name || 'Intake link (not filled yet)'}</strong>
            {r.username && <small>@{r.username}</small>}
            {r.sells_belts != null && <small><b>Belt dealer:</b> {r.sells_belts ? 'Yes' : 'No'}</small>}
            {r.price_change_frequency && <small><b>Changes prices:</b> {PRICE_FREQUENCIES.find(([k]) => k === r.price_change_frequency)?.[1] || r.price_change_frequency.replace(/^other: /, 'Other: ')}</small>}
            {r.encyclopedia_help != null && <small><b>Help build encyclopedia:</b> {r.encyclopedia_help ? 'Yes' : 'No'}</small>}
            {r.encyclopedia_permission != null && <small><b>Encyclopedia may use photos/details:</b> {r.encyclopedia_permission ? 'Yes' : 'No'}</small>}
            {r.pricing_change && <small><b>Change pricing:</b> {r.pricing_change === 'yes' ? 'Yes' : 'No, keep prices'}</small>}
            {r.payment_methods && <small><b>Payment methods:</b> {payLabel(r.payment_methods)}</small>}
            {r.email && <small><b>Terms:</b> {termsStatus(r)}</small>}
            {r.email && <label className="check"><input type="checkbox" checked={!!r.terms_sent_at} disabled={busy} onChange={e => act({ action: 'terms-sent', id: r.id, sent: e.target.checked })} /> Terms sent</label>}
            {r.terms_url && <span><button type="button" onClick={() => copyLink(r.terms_url)}>Copy acceptance link</button> <SellerTerms compact acceptanceUrl={r.terms_url} /></span>}
            {r.email && <div className="wbw-copy">
              <a href={WBW_SIGNUP_URL} target="_blank" rel="noopener noreferrer">Create WBW account</a> <small>{WBW_SIGNUP_STEPS}</small>
              {r.has_wbw_account && <small><b>Already has WBW account</b> — no password to copy; link their existing account.</small>}
              <span>{wbwCopyFields(r).map(f => <button key={f.key} type="button" disabled={busy} title={f.value || ''}
                onClick={() => f.key === 'password' ? copyPassword(r.id) : copyText(f.value, f.label)}>Copy {f.label}</button>)}</span>
            </div>}
            {r.status === 'approved' && r.seller_name && <small><b>BootLister seller:</b> {r.seller_name}</small>}
            {r.has_wbw_account != null && <small><b>WBW account:</b> {r.has_wbw_account ? 'Already has one (link it)' : 'Needs one (we set it up)'}</small>}
            {r.import_mode && <small><b>Import:</b> {r.import_mode === 'live' ? 'Live (list for sale right away)' : 'Drafts in their WBW account'}</small>}
            <small>{r.email || 'No email yet'}{r.location ? ` · ${r.location}` : ''}{r.phone ? ` · ${r.phone}` : ''}</small>
            <small>{STATUS[r.status] || r.status}{r.has_password ? ' · password saved' : r.password_cleared_at ? ' · password cleared' : ' · no password'}</small>
            {EXTRA.filter(([k]) => r[k]).map(([k, l]) => <small key={k}><b>{l}:</b> {r[k]}</small>)}
            {r.email_prefs && <small><b>Emails:</b> {EMAIL_PREFS.filter(([k]) => r.email_prefs[k]).map(([, l]) => l).join(', ') || 'none'}</small>}
            {r.has_password && <label>Temporary WBW password<input id={`pw-${r.id}`} data-private="" type="text" readOnly autoComplete="off" />
            </label>}
            <span>
              {r.status === 'pending' && r.email && <><button type="button" className="primary" disabled={busy} onClick={() => act({ action: 'review', id: r.id, decision: 'approved' })}>Approve application</button>
              <button type="button" disabled={busy} onClick={() => confirm('Decline this application?') && act({ action: 'review', id: r.id, decision: 'declined' })}>Decline</button></>}
              {r.has_password && <button type="button" disabled={busy} onClick={() => reveal(r.id)}>Reveal password</button>}
              {r.has_password && <button type="button" disabled={busy} onClick={() => confirm('Clear this password? Use this after you register them on WBW.') && act({ action: 'clear', id: r.id })}>Clear password (registered on WBW)</button>}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

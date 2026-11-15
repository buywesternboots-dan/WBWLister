'use client';
import { EMAIL_PREFS } from '../lib/public-intake-constants';

const EXTRA = [['aliases', 'Aliases'], ['bio', 'Bio'], ['fun_fact', 'Fun fact'], ['sells_where', 'Sells today'],
  ['boot_types', 'Boots'], ['pairs_estimate', 'Pairs to list'], ['notes', 'Notes']];

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

  return (
    <div className="panel">
      <strong>Public seller intake</strong>
      <small>Share <a href="/intake">/intake</a> or create a one-time link. Submissions are stored for you to review and integrate later — nothing here creates a seller. Temporary passwords are for WBW registration only. Reveal is recorded. Clear the password after you register them on WBW.</small>
      <span><button type="button" disabled={busy} onClick={() => act({ action: 'invite' }, r => { if (r?.url) { const el = document.getElementById('intake-invite-url'); if (el) el.value = `${location.origin}${r.url}`; } })}>Create intake link</button></span>
      <label>Intake link (shown once)<input id="intake-invite-url" readOnly data-private="" placeholder="Create a link to fill this" /></label>
      {!rows.length && <p className="empty">No public intake forms yet.</p>}
      {rows.map(r => (
        <div className="packet" key={r.id}>
          {r.photo_url && <img src={r.photo_url} alt="" width="48" height="48" />}
          <div>
            <strong>{r.display_name || 'Intake link (not filled yet)'}</strong>
            {r.username && <small>@{r.username}</small>}
            {r.import_mode && <small><b>Import:</b> {r.import_mode === 'live' ? 'Live (list for sale right away)' : 'Drafts in their WBW account'}</small>}
            <small>{r.email || 'No email yet'}{r.location ? ` · ${r.location}` : ''}{r.phone ? ` · ${r.phone}` : ''}</small>
            <small>{r.status === 'approved' ? `Approved as ${r.seller_name}` : 'Pending'}{r.has_password ? ' · password saved' : r.password_cleared_at ? ' · password cleared' : ' · no password'}</small>
            {EXTRA.filter(([k]) => r[k]).map(([k, l]) => <small key={k}><b>{l}:</b> {r[k]}</small>)}
            {r.email_prefs && <small><b>Emails:</b> {EMAIL_PREFS.filter(([k]) => r.email_prefs[k]).map(([, l]) => l).join(', ') || 'none'}</small>}
            {r.has_password && <label>Temporary WBW password<input id={`pw-${r.id}`} data-private="" type="text" readOnly autoComplete="off" />
            </label>}
            <span>
              {r.has_password && <button type="button" disabled={busy} onClick={() => reveal(r.id)}>Reveal password</button>}
              {r.has_password && <button type="button" disabled={busy} onClick={() => confirm('Clear this password? Use this after you register them on WBW.') && act({ action: 'clear', id: r.id })}>Clear password (registered on WBW)</button>}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

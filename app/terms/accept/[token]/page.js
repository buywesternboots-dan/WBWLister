import AcceptTerms from './accept';
import { getTermsByToken } from '../../../../lib/public-intake-store';
import { isTermsToken } from '../../../../lib/terms-acceptance';
import { SELLER_TERMS, TERMS_HEADING, TERMS_SOURCE } from '../../../../lib/seller-terms';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Accept seller terms · BootLister', robots: { index: false, follow: false } };

// Public terms-acceptance page. The unguessable token in the link identifies the application.
export default async function Page({ params }) {
  const { token } = await params;
  let row = null;
  if (isTermsToken(token)) { try { row = await getTermsByToken(token); } catch { row = null; } }
  return (
    <main>
      <style>{css}</style>
      {!row ? <div className="panel"><h1>This link is not valid</h1><p>It may be mistyped or out of date. Please ask Dan for a new link.</p></div> : <>
        <h1>Seller terms</h1>
        <div className="panel">
          <strong>{TERMS_HEADING}</strong>
          <div style={{ whiteSpace: 'pre-wrap' }}>{SELLER_TERMS}</div>
          <p><a href={TERMS_SOURCE} target="_blank" rel="noopener noreferrer">Read the full Western Boot World Terms of Service</a></p>
          <AcceptTerms token={token} acceptedAt={row.accepted_at ? new Date(row.accepted_at).toISOString() : ''} />
        </div>
      </>}
    </main>
  );
}

const css = `
body{margin:0;font:16px/1.45 system-ui,sans-serif;color:#2b2118;background:#faf8f5}
main{max-width:640px;margin:0 auto;padding:16px 16px 48px}
h1{font-size:1.5rem;margin:8px 0}
.panel{display:flex;flex-direction:column;gap:10px;padding:16px;background:#fff;border:1px solid #e6dfd6;border-radius:8px}
label{display:flex;flex-direction:column;font-size:14px;color:#6b5a4a;gap:4px}
.check{flex-direction:row;align-items:center;gap:8px;font-size:15px;color:#2b2118}
.check input{width:20px;height:20px}
input,button{font:inherit;padding:10px 12px;border:1px solid #cfc6bb;border-radius:6px}
.primary{background:#1f6f6b;border-color:#1f6f6b;color:#fff}
.ok{padding:12px;border-radius:6px;background:#eef6f5;color:#1f4f4c;font-weight:600}
.err{color:#a3261b}
`;

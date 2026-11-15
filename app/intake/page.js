import PublicIntakeForm from '../../components/public-intake-form';
import SellerTerms from '../../components/seller-terms';
import { WBW_ACCOUNT_LABEL, WBW_ACCOUNT_URL } from '../../lib/wbw-account';

export const metadata = { title: 'Seller intake · BootLister', robots: { index: false, follow: false } };

// Public seller intake. No sign-in. The site layout still has the bug report button.
export default function IntakePage() {
  return (
    <main>
      <style>{css}</style>
      <h1>Seller intake</h1>
      <p className="intro">A short form so we can set up your Western Boot World seller profile and import your listings to Western Boot World.</p>
      <p className="intro"><a href={WBW_ACCOUNT_URL} target="_blank" rel="noopener noreferrer">{WBW_ACCOUNT_LABEL}</a></p>
      <PublicIntakeForm />
      <SellerTerms />
    </main>
  );
}

const css = `
body{margin:0;font:16px/1.45 system-ui,sans-serif;color:#2b2118;background:#faf8f5}
main{max-width:520px;margin:0 auto;padding:16px 16px 48px}
h1{font-size:1.5rem;margin:8px 0 4px}
.intro,.lead,.hint,small{color:#6b5a4a;font-size:14px}
.panel{display:flex;flex-direction:column;gap:10px;padding:16px;background:#fff;border:1px solid #e6dfd6;border-radius:8px}
fieldset{border:1px solid #e6dfd6;border-radius:8px;padding:12px;display:flex;flex-direction:column;gap:8px;margin:0}
legend{padding:0 6px;font-weight:600;color:#1f6f6b}
label{display:flex;flex-direction:column;font-size:13px;color:#6b5a4a;gap:2px}
input,select,textarea,button{font:inherit;padding:10px 12px;border:1px solid #cfc6bb;border-radius:6px;background:#fff;color:inherit}
.check{flex-direction:row;align-items:flex-start;gap:8px;font-size:15px;color:#2b2118}
.check input{width:20px;height:20px;flex-shrink:0;margin-top:2px}
.primary{background:#1f6f6b;border-color:#1f6f6b;color:#fff}
.primary:disabled{opacity:.5}
.err{color:#a3261b;margin:0}
.check span{display:flex;flex-direction:column;gap:2px}
legend{font-size:1.05rem}
b{color:#2b2118}
.choice{border:0;padding:4px 0;gap:10px}
.choice legend{padding:0;font-weight:500;color:#2b2118;font-size:15px}
.known{margin:4px 0;padding:12px;border-radius:6px;background:#eef6f5;color:#1f4f4c;font-size:15px}
.known a{color:#1f6f6b;font-weight:600}
h3{margin:12px 0 0;font-size:1rem;color:#1f6f6b}
.terms{margin-top:16px;padding:12px 16px;background:#fff;border:1px solid #e6dfd6;border-radius:8px;display:flex;flex-direction:column;gap:8px}
.terms summary{font-weight:600;cursor:pointer;color:#1f6f6b}
.terms-text{max-height:50vh;overflow:auto;font-size:14px;border:1px solid #eee;padding:8px;border-radius:6px;margin:8px 0}
.preview{width:96px;height:96px;object-fit:cover;border-radius:8px;background:#eee}
.hp{position:absolute;left:-10000px;width:1px;height:1px;overflow:hidden}
.thanks p{margin:8px 0 0;color:#6b5a4a}
@media(max-width:640px){main{padding:12px 12px 40px}input,select,textarea,button{width:100%;box-sizing:border-box}}
`;

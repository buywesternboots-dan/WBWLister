import PublicIntakeForm from '../../components/public-intake-form';

export const metadata = { title: 'Seller intake · BootLister', robots: { index: false, follow: false } };

// Open form, no sign-in (Dan, Nov 15 11:35 PM). Often filled in by Dan on a call with the seller.
export default function IntakePage() {
  return (
    <main>
      <style>{css}</style>
      <h1>Seller intake</h1>
      <p className="intro">Saving creates the BootLister seller, then shows what to paste into Western Boot World.</p>
      <PublicIntakeForm />
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
.pw{position:relative;display:flex}
.pw input{flex:1;padding-right:48px}
.pw .eye{position:absolute;right:2px;top:50%;transform:translateY(-50%);width:44px!important;height:40px;padding:0;border:0;background:transparent;display:flex;align-items:center;justify-content:center;color:#6b5a4a}
.preview{width:96px;height:96px;object-fit:cover;border-radius:8px;background:#eee}
.wbw-setup h2{font-size:1.2rem;margin:4px 0}
.wbw-link{display:inline-block;padding:10px 14px;background:#1f6f6b;color:#fff;border-radius:6px;font-weight:600;text-decoration:none}
.wbw-section{border-top:1px solid #e6dfd6;padding-top:8px;margin-top:8px}
.wbw-row{display:grid;grid-template-columns:1fr auto;gap:2px 8px;padding:6px 0;border-bottom:1px dashed #eee;align-items:center}
.wbw-label{grid-column:1;font-size:12px;color:#6b5a4a}
.wbw-value{grid-column:1;white-space:pre-wrap;word-break:break-word}
.wbw-row .copy{grid-column:2;grid-row:1/span 2;width:auto!important;padding:8px 12px}
.warn{color:#a3261b}
.hp{position:absolute;left:-10000px;width:1px;height:1px;overflow:hidden}
@media(max-width:640px){main{padding:12px 12px 40px}input,select,textarea,button{width:100%;box-sizing:border-box}}
`;

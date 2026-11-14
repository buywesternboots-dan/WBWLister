import PublicIntakeForm from '../../components/public-intake-form';

export const metadata = { title: 'Seller intake · BootLister', robots: { index: false, follow: false } };

// Public seller intake. No sign-in. The site layout still has the bug report button.
export default function IntakePage() {
  return (
    <main>
      <style>{css}</style>
      <h1>Seller intake</h1>
      <p className="intro">A short form so we can set up your Western Boot World seller profile and import your listings for review.</p>
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
.preview{width:96px;height:96px;object-fit:cover;border-radius:8px;background:#eee}
.hp{position:absolute;left:-10000px;width:1px;height:1px;overflow:hidden}
.thanks p{margin:8px 0 0;color:#6b5a4a}
@media(max-width:640px){main{padding:12px 12px 40px}input,select,textarea,button{width:100%;box-sizing:border-box}}
`;

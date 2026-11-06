import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import MarkFixed from './toggle';
import { listReports } from '../../../lib/bug-store';
import { filterReports, priorityColor, priorityFilter, renderAnalysis, safeHttpUrl, safeImageSrc } from '../../../lib/bugs';
import { sessionSecret } from '../../../lib/gate';
import { readSession } from '../../../lib/session';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Bug reports · BootLister', robots: { index: false, follow: false } };

const FILTERS = [['', 'All'], ['High', 'High'], ['Medium', 'Medium'], ['Low', 'Low'], ['Question', 'Question']];
const stamp = v => {
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
};

export default async function BugReports({ searchParams }) {
  const jar = await cookies();
  const who = await readSession(jar.get('auth')?.value, sessionSecret());
  if (!who) redirect('/login');
  if (who.role !== 'admin') redirect('/');
  const q = await searchParams;
  const raw = typeof q?.priority === 'string' ? q.priority : '';
  const selected = priorityFilter(raw);
  const rows = filterReports(await listReports(selected), selected);
  return <main>
    <style>{css}</style>
    <header>
      <div>
        <h1>Bug reports</h1>
        <a href="/">Back to inventory</a>
      </div>
      <nav>
        {FILTERS.map(([value, label]) => {
          const href = value ? `/admin/bugs?priority=${value}` : '/admin/bugs';
          const on = value === (selected || '');
          return <a key={label} href={href} aria-current={on ? 'page' : undefined}>{label}</a>;
        })}
      </nav>
    </header>
    {!rows.length && <p className="empty">No reports{selected ? ` marked ${selected}` : ''}.</p>}
    {rows.map(row => {
      const href = safeHttpUrl(row.page_url);
      const src = safeImageSrc(row.image);
      const analysis = renderAnalysis(row.ai_analysis);
      return <article key={row.id} style={{ borderLeftColor: priorityColor(row.priority) }}>
        <header>
          <span className="badge" style={{ background: priorityColor(row.priority) }}>{row.priority}</span>
          <span>#{row.id} · {stamp(row.created_at)} · {row.reporter || 'anonymous'} · {row.status || 'open'}</span>
          <MarkFixed id={row.id} status={row.status} />
        </header>
        <div className="split">
          <div>{src ? <img src={src} alt={`Annotated screenshot for report ${row.id}`} /> : <p>No screenshot.</p>}</div>
          <div>
            {href ? <a href={href}>{href}</a> : <p>No page link.</p>}
            <p className="meta">{row.viewport} {row.user_agent}</p>
            <h2>Note</h2>
            <pre>{row.transcript || '(no transcript)'}</pre>
            {analysis && <><h2>AI analysis</h2><div className="md" dangerouslySetInnerHTML={{ __html: analysis }} /></>}
          </div>
        </div>
      </article>;
    })}
  </main>;
}

const css = `
body{margin:0;background:#faf8f5;color:#2b2118;font:16px/1.45 system-ui,sans-serif}
main{max-width:960px;margin:0 auto;padding:16px}
main > header{display:flex;flex-wrap:wrap;gap:12px;justify-content:space-between;align-items:center;margin-bottom:16px}
h1{font-size:22px;margin:0 0 4px}h2{font-size:15px;margin:12px 0 4px}
nav{display:flex;flex-wrap:wrap;gap:6px}
nav a,article header a{color:#1f6f6b}
nav a{text-decoration:none;border:1px solid #cfc6bb;border-radius:999px;padding:4px 10px;background:#fff}
nav a[aria-current="page"]{background:#1f6f6b;color:#fff;border-color:#1f6f6b}
article{background:#fff;border:1px solid #e6dfd6;border-left-width:6px;border-radius:8px;padding:12px;margin-bottom:12px}
article header{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:0 0 10px;font-size:14px;color:#6b5a4a}
.badge{color:#fff;border-radius:999px;padding:2px 8px;font-size:12px;font-weight:700}
.split{display:flex;flex-direction:column;gap:12px}
@media(min-width:800px){.split{display:grid;grid-template-columns:minmax(200px,1fr) minmax(240px,1.1fr)}}
img{width:100%;height:auto;border-radius:8px;border:1px solid #e6dfd6;background:#111}
pre,.md{white-space:pre-wrap;word-break:break-word;background:#faf8f5;border-radius:8px;padding:8px;margin:0}
.md pre{background:#fff}
.meta{color:#6b5a4a;font-size:13px}
.empty{color:#6b5a4a}
`;

// bug_reports auto-creates on first use, same as the other tables in lib/wbw.js.
// bug_report_limits is the per-IP / per-user counter. A process-local map would reset on every Vercel isolate.
import { neon } from '@neondatabase/serverless';

let db;
let ready;
const conn = () => db ??= neon(process.env.DATABASE_URL);

export function ensureBugTables() {
  return ready ??= (async () => {
    const sql = conn();
    await sql`create table if not exists bug_reports (
      id serial primary key,
      priority text not null check (priority in ('High', 'Medium', 'Low', 'Question')),
      transcript text,
      image text,
      page_url text,
      user_agent text,
      viewport text,
      reporter text,
      ai_analysis text,
      status text default 'open',
      created_at timestamptz default now()
    )`;
    await sql`create table if not exists bug_report_limits (
      key text primary key,
      n int not null,
      window_start timestamptz not null
    )`;
    await sql`create index if not exists bug_reports_created_idx on bug_reports (created_at desc, id desc)`;
  })().catch(e => { ready = null; throw e; });
}

export async function listReports(priority) {
  await ensureBugTables();
  const sql = conn();
  if (priority) return sql`select id, priority, transcript, image, page_url, user_agent, viewport, reporter, ai_analysis, status, created_at
    from bug_reports where priority = ${priority} order by created_at desc, id desc`;
  return sql`select id, priority, transcript, image, page_url, user_agent, viewport, reporter, ai_analysis, status, created_at
    from bug_reports order by created_at desc, id desc`;
}

export async function insertReport(row) {
  await ensureBugTables();
  const sql = conn();
  const [saved] = await sql`insert into bug_reports
    (priority, transcript, image, page_url, user_agent, viewport, reporter, ai_analysis)
    values (${row.priority}, ${row.transcript}, ${row.image}, ${row.page_url}, ${row.user_agent}, ${row.viewport}, ${row.reporter}, ${row.ai_analysis})
    returning id`;
  return { id: Number(saved.id) };
}

export async function setStatus(id, status) {
  await ensureBugTables();
  const sql = conn();
  const [row] = await sql`update bug_reports set status = ${status} where id = ${id} returning id, status`;
  return row ? { id: Number(row.id), status: row.status } : null;
}

export async function readLimit(key) {
  await ensureBugTables();
  const sql = conn();
  const [row] = await sql`select n, window_start from bug_report_limits where key = ${key}`;
  return row ? { n: Number(row.n), start: new Date(row.window_start).getTime() } : null;
}

export async function writeLimit(key, next) {
  await ensureBugTables();
  const sql = conn();
  const at = new Date(next.start).toISOString();
  await sql`insert into bug_report_limits (key, n, window_start) values (${key}, ${next.n}, ${at})
    on conflict (key) do update set n = ${next.n}, window_start = ${at}`;
}

export async function reporterFor(who) {
  if (!who || who.role === 'admin') return who?.role === 'admin' ? 'admin' : 'anonymous';
  await ensureBugTables();
  const sql = conn();
  const [row] = await sql`select email, phone from sellers where name = ${who.seller}`;
  return String(row?.email || row?.phone || who.seller || 'anonymous').slice(0, 200);
}

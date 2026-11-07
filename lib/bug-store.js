// bug_reports auto-creates on first use, same as the other tables in lib/wbw.js.
// bug_report_limits is the per-IP / per-user counter. A process-local map would reset on every Vercel isolate.
import { neon } from '@neondatabase/serverless';

let db;
let ready;
const conn = () => db ??= neon(process.env.DATABASE_URL);
export function useBugSql(client) {
  db = client;
  ready = null;
}

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

// One page of screenshots. Callers pass a small limit; the default is one page, not the whole table.
export async function listReports(priority, { limit = 13, offset = 0 } = {}) {
  await ensureBugTables();
  const sql = conn();
  const take = Math.min(50, Math.max(1, Math.floor(Number(limit) || 13)));
  const skip = Math.max(0, Math.floor(Number(offset) || 0));
  if (priority) return sql`select id, priority, transcript, image, page_url, user_agent, viewport, reporter, ai_analysis, status, created_at
    from bug_reports where priority = ${priority} order by created_at desc, id desc limit ${take} offset ${skip}`;
  return sql`select id, priority, transcript, image, page_url, user_agent, viewport, reporter, ai_analysis, status, created_at
    from bug_reports order by created_at desc, id desc limit ${take} offset ${skip}`;
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

// One statement. INSERT .. ON CONFLICT locks the row, so two anonymous requests cannot both take the last slot.
// The WHERE skips the update once the window's count is already at the cap, and RETURNING is empty in that case.
// A read-then-write of a client-supplied n is not used: that overwrite let concurrent requests stay under the cap.
export async function admitLimit(key, max, windowMs) {
  await ensureBugTables();
  const sql = conn();
  const secs = Number(windowMs) / 1000;
  const cap = Math.floor(Number(max));
  const rows = await sql`insert into bug_report_limits (key, n, window_start)
    values (${key}, 1, now())
    on conflict (key) do update set
      n = case
        when bug_report_limits.window_start <= now() - make_interval(secs => ${secs}) then 1
        else bug_report_limits.n + 1
      end,
      window_start = case
        when bug_report_limits.window_start <= now() - make_interval(secs => ${secs}) then now()
        else bug_report_limits.window_start
      end
    where bug_report_limits.window_start <= now() - make_interval(secs => ${secs})
       or bug_report_limits.n < ${cap}
    returning n`;
  const list = Array.isArray(rows) ? rows : [];
  return { allow: list.length > 0, n: list.length ? Number(list[0].n) : null };
}

export async function reporterFor(who) {
  if (!who || who.role === 'admin') return who?.role === 'admin' ? 'admin' : 'anonymous';
  await ensureBugTables();
  const sql = conn();
  const [row] = await sql`select email, phone from sellers where name = ${who.seller}`;
  return String(row?.email || row?.phone || who.seller || 'anonymous').slice(0, 200);
}

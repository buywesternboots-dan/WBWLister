// The session version stored on the seller row. A password change increments it.
import { neon } from '@neondatabase/serverless';

let db, ready;
export async function sellerSessionVersion(name) {
  db ??= neon(process.env.DATABASE_URL);
  ready ??= db`alter table sellers add column if not exists session_v int not null default 0`.catch(e => { ready = null; throw e; });
  await ready;
  const [r] = await db`select coalesce(session_v, 0)::int as v from sellers where name = ${name}`;
  return r ? Number(r.v) : null;
}

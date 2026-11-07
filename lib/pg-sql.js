// Tagged-template client with the same call shape as @neondatabase/serverless, over node-postgres.
// Parameter binding is node-pg's (objects become JSON text, arrays become Postgres arrays).
// Neon sends those prepared values over HTTP instead of the wire protocol. This file does not call Neon.

export function pgSql(pool) {
  const run = async (text, params = []) => (await pool.query(text, params)).rows;
  const sql = (strings, ...values) => {
    let text = '';
    for (let i = 0; i < strings.length; i++) text += strings[i] + (i < values.length ? `$${i + 1}` : '');
    return run(text, values);
  };
  sql.query = (text, params = []) => run(text, params);
  return sql;
}

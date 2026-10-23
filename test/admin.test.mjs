import { test } from 'node:test';
import assert from 'node:assert/strict';
import { requireAdmin } from '../lib/http.js';
import { sessionToken } from '../lib/session.js';

const SECRET = 'team-secret';

async function withPassword(value, fn) {
  const prev = process.env.APP_PASSWORD;
  if (value === undefined) delete process.env.APP_PASSWORD;
  else process.env.APP_PASSWORD = value;
  try { return await fn(); }
  finally {
    if (prev === undefined) delete process.env.APP_PASSWORD;
    else process.env.APP_PASSWORD = prev;
  }
}

const req = headers => ({ headers: new Headers(headers) });

test('migrate auth rejects when APP_PASSWORD is unset, and accepts only an admin', async () => {
  await withPassword(undefined, async () => {
    await assert.rejects(requireAdmin(req({ 'x-app-password': 'anything' })), /APP_PASSWORD is not set/);
  });
  await withPassword('   ', async () => {
    await assert.rejects(requireAdmin(req({})), e => e.status === 401);
  });
  await withPassword(SECRET, async () => {
    await assert.rejects(requireAdmin(req({})), e => e.status === 401 && /Only the team/.test(e.message));
    await assert.rejects(requireAdmin(req({ 'x-app-password': 'nope' })), e => e.status === 401);
    await requireAdmin(req({ 'x-app-password': SECRET }));
    const admin = await sessionToken('admin', SECRET);
    const seller = await sessionToken('seller:ada', SECRET);
    await requireAdmin(req({ cookie: `auth=${admin}` }));
    await requireAdmin({ headers: new Headers(), cookies: { get: name => name === 'auth' ? { value: admin } : undefined } });
    await assert.rejects(requireAdmin(req({ cookie: `auth=${seller}` })), e => e.status === 401);
    await assert.rejects(requireAdmin(req({ cookie: 'auth=admin.forged' })), e => e.status === 401);
  });
});

// When the site is locked. ADMIN_PASSWORD is the password WBW staff type (username "admin").
// It is never stored. APP_PASSWORD signs the session cookie. Either one is enough:
// if only one is set, it does both jobs, so a deploy that already has APP_PASSWORD is not wide open.
// Neither set + production (or any Vercel deploy) = closed. Neither set + local dev = open.
import { redirectFor } from './home';
import { readSession } from './session';

export const CLOSED = 'This site is closed until an admin password is set.';

export const isDeployed = (env = process.env) =>
  env.NODE_ENV === 'production' || env.VERCEL_ENV === 'production' || env.VERCEL_ENV === 'preview';

export const adminPassword = (env = process.env) => String(env.ADMIN_PASSWORD || env.APP_PASSWORD || '').trim();
export const sessionSecret = (env = process.env) => String(env.APP_PASSWORD || env.ADMIN_PASSWORD || '').trim();

// 'on' (password set) | 'closed' (deployed, no password) | 'dev-open' (local, no password)
export const siteMode = (env = process.env) =>
  adminPassword(env) && sessionSecret(env) ? 'on' : isDeployed(env) ? 'closed' : 'dev-open';

// What proxy.js should do with this request. No Next types here, so tests can run it directly.
export async function decide(pathname, token, env = process.env) {
  const mode = siteMode(env);
  if (mode === 'closed') return { type: 'closed', status: 503, error: CLOSED };
  if (mode === 'dev-open') return { type: 'next' };
  const who = await readSession(token, sessionSecret(env));
  if (!who) return pathname.startsWith('/api/')
    ? { type: 'json', status: 401, error: 'Please log in.' }
    : { type: 'redirect', to: '/login' };
  const to = redirectFor(who.role, pathname);
  if (to) return { type: 'redirect', to, who };
  return { type: 'next', who };
}

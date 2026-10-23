// Shared API route helpers. Errors come back as { error } with status 400.
import { readSession } from './session';

export const handle = fn => async req => {
  try { return Response.json(await fn(req)); }
  catch (e) { return Response.json({ error: e.message }, { status: e.status || 400 }); }
};

// Admin check that does not trust the proxy. APP_PASSWORD unset → rejected (the proxy would otherwise leave the route open).
export async function requireAdmin(req) {
  const secret = process.env.APP_PASSWORD?.trim();
  const deny = msg => { const e = new Error(msg); e.status = 401; throw e; };
  if (!secret) deny('APP_PASSWORD is not set.');
  if (req.headers.get('x-app-password') === secret) return;
  const token = req.cookies?.get?.('auth')?.value ?? readCookie(req.headers.get('cookie'), 'auth');
  if ((await readSession(token, secret))?.role !== 'admin') deny('Only the team can do that.');
}
const readCookie = (header, name) => header?.split(';').map(p => p.trim().split('=')).find(([k]) => k === name)?.slice(1).join('=');

// Seller logins are locked to their own seller (set by proxy.js); the team picks one (Authorization: Bearer <seller name>).
export const sessionSeller = req => req.headers.get('x-session-seller');
export const sellerOf = req => {
  const s = sessionSeller(req) ?? req.headers.get('authorization')?.replace('Bearer ', '').trim().toLowerCase();
  if (!s) throw new Error('Pick a seller first.');
  return s;
};
export const teamOnly = req => { if (sessionSeller(req)) throw new Error('Only the team can do that.'); };

// Who is calling, from the signed session — not from a header the browser can set.
// A seller session is that seller only. An admin picks a seller with Authorization: Bearer.
import { CLOSED, sessionSecret, siteMode } from './gate';
import { HttpError } from './http';
import { readSession } from './session';
import { sellerSessionVersion } from './session-db';

export function cookieVal(req, name) {
  const fromJar = req.cookies?.get?.(name)?.value;
  if (fromJar) return fromJar;
  for (const part of (req.headers?.get?.('cookie') ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i !== -1 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return '';
}

// { role: 'admin' } | { role: 'seller', seller }. Throws 503 / 401.
export async function actorFrom(req, env = process.env) {
  const mode = siteMode(env);
  if (mode === 'closed') throw new HttpError(CLOSED, 503);
  if (mode === 'dev-open') return { role: 'admin' };
  const who = await readSession(req.headers.get('x-auth') || cookieVal(req, 'auth'), sessionSecret(env));
  if (!who) throw new HttpError('Please log in.', 401);
  if (who.role === 'seller' && (env.sessionVersions || env.DATABASE_URL)) {
    const current = env.sessionVersions ? env.sessionVersions[who.seller] : await sellerSessionVersion(who.seller);
    if (current === undefined || current === null || Number(who.version ?? 0) !== Number(current)) throw new HttpError('Please log in.', 401);
  }
  return who.role === 'seller' ? { role: 'seller', seller: who.seller } : { role: 'admin' };
}

// Seller name this request may touch. A seller cannot name someone else, even with Bearer or x-session-seller.
export function sellerFor(who, req) {
  const bearer = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '').trim().toLowerCase();
  if (who?.role === 'seller') {
    if (bearer && bearer !== who.seller) throw new HttpError('You can only see your own items.', 403);
    return who.seller;
  }
  if (who?.role !== 'admin') throw new HttpError('Please log in.', 401);
  if (!bearer) throw new HttpError('Pick a seller first.', 400);
  return bearer;
}

export async function sellerContext(req, env) {
  const who = await actorFrom(req, env);
  return { who, seller: sellerFor(who, req) };
}

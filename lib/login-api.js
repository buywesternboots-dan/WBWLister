// Sign-in and seller registration. The route files call these; tests call them with an in-memory account list.
import { matchAdmin, sessionWho } from './auth';
import { CLOSED, sessionSecret, siteMode } from './gate';
import { HttpError } from './http';
import { sessionCookie, sessionToken } from './session';

const fail = e => Response.json({ error: e.message || 'Could not sign in.' }, { status: e.status || 400 });
const ok = ({ cookie, ...body }) => Response.json(body, { headers: { 'Set-Cookie': cookie } });

export async function loginApi(req, db, env = process.env) {
  if (req.method === 'DELETE') return { ok: true, cookie: sessionCookie('', 0) };
  if (siteMode(env) === 'closed') throw new HttpError(CLOSED, 503);
  const secret = sessionSecret(env);
  if (!secret) throw new HttpError('Logins aren\'t switched on yet (no admin password set).', 400);
  const body = await req.json().catch(() => ({}));
  const id = body.id ?? body.email ?? body.phone ?? '';
  const password = body.password ?? body.pin ?? '';
  const who = await matchAdmin(id, password, env) || await db.authenticate(id, password);
  if (!who) throw new HttpError('Wrong email, phone, or password.', 401);
  const token = await sessionToken(sessionWho(who), secret);
  return { ok: true, role: who.role, seller: who.seller ?? null, token, cookie: sessionCookie(token) };
}

export async function registerApi(req, db, env = process.env) {
  const mode = siteMode(env);
  if (mode === 'closed') throw new HttpError(CLOSED, 503);
  if (mode !== 'on') throw new HttpError('Registration needs an admin password configured.', 400);
  const account = await db.register(await req.json());
  const token = await sessionToken(sessionWho({ role: 'seller', seller: account.name }), sessionSecret(env));
  return { ok: true, role: 'seller', seller: account.name, token, cookie: sessionCookie(token) };
}

export const loginResponse = (req, db, env) => loginApi(req, db, env).then(ok, fail);
export const registerResponse = (req, db, env) => registerApi(req, db, env).then(ok, fail);

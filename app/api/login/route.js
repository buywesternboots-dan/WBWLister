import { sessionCookie, sessionToken } from '../../../lib/session';
import { sessionWho } from '../../../lib/auth';
import { authenticate } from '../../../lib/wbw';

const FAIL = 'Wrong email or PIN.';

// POST { email, pin } → team or that seller. DELETE → log out. Username is always an email.
export async function POST(req) {
  const secret = process.env.APP_PASSWORD;
  if (!secret) return Response.json({ error: 'Logins aren\'t switched on yet (no APP_PASSWORD set).' }, { status: 400 });
  try {
    const { email, pin, password } = await req.json();
    const who = await authenticate(email, pin ?? password);
    if (!who) return Response.json({ error: FAIL }, { status: 401 });
    const token = await sessionToken(sessionWho(who), secret);
    return Response.json({ ok: true, role: who.role, seller: who.seller ?? null, token }, { headers: { 'Set-Cookie': sessionCookie(token) } });
  } catch (e) {
    return Response.json({ error: e.message || 'Could not sign in.' }, { status: 500 });
  }
}
export const DELETE = () => Response.json({ ok: true }, { headers: { 'Set-Cookie': sessionCookie('', 0) } });

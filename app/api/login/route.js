import { sessionToken, sessionCookie } from '../../../lib/session';
import { checkSellerLogin } from '../../../lib/wbw';

// POST { password } → team login. POST { seller, password } → that seller's login. DELETE → log out.
export async function POST(req) {
  const { seller, password } = await req.json(), secret = process.env.APP_PASSWORD;
  if (!secret) return Response.json({ error: 'Logins aren\'t switched on yet (no APP_PASSWORD set).' }, { status: 400 });
  const name = seller?.trim().toLowerCase();
  const ok = name ? await checkSellerLogin(name, password) : password === secret;
  if (!ok) return Response.json({ error: 'Wrong name or password.' }, { status: 401 });
  return Response.json({ ok: true }, { headers: { 'Set-Cookie': sessionCookie(await sessionToken(name ? `seller:${name}` : 'admin', secret)) } });
}
export const DELETE = () => Response.json({ ok: true }, { headers: { 'Set-Cookie': sessionCookie('', 0) } });

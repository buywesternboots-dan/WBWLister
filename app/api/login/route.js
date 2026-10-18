import { token } from '../../../proxy';

// POST { password } → sets the login cookie (30 days).
export async function POST(req) {
  const { password } = await req.json();
  if (!process.env.APP_PASSWORD || password !== process.env.APP_PASSWORD) return Response.json({ error: 'Wrong password.' }, { status: 401 });
  return Response.json({ ok: true }, { headers: { 'Set-Cookie': `auth=${await token(password)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000` } });
}

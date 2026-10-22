// Everything needs a login (env APP_PASSWORD signs the session; none set = open, for local dev).
// An admin and sellers both sign in with an email + PIN and use the one home screen. The browser sends cookie "auth"; the extension sends the same
// token as x-auth (checked first, so a popup login isn't stuck behind a page cookie). Seller sessions set x-session-seller.
import { NextResponse } from 'next/server';
import { readSession } from './lib/session';

export async function proxy(req) {
  const secret = process.env.APP_PASSWORD;
  const headers = new Headers(req.headers);
  headers.delete('x-session-seller'); // only this proxy may set it
  if (!secret) return NextResponse.next({ request: { headers } });
  const who = await readSession(req.headers.get('x-auth') || req.cookies.get('auth')?.value, secret);
  if (!who) return req.nextUrl.pathname.startsWith('/api/')
    ? NextResponse.json({ error: 'Please log in.' }, { status: 401 })
    : NextResponse.redirect(new URL('/login', req.url));
  if (who.role === 'seller') headers.set('x-session-seller', who.seller);
  return NextResponse.next({ request: { headers } });
}

export const config = { matcher: ['/((?!login|api/login|img|feed|_next|favicon).*)'] };

// Everything needs a login (env APP_PASSWORD signs the session; none set = open, for local dev).
// An admin and a seller sign in the same way, then each is kept on their own screen. The browser sends cookie "auth";
// the extension sends the same token as x-auth (checked first). Seller sessions set x-session-seller.
import { NextResponse } from 'next/server';
import { redirectFor } from './lib/home';
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
  const to = redirectFor(who.role, req.nextUrl.pathname);
  if (to) return NextResponse.redirect(new URL(to, req.url));
  return NextResponse.next({ request: { headers } });
}

export const config = { matcher: ['/((?!login|api/login|img|feed|_next|favicon).*)'] };

// Everything needs a login (env APP_PASSWORD; none set = open, for local dev):
// - team: the team password (browser cookie, or the Chrome extension's x-app-password header) — the full tool;
// - seller: their own login (Seller settings) — locked to their items; the seller is passed on as x-session-seller.
import { NextResponse } from 'next/server';
import { readSession } from './lib/session';

export async function proxy(req) {
  const secret = process.env.APP_PASSWORD;
  const headers = new Headers(req.headers);
  headers.delete('x-session-seller'); // only this proxy may set it
  if (!secret) return NextResponse.next({ request: { headers } });
  const who = req.headers.get('x-app-password') === secret ? { role: 'admin' } : await readSession(req.cookies.get('auth')?.value, secret);
  if (!who) return req.nextUrl.pathname.startsWith('/api/')
    ? NextResponse.json({ error: 'Please log in.' }, { status: 401 })
    : NextResponse.redirect(new URL('/login', req.url));
  if (who.role === 'seller') headers.set('x-session-seller', who.seller);
  return NextResponse.next({ request: { headers } });
}

export const config = { matcher: ['/((?!login|api/login|_next|favicon).*)'] };

// Deployed with no admin password: closed (503). Local dev with no password: open.
// Otherwise a signed session is required. Staff and sellers each stay on their own screen.
// The browser sends cookie "auth"; the extension sends the same token as x-auth (checked first).
// API routes also check the session themselves (lib/access.js) — they do not trust x-session-seller.
import { NextResponse } from 'next/server';
import { decide } from './lib/gate';

export async function proxy(req) {
  const headers = new Headers(req.headers);
  headers.delete('x-session-seller'); // only this proxy may set it; routes still ignore it
  let decision;
  try {
    decision = await decide(req.nextUrl.pathname, req.headers.get('x-auth') || req.cookies.get('auth')?.value);
  } catch {
    return req.nextUrl.pathname.startsWith('/api/')
      ? NextResponse.json({ error: 'Please log in.' }, { status: 401 })
      : NextResponse.redirect(new URL('/login', req.url));
  }
  if (decision.type === 'closed') return req.nextUrl.pathname.startsWith('/api/')
    ? NextResponse.json({ error: decision.error }, { status: 503 })
    : new NextResponse(decision.error, { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  if (decision.type === 'json') return NextResponse.json({ error: decision.error }, { status: decision.status });
  if (decision.type === 'redirect') return NextResponse.redirect(new URL(decision.to, req.url));
  if (decision.who?.role === 'seller') headers.set('x-session-seller', decision.who.seller);
  return NextResponse.next({ request: { headers } });
}

export const config = { matcher: ['/((?!login|api/login|api/register|img|feed|_next|favicon).*)'] };

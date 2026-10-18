// Internal tool: everything needs the team password (env APP_PASSWORD). The browser logs in once (cookie);
// the Chrome extension sends it in the x-app-password header. No APP_PASSWORD set = no protection (local dev).
import { NextResponse } from 'next/server';

export const token = async pw => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`wbwlister:${pw}`)))]
  .map(b => b.toString(16).padStart(2, '0')).join('');

export async function proxy(req) {
  const pw = process.env.APP_PASSWORD;
  if (!pw || req.headers.get('x-app-password') === pw || req.cookies.get('auth')?.value === await token(pw)) return NextResponse.next();
  if (req.nextUrl.pathname.startsWith('/api/')) return NextResponse.json({ error: 'Wrong or missing password.' }, { status: 401 });
  return NextResponse.redirect(new URL('/login', req.url));
}

export const config = { matcher: ['/((?!login|api/login|_next|favicon).*)'] };

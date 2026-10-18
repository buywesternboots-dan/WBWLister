// Login sessions (cookie "auth"): "admin" for the team, "seller:<name>" for a seller. Signed with APP_PASSWORD, so they can't
// be forged and all stop working if the team password changes. Web Crypto only — runs in proxy.js and API routes alike.
const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
export const sha256 = async s => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
const sign = (who, secret) => sha256(`wbwlister:${secret}:${who}`);

export const sessionToken = async (who, secret) => `${encodeURIComponent(who)}.${await sign(who, secret)}`;
// → { role: 'admin' } | { role: 'seller', seller } | null
export async function readSession(token, secret) {
  const [enc, sig] = (token ?? '').split('.'), who = decodeURIComponent(enc ?? '');
  if (!who || sig !== await sign(who, secret)) return null;
  return who === 'admin' ? { role: 'admin' } : who.startsWith('seller:') ? { role: 'seller', seller: who.slice(7) } : null;
}
export const sessionCookie = (token, maxAge = 2592000) => `auth=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;

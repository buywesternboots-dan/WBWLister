// Login sessions (cookie "auth", or the extension header x-auth): "admin" for staff, "seller:<name>" for a seller.
// Signed with the session secret (APP_PASSWORD, or ADMIN_PASSWORD when that is the only one set) so they can't be forged.
// Changing that secret signs everyone out. Web Crypto only — runs in proxy.js and API routes alike.
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

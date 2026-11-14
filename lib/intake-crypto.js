// Temporary WBW registration passwords. AES-256-GCM with INTAKE_SECRET (hashed to 32 bytes).
// Fail closed if the secret is missing. Plaintext is never logged.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { HttpError } from './http';

export function intakeKey(env = process.env) {
  const s = String(env.INTAKE_SECRET ?? '').trim();
  if (!s) return null;
  return createHash('sha256').update(s).digest();
}

export const hasIntakeSecret = (env = process.env) => !!intakeKey(env);

export function encryptSecret(plain, env = process.env) {
  const key = intakeKey(env);
  if (!key) throw new HttpError('This form is not taking submissions yet.', 503);
  const text = String(plain ?? '');
  if (!text) throw new Error('A temporary password is required.');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64url');
}

export function decryptSecret(stored, env = process.env) {
  const key = intakeKey(env);
  if (!key) throw new HttpError('The intake secret is not set.', 503);
  const raw = String(stored ?? '');
  if (!raw) throw new Error('No temporary password is stored.');
  let buf;
  try { buf = Buffer.from(raw, 'base64url'); }
  catch { throw new Error('That password is not available.'); }
  if (buf.length < 29) throw new Error('That password is not available.');
  const iv = buf.subarray(0, 12), tag = buf.subarray(12, 28), enc = buf.subarray(28);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  try { return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8'); }
  catch { throw new Error('That password is not available.'); }
}

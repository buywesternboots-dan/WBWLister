import { handle, HttpError } from '../../../lib/http';
import { isHoneypot, clientIp, INTAKE_LIMIT } from '../../../lib/public-intake';
import { admitIntakeLimit, submitPublicIntake } from '../../../lib/public-intake-store';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Open POST from /intake (no sign-in). Rate-limited and honeypotted.
// Saves the intake and creates the BootLister seller. Returns only the new seller name, never the password,
// an intake id, or anything from another submission.
export async function publicIntakeResponse(req, db = { admit: admitIntakeLimit, submit: submitPublicIntake }, env = process.env) {
  if (req.method !== 'POST') throw new HttpError('Please log in.', 401);
  let body;
  try { body = await req.json(); }
  catch { throw new Error('That form could not be read.'); }
  if (isHoneypot(body)) return { ok: true };
  const ip = clientIp(req);
  const gate = await db.admit(`ip:${ip}`, INTAKE_LIMIT);
  if (!gate.ok) throw new HttpError('Please wait a bit before sending another form.', 429);
  const email = String(body?.email ?? '').trim().toLowerCase();
  if (email) {
    const emailGate = await db.admit(`email:${email.slice(0, 200)}`, INTAKE_LIMIT);
    if (!emailGate.ok) throw new HttpError('Please wait a bit before sending another form.', 429);
  }
  const out = await db.submit(body, { ip, env });
  return { ok: true, seller_name: out?.seller_name ?? null };
}

export const POST = handle(req => publicIntakeResponse(req));

import { actorFrom } from '../../../lib/access';
import { handle, HttpError } from '../../../lib/http';
import { submitPublicIntake } from '../../../lib/public-intake-store';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Admin-only POST from the intake sheet. Saves the intake and creates the BootLister seller.
// Never returns the temporary password (the sheet already has it in the browser).
export async function publicIntakeResponse(req, db = { submit: submitPublicIntake }, env = process.env) {
  const who = await actorFrom(req, env);
  if (who.role !== 'admin') throw new HttpError('Only an admin can do that.', 403);
  if (req.method !== 'POST') throw new HttpError('Unknown request.', 405);
  let body;
  try { body = await req.json(); }
  catch { throw new Error('That form could not be read.'); }
  const out = await db.submit(body, { env });
  return { ok: true, id: out.id, seller_name: out.seller_name };
}

export const POST = handle(req => publicIntakeResponse(req));

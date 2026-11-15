import { handle, HttpError } from '../../../../lib/http';
import { clientIp, readCheckQuery } from '../../../../lib/public-intake';
import { admitIntakeLimit, checkIntakeAccount } from '../../../../lib/public-intake-store';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const CHECK_LIMIT = 30;

// Public GET. Says only whether the email or username is already a seller or an earlier intake. Never returns account details.
export async function intakeCheckResponse(req, db = { admit: admitIntakeLimit, check: checkIntakeAccount }) {
  const q = readCheckQuery(new URL(req.url).searchParams);
  const gate = await db.admit(`check:${clientIp(req)}`, CHECK_LIMIT);
  if (!gate.ok) throw new HttpError('Please wait a bit before checking again.', 429);
  return { status: await db.check(q) };
}

export const GET = handle(req => intakeCheckResponse(req));

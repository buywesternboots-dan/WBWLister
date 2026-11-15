import { handle, HttpError } from '../../../lib/http';
import { clientIp } from '../../../lib/public-intake';
import { acceptTerms, admitIntakeLimit, getTermsByToken } from '../../../lib/public-intake-store';
import { isTermsToken, validateAcceptance } from '../../../lib/terms-acceptance';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const BAD = 'This link is not valid.';

// Public. The token is the only key. Returns only the acceptance date, never application details.
export async function termsAcceptResponse(req, db = { admit: admitIntakeLimit, get: getTermsByToken, accept: acceptTerms }) {
  const ip = clientIp(req);
  const gate = await db.admit(`terms:${ip}`, 30);
  if (!gate.ok) throw new HttpError('Please wait a bit and try again.', 429);
  if (req.method === 'GET') {
    const token = new URL(req.url).searchParams.get('token');
    const row = isTermsToken(token) ? await db.get(token) : null;
    if (!row) throw new HttpError(BAD, 404);
    return { accepted_at: row.accepted_at };
  }
  const body = await req.json().catch(() => ({}));
  if (!isTermsToken(body?.token)) throw new HttpError(BAD, 404);
  const v = validateAcceptance(body);
  const out = await db.accept(body.token, v, { ip, ua: String(req.headers.get('user-agent') || '').slice(0, 400) });
  if (!out) throw new HttpError(BAD, 404);
  return { accepted_at: out.accepted_at };
}

export const GET = handle(req => termsAcceptResponse(req));
export const POST = handle(req => termsAcceptResponse(req));

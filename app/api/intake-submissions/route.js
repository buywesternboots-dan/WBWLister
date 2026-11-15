import { actorFrom } from '../../../lib/access';
import { handle, HttpError } from '../../../lib/http';
import { clearIntakePassword, countPendingApplications, createIntakeInvite, listIntakeSubmissions, revealIntakePassword, reviewIntake, setTermsSent } from '../../../lib/public-intake-store';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Admin-only list, invite, reveal, and clear. Reveal is the only path that returns a password, and it is audited.
// Submissions land as pending applications. Approve/decline changes only the intake row; it does not create a seller.
export async function intakeSubmissionsResponse(req, db, env) {
  const who = await actorFrom(req, env);
  if (who.role !== 'admin') throw new HttpError('Only an admin can do that.', 403);
  const api = db ?? { list: listIntakeSubmissions, invite: createIntakeInvite, reveal: revealIntakePassword, clear: clearIntakePassword, pending: countPendingApplications, review: reviewIntake, sent: setTermsSent };
  if (req.method === 'GET') return new URL(req.url).searchParams.get('count') ? { pending: await api.pending() } : api.list();
  if (req.method !== 'POST') throw new HttpError('Unknown request.', 405);
  const body = await req.json().catch(() => ({}));
  const action = String(body?.action ?? '');
  if (action === 'invite') {
    const inv = await api.invite();
    const url = new URL('/intake', req.url);
    url.searchParams.set('code', inv.code);
    return { url: `${url.pathname}${url.search}`, expires: inv.expires };
  }
  const id = body?.id;
  if (action === 'reveal') return api.reveal(id, 'admin', env);
  if (action === 'clear') return api.clear(id, 'admin');
  if (action === 'terms-sent') return api.sent(id, body?.sent === true);
  if (action === 'review') {
    const decision = String(body?.decision ?? '');
    if (!['approved', 'declined'].includes(decision)) throw new HttpError('Decision must be approved or declined.', 400);
    return api.review(id, decision);
  }
  throw new HttpError('Unknown request.', 400);
}

const run = req => handle(r => intakeSubmissionsResponse(r))(req);
export const GET = run;
export const POST = run;

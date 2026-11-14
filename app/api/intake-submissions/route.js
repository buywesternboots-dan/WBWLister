import { actorFrom } from '../../../lib/access';
import { handle, HttpError } from '../../../lib/http';
import { approveIntake, clearIntakePassword, createIntakeInvite, listIntakeSubmissions, revealIntakePassword } from '../../../lib/public-intake-store';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Admin-only list, invite, reveal, clear, and approve. Reveal is the only path that returns a password, and it is audited.
export async function intakeSubmissionsResponse(req, db, env) {
  const who = await actorFrom(req, env);
  if (who.role !== 'admin') throw new HttpError('Only an admin can do that.', 403);
  const api = db ?? { list: listIntakeSubmissions, invite: createIntakeInvite, reveal: revealIntakePassword, clear: clearIntakePassword, approve: approveIntake };
  if (req.method === 'GET') return api.list();
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
  if (action === 'approve') return api.approve(id, 'admin');
  throw new HttpError('Unknown request.', 400);
}

const run = req => handle(r => intakeSubmissionsResponse(r))(req);
export const GET = run;
export const POST = run;

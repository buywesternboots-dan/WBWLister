import { actorFrom } from '../../../lib/access';
import { handle, HttpError } from '../../../lib/http';
import { clearIntakePassword, createSellerFromIntake, listIntakeSubmissions, revealIntakePassword } from '../../../lib/public-intake-store';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Admin-only list, reveal, clear, and create-seller. Reveal is the only path that returns a password, and it is audited.
// create-seller is for older rows saved before the sheet created the seller on submit. It is idempotent.
export async function intakeSubmissionsResponse(req, db, env) {
  const who = await actorFrom(req, env);
  if (who.role !== 'admin') throw new HttpError('Only an admin can do that.', 403);
  const api = db ?? { list: listIntakeSubmissions, reveal: revealIntakePassword, clear: clearIntakePassword, create: createSellerFromIntake };
  if (req.method === 'GET') return api.list();
  if (req.method !== 'POST') throw new HttpError('Unknown request.', 405);
  const body = await req.json().catch(() => ({}));
  const action = String(body?.action ?? '');
  const id = body?.id;
  if (action === 'reveal') return api.reveal(id, 'admin', env);
  if (action === 'clear') return api.clear(id, 'admin');
  if (action === 'create-seller') return api.create(id);
  throw new HttpError('Unknown request.', 400);
}

const run = req => handle(r => intakeSubmissionsResponse(r))(req);
export const GET = run;
export const POST = run;

import { actorFrom } from '../../../lib/access';
import { handle, HttpError } from '../../../lib/http';
import * as wbw from '../../../lib/wbw';

export const dynamic = 'force-dynamic';

// GET → sellers. A seller session receives only that seller. POST and DELETE are admin only.
export async function sellersApi(req, db, env) {
  const who = await actorFrom(req, env);
  if (req.method === 'GET') return db.getSellers(who.role === 'seller' ? who.seller : null);
  if (who.role !== 'admin') throw new HttpError('Only an admin can do that.', 403);
  if (req.method === 'POST') return db.saveSeller(await req.json());
  if (req.method === 'DELETE') return db.deleteSeller(new URL(req.url).searchParams.get('name')?.trim().toLowerCase());
  throw new HttpError('Unknown request.', 405);
}

const run = req => handle(r => sellersApi(r, wbw))(req);
export const GET = run;
export const POST = run;
export const DELETE = run;

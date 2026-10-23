import { actorFrom } from '../../../lib/access';
import { handle, HttpError } from '../../../lib/http';
import * as wbw from '../../../lib/wbw';

export const dynamic = 'force-dynamic';

const admin = async req => {
  const who = await actorFrom(req);
  if (who.role !== 'admin') throw new HttpError('Only an admin can do that.', 403);
};

// GET → sellers (a seller login sees only themselves). POST/DELETE are staff only.
export const GET = handle(async req => {
  const who = await actorFrom(req);
  return wbw.getSellers(who.role === 'seller' ? who.seller : null);
});
export const POST = handle(async req => { await admin(req); return wbw.saveSeller(await req.json()); });
export const DELETE = handle(async req => {
  await admin(req);
  return wbw.deleteSeller(new URL(req.url).searchParams.get('name')?.trim().toLowerCase());
});

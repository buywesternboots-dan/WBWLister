import { sellerContext } from '../../../lib/access';
import { handle, HttpError } from '../../../lib/http';
import * as wbw from '../../../lib/wbw';

export const dynamic = 'force-dynamic';

// POST → save this seller's intake answers. A seller can only update their own row. An admin uses Bearer.
export async function intakeApi(req, db, env) {
  const { seller } = await sellerContext(req, env);
  if (req.method === 'POST') return db.saveSellerIntake(seller, await req.json());
  throw new HttpError('Unknown request.', 405);
}

const run = req => handle(r => intakeApi(r, wbw))(req);
export const POST = run;

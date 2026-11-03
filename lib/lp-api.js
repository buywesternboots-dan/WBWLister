// List Perfectly upload. Seller scope comes from the signed session, the same way as the rest of the item API.
import { sellerContext } from './access';
import { HttpError } from './http';

const MAX_CHUNK = 3500000;

export async function lpApi(req, db, env) {
  const { seller } = await sellerContext(req, env);
  let body;
  try { body = await req.json(); } catch { throw new HttpError('Choose a List Perfectly CSV.'); }
  if (body?.done) {
    if (!Array.isArray(body.sourceIds)) throw new HttpError('Missing the list of listings.');
    return { removed: await db.finishLp(seller, body.sourceIds) };
  }
  if (typeof body?.csv !== 'string' || !body.csv.trim()) throw new HttpError('Choose a List Perfectly CSV.');
  if (body.csv.length > MAX_CHUNK) throw new HttpError('That piece of the file is too big.', 413);
  return db.importLp(seller, body.csv);
}

// One authenticated lookup. It does not create, update, or remove listings.
import { sellerContext } from './access';
import { HttpError } from './http';
import { KNOWN_CAP } from './known';

export async function knownApi(req, db, env) {
  const { seller } = await sellerContext(req, env);
  const body = await req.json().catch(() => ({}));
  const source = String(body?.source || '');
  if (source !== 'depop' && source !== 'facebook') throw new HttpError('That source cannot be checked.', 400);
  const candidates = Array.isArray(body?.candidates) ? body.candidates : [];
  if (candidates.length > KNOWN_CAP) throw new HttpError('That check is larger than the scan cap.', 400);
  if (typeof db.knownImports !== 'function') throw new HttpError('Known listings are not available.', 500);
  return db.knownImports(seller, source, candidates);
}

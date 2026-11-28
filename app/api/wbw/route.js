import { actorFrom } from '../../../lib/access';
import { handle, HttpError } from '../../../lib/http';
import { connectSeller, importListings, readHealth, readSellerStatus, redactSecret } from '../../../lib/wbw-api';
import * as wbw from '../../../lib/wbw';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const db = {
  getSeller: wbw.getSeller,
  assignExternalSellerId: wbw.assignExternalSellerId,
  saveSellerWbw: wbw.saveSellerWbw,
  getItemsByIds: wbw.getItemsByIds,
  saveItemWbw: wbw.saveItemWbw,
};

// Admin only. The browser sends a BootLister seller id, listing ids, and the publish choice.
// Email, display name, location, and both external ids are read from the database.
export async function wbwApi(req, database = db, env = process.env, deps = {}) {
  const who = await actorFrom(req, env);
  if (who.role !== 'admin') throw new HttpError('Only an admin can do that.', 403);
  const url = new URL(req.url);
  let payload = {};
  if (req.method === 'POST') {
    try { payload = await req.json(); }
    catch { throw new HttpError('Send JSON.', 400); }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new HttpError('Send JSON.', 400);
  } else if (req.method !== 'GET') throw new HttpError('Unknown request.', 405);
  const action = req.method === 'GET' ? url.searchParams.get('action') : payload.action;
  try {
    if (action === 'health' && req.method === 'GET') return await readHealth(env, deps);
    if (action === 'status' && req.method === 'GET') return await readSellerStatus(database, url.searchParams.get('seller'), env, deps);
    if (action === 'seller' && req.method === 'POST') return await connectSeller(database, payload, env, deps);
    if (action === 'import' && req.method === 'POST') return await importListings(database, payload, env, deps);
    throw new HttpError('Unknown request.', 400);
  } catch (e) {
    const message = redactSecret(e.message || 'Something went wrong.', env.WBW_API_KEY);
    if (message !== e.message) throw new HttpError(message, e.status || 400);
    throw e;
  }
}

const run = req => handle(r => wbwApi(r))(req);
export const GET = run;
export const POST = run;

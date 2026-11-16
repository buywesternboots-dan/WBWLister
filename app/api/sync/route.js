import { actorFrom, sellerContext } from '../../../lib/access';
import { handle, HttpError } from '../../../lib/http';
import { rescanSource } from '../../../lib/rescan';
import { deltaCounts, deltaCsv, syncDelta } from '../../../lib/sync';
import * as wbw from '../../../lib/wbw';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// GET → this seller's WBW sync view: primary source, last synced / scanned, and the delta rows (admin only).
// POST { action: 'applied', ids } → Dan applied those rows on WBW. POST { action: 'rescan' } → server-side re-scan.
const admin = async req => {
  const who = await actorFrom(req);
  if (who.role !== 'admin') throw new HttpError('Only an admin can do that.', 403);
  return (await sellerContext(req)).seller;
};
export const GET = handle(async req => {
  const seller = await admin(req);
  const { seller: s, items } = await wbw.getSyncData(seller);
  const delta = syncDelta(items, { primary: s.primary_source });
  if (new URL(req.url).searchParams.get('format') === 'csv') return { csv: deltaCsv(delta, { origin: new URL(req.url).origin, seller: s }) };
  return { seller: s.name, primary_source: s.primary_source, last_synced_at: s.last_synced_at, last_scan_at: s.last_scan_at,
    counts: deltaCounts(delta), delta: delta.map(({ item, ...r }) => ({ ...r, title: item.title, source: item.source, source_id: item.source_id })) };
});
export const POST = handle(async req => {
  const seller = await admin(req);
  const body = await req.json();
  if (body?.action === 'applied') {
    if (!Array.isArray(body.ids) || !body.ids.length) throw new HttpError('Pick the rows you applied on WBW.');
    return wbw.markWbwApplied(seller, body.ids);
  }
  if (body?.action === 'rescan') {
    const { seller: s } = await wbw.getSyncData(seller);
    return rescanSource(seller, s, wbw);
  }
  throw new HttpError('Unknown request.', 400);
});

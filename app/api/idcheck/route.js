import { actorFrom } from '../../../lib/access';
import { handle, HttpError } from '../../../lib/http';
import { idExport, scanItem } from '../../../lib/wbw';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const admin = async req => {
  const who = await actorFrom(req);
  if (who.role !== 'admin') throw new HttpError('Only an admin can do that.', 403);
};

// Staff only. POST { id } scans one item's photos for ID info; GET lists every item with ID-info photos.
export const POST = handle(async req => { await admin(req); return scanItem((await req.json()).id); });
export const GET = handle(async req => { await admin(req); return idExport(); });

import { actorFrom } from '../../../lib/access';
import { handle, HttpError } from '../../../lib/http';
import { backfillPhotos } from '../../../lib/wbw';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Staff only: POST repeatedly until { left: 0 } to copy every still-linked photo into WBW's Blob storage.
export const POST = handle(async req => {
  const who = await actorFrom(req);
  if (who.role !== 'admin') throw new HttpError('Only an admin can do that.', 403);
  return backfillPhotos();
});

import { actorFrom } from '../../../lib/access';
import { handle, HttpError } from '../../../lib/http';
import { backfillPhotos } from '../../../lib/wbw';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Admin only. POST until { left: 0 } copies source photo links (R2, else Blob). No-op when neither store is configured.
export const POST = handle(async req => {
  const who = await actorFrom(req);
  if (who.role !== 'admin') throw new HttpError('Only an admin can do that.', 403);
  return backfillPhotos();
});

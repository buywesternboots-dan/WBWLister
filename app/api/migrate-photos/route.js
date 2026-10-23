import { actorFrom } from '../../../lib/access';
import { guardAction, handle } from '../../../lib/http';
import { migrateBlobPhotos } from '../../../lib/wbw';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Admin only. Copies Vercel Blob photo URLs onto R2. POST by hand until { left: 0 }. Not called by the app.
export const POST = handle(async req => {
  const who = await actorFrom(req);
  guardAction(who, 'migrate');
  return migrateBlobPhotos();
});

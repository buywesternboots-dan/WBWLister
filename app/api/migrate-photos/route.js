import { handle, teamOnly } from '../../../lib/http';
import { migrateBlobPhotos } from '../../../lib/wbw';

// Team only. Copies Vercel Blob photo URLs onto R2 and rewrites items and photo_archive.
// POST by hand, repeatedly, until { left: 0 }. Not called by the app. No-op when R2 is unset.
export const POST = handle(req => { teamOnly(req); return migrateBlobPhotos(); });
export const maxDuration = 60;

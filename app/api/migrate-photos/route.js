import { handle, requireAdmin } from '../../../lib/http';
import { migrateBlobPhotos } from '../../../lib/wbw';

// Admin only, checked here (not only by the proxy). Copies Vercel Blob photo URLs onto R2.
// POST by hand, repeatedly, until { left: 0 }. Not called by the app. No-op when R2 is unset.
export const POST = handle(async req => { await requireAdmin(req); return migrateBlobPhotos(); });
export const maxDuration = 60;

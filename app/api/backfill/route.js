import { handle, teamOnly } from '../../../lib/http';
import { backfillPhotos } from '../../../lib/wbw';

// Team only: POST repeatedly until { left: 0 } to copy source photo links (R2, else Blob). No-op when neither store is configured.
export const POST = handle(req => { teamOnly(req); return backfillPhotos(); });
export const maxDuration = 60;

import { handle, teamOnly } from '../../../lib/http';
import { backfillPhotos } from '../../../lib/wbw';

// Team only: POST repeatedly until { left: 0 } to copy source photo links into R2. No-op when R2 is unset ({ configured: false }).
export const POST = handle(req => { teamOnly(req); return backfillPhotos(); });
export const maxDuration = 60;

import { guardAction, handle } from '../../../lib/http';
import { backfillPhotos } from '../../../lib/wbw';

// Team only: POST repeatedly until { left: 0 } to copy every still-linked photo into WBW's Blob storage.
export const POST = handle(req => { guardAction(req, 'backfill'); return backfillPhotos(); });
export const maxDuration = 60;

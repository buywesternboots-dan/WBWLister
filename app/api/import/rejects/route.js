import { handle } from '../../../../lib/http';
import { rejectApi } from '../../../../lib/known-api';
import { saveRejects } from '../../../../lib/wbw';
// sellerContext runs inside rejectApi before any write. This does not create listings.

export const dynamic = 'force-dynamic';

export const POST = handle(req => rejectApi(req, { saveRejects }));

import { handle, sellerOf } from '../../../lib/http';
import { markPosted } from '../../../lib/wbw';

export const POST = handle(async req => { const { id, channel } = await req.json(); return markPosted(sellerOf(req), id, channel); });

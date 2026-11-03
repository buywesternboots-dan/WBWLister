import { sellerContext } from '../../../lib/access';
import { handle, HttpError } from '../../../lib/http';
import { getItemsByIds, markPosted } from '../../../lib/wbw';

export const dynamic = 'force-dynamic';

export const POST = handle(async req => {
  const { seller } = await sellerContext(req);
  const { id, channel } = await req.json();
  const [row] = await getItemsByIds([id]);
  if (!row || row.seller !== seller) throw new HttpError('You can only change your own items.', 403);
  return markPosted(seller, id, channel);
});

import { sellerContext } from '../../../lib/access';
import { handle } from '../../../lib/http';
import { productList, readProduct, slug } from '../../../lib/sites';
import * as wbw from '../../../lib/wbw';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// GET ?site= → { source, urls, known, items? }: the store's listings, which ones this seller already has, and (feeds) their details.
export const GET = handle(async req => {
  const { seller } = await sellerContext(req);
  const { urls, items } = await productList(new URL(req.url).searchParams.get('site'));
  if (!urls.length) throw new Error('No listings for sale found at that link.');
  const source = items ? Object.values(items)[0].source : new URL(urls[0]).hostname.replace(/^www\./, '');
  const have = new Set(await wbw.getSourceIds(seller, source));
  return { source, urls, items, known: urls.filter(u => have.has(slug(u))) };
});

// POST { url, item? } → imports one listing — item if the feed already gave its details, else read from url
// (skipped if sold; ignored if already imported and unchanged). Always for the signed-in seller.
export const POST = handle(async req => {
  const { seller } = await sellerContext(req);
  const { url, item: given } = await req.json(), item = given ?? await readProduct(url);
  if (!item) return { sold: true };
  const row = await wbw.createItem(seller, item);
  return { item: row, duplicate: !row };
});

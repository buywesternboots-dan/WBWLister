import * as wbw from '../../../lib/wbw';
import { productUrls, readProduct, slug } from '../../../lib/sites';
import { handle, sellerOf } from '../../../lib/http';

export const maxDuration = 300;

// GET ?site= → { source, urls, known }: the store's product pages and which of them this seller already has.
export const GET = handle(async req => {
  const urls = await productUrls(new URL(req.url).searchParams.get('site'));
  const source = new URL(urls[0]).hostname.replace(/^www\./, '');
  const have = new Set(await wbw.getSourceIds(sellerOf(req), source));
  return { source, urls, known: urls.filter(u => have.has(slug(u))) };
});

// POST { url } → imports one product page (skipped if sold; ignored if already imported and unchanged).
export const POST = handle(async req => {
  const item = await readProduct((await req.json()).url);
  if (!item) return { sold: true };
  const row = await wbw.createItem(sellerOf(req), item);
  return { item: row, duplicate: !row };
});

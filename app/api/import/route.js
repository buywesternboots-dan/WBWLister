import * as wbw from '../../../lib/wbw';
import { productUrls, readProduct, slug } from '../../../lib/sites';

export const maxDuration = 300;
const seller = req => req.headers.get('authorization')?.replace('Bearer ', '').trim().toLowerCase() || 'demo'; // mock auth, case-insensitive
const handle = fn => async req => {
  try { return Response.json(await fn(req)); }
  catch (e) { return Response.json({ error: e.message }, { status: 400 }); }
};

// GET ?site= → { source, urls, known }: the store's product pages and which of them this seller already has.
export const GET = handle(async req => {
  const urls = await productUrls(new URL(req.url).searchParams.get('site'));
  const source = new URL(urls[0]).hostname.replace(/^www\./, '');
  const have = new Set(await wbw.getSourceIds(seller(req), source));
  return { source, urls, known: urls.filter(u => have.has(slug(u))) };
});

// POST { url, overwrite } → imports one product page (skipped if sold).
export const POST = handle(async req => {
  const { url, overwrite } = await req.json();
  const item = await readProduct(url);
  if (!item) return { sold: true };
  const row = await wbw.createItem(seller(req), { ...item, overwrite });
  return { item: row, duplicate: !row };
});

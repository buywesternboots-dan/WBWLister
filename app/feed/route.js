// Google Merchant Center product feed (tab-separated), fetched on a schedule: /feed?key=FEED_TOKEN.
// Env: FEED_TOKEN, WBW_ITEM_URL (listing page, {id} replaced), FEED_SHIP_PRICE / FEED_HANDLE_DAYS (defaults when a seller sets none).
// Returns: the account default policy is "not returnable"; a seller with a return window gets label returns-<days>d (create those policies in Merchant Center).
import { getFeedItems } from '../../lib/wbw';
import { altText, photoUrl } from '../../lib/seo';

const clean = v => String(v ?? '').replace(/[\t\r\n]+/g, ' ').trim();
const cols = (i, origin) => {
  const n = i.photos.length, title = [i.brand, i.sized_for && `${i.sized_for}'s`, i.color, i.material, i.title].filter(Boolean).join(' ');
  const handle = i.handle_days || process.env.FEED_HANDLE_DAYS || '3', ship = Number(i.ship_price ?? process.env.FEED_SHIP_PRICE ?? 0);
  return { id: i.id, title: title.slice(0, 150), description: i.description || altText(i, 1), link: (process.env.WBW_ITEM_URL ?? '').replace('{id}', i.id),
    image_link: photoUrl(origin, i, 1), additional_image_link: i.photos.slice(1, 10).map((_, k) => photoUrl(origin, i, k + 2)).join(','),
    price: `${Number(i.wbw_price ?? i.price).toFixed(2)} USD`, availability: 'in_stock', condition: i.condition === 'New' ? 'new' : 'used',
    brand: i.brand, gender: i.sized_for?.toLowerCase() === 'women' ? 'female' : 'male', age_group: 'adult', color: i.color, size: i.size, material: i.material,
    google_product_category: i.boot === 'belt' ? '169' : '187', product_type: i.boot === 'belt' ? 'Western belts' : 'Western boots',
    identifier_exists: 'no', shipping: `US:::${ship.toFixed(2)} USD`, min_handling_time: handle, max_handling_time: handle,
    return_policy_label: i.return_days ? `returns-${i.return_days}d` : '' };
};

export async function GET(req) {
  const url = new URL(req.url);
  if (!process.env.FEED_TOKEN || url.searchParams.get('key') !== process.env.FEED_TOKEN) return new Response('Not found', { status: 404 });
  const rows = (await getFeedItems()).filter(i => i.photos.length && i.title && i.brand && i.size && i.condition && (i.wbw_price ?? i.price)).map(i => cols(i, url.origin));
  const keys = Object.keys(rows[0] ?? cols({ photos: [] }, ''));
  return new Response([keys, ...rows.map(r => keys.map(k => clean(r[k])))].map(r => r.join('\t')).join('\n'), { headers: { 'Content-Type': 'text/tab-separated-values; charset=utf-8' } });
}

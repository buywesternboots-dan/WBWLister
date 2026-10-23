// Public photo URL with an SEO filename: serves the seller's photo unchanged (pixels), with XMP keywords/credit added and long cache.
import { getItem } from '../../../../../lib/wbw';
import { allowedPhotoUrl } from '../../../../../lib/net';
import { withXmp } from '../../../../../lib/seo';

export async function GET(req, { params }) {
  const { id, n } = await params;
  const item = /^\d+$/.test(id) ? await getItem(id) : null, src = item?.photos[n - 1];
  if (!src || !allowedPhotoUrl(src)) return new Response('Not found', { status: 404 });
  const r = await fetch(src, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!r.ok) return new Response('Not found', { status: 404 });
  return new Response(withXmp(Buffer.from(await r.arrayBuffer()), item, +n), {
    headers: { 'Content-Type': r.headers.get('content-type') || 'image/jpeg', 'Cache-Control': 'public, max-age=31536000, immutable' } });
}

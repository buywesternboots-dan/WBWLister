// Public photo URL with an SEO filename. Pixels stay as stored; XMP keywords/credit are added.
// Only our Blob store or R2 is treated as already copied. Anything else is fetched through safeFetch.
import { getItem } from '../../../../../lib/wbw';
import { allowedPhotoUrl, imageType, safeFetch } from '../../../../../lib/net';
import { withXmp } from '../../../../../lib/seo';

export async function GET(_req, { params }) {
  const { id, n } = await params;
  const item = /^\d+$/.test(id) ? await getItem(id) : null;
  const src = item?.photos?.[n - 1];
  if (!src) return new Response('Not found', { status: 404 });
  const stored = allowedPhotoUrl(src);
  let got, type;
  try {
    got = await safeFetch(src, { image: true });
    type = imageType(got.contentType);
  } catch { return new Response('Not found', { status: 404 }); }
  return new Response(withXmp(got.body, item, +n), {
    headers: {
      'Content-Type': type,
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Cache-Control': stored ? 'public, max-age=31536000, immutable' : 'public, max-age=3600',
    },
  });
}

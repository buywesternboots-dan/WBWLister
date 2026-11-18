import { getIntakePhoto } from '../../../../lib/public-intake-store';

export const dynamic = 'force-dynamic';

// Public profile photo stored in the database when Blob is not configured.
export async function GET(_req, { params }) {
  const { id } = await params;
  const photo = await getIntakePhoto(id);
  if (!photo) return new Response('Not found', { status: 404 });
  return new Response(photo.bytes, {
    headers: {
      'Content-Type': photo.type || 'image/jpeg',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
}

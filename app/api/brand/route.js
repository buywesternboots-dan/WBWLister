import { actorFrom } from '../../../lib/access';
import { brandInfo } from '../../../lib/brandinfo';
import { handle } from '../../../lib/http';

export const dynamic = 'force-dynamic';

// GET ?names=Lucchese,Tony Lama → { Lucchese: { link, text } | null, … }. Signed-in callers only.
export const GET = handle(async req => {
  await actorFrom(req);
  const names = [...new Set((new URL(req.url).searchParams.get('names') ?? '').split(',').map(s => s.trim()).filter(Boolean))].slice(0, 100);
  return Object.fromEntries(await Promise.all(names.map(async n => [n, await brandInfo(n)])));
});

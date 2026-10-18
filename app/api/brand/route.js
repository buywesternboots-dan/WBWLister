import { handle } from '../../../lib/http';
import { brandInfo } from '../../../lib/brandinfo';

// GET ?names=Lucchese,Tony Lama → { Lucchese: { link, text } | null, … }
export const GET = handle(async req => {
  const names = [...new Set((new URL(req.url).searchParams.get('names') ?? '').split(',').map(s => s.trim()).filter(Boolean))].slice(0, 100);
  return Object.fromEntries(await Promise.all(names.map(async n => [n, await brandInfo(n)])));
});

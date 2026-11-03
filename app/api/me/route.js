import { actorFrom } from '../../../lib/access';
import { handle } from '../../../lib/http';

export const dynamic = 'force-dynamic';

// GET → who's logged in: { role: 'admin' } or { role: 'seller', seller }.
export const GET = handle(async req => {
  const who = await actorFrom(req);
  return who.role === 'seller' ? { role: 'seller', seller: who.seller } : { role: 'admin' };
});

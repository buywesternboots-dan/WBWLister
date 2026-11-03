// Item API. Seller scope is decided here, before any read or write. db is lib/wbw in the route, a fake in tests.
import { sellerContext } from './access';
import { guardAction, HttpError } from './http';

async function ownOrThrow(db, seller, ids) {
  const rows = await db.getByIds(ids);
  const mine = new Set(rows.filter(r => r.seller === seller).map(r => String(r.id)));
  if (ids.some(id => !mine.has(String(id)))) throw new HttpError('You can only change your own items.', 403);
}

export async function itemsApi(req, db, env) {
  const { who, seller } = await sellerContext(req, env);
  const url = new URL(req.url);
  if (req.method === 'GET')
    return url.searchParams.get('source') ? db.getSourceIds(seller, url.searchParams.get('source')) : db.getItems(seller, url.searchParams.get('status') || 'review');
  if (req.method === 'POST') {
    const item = await db.createItem(seller, await req.json());
    return { item, duplicate: !item };
  }
  if (req.method !== 'PATCH') throw new HttpError('Unknown request.', 405);
  const { ids, action, percent, amount, ...fields } = await req.json();
  if (!ids?.length) throw new HttpError('Select at least one item.', 400);
  if (action === 'sync') return { removed: await db.syncSource(seller, fields.source, ids) };
  await ownOrThrow(db, seller, ids);
  guardAction(who, action);
  const role = who.role === 'admin' ? 'admin' : 'seller';
  switch (action) {
    case 'delete': return { deleted: await db.deleteItems(seller, ids) };
    case 'move': return { moved: await db.moveItems(seller, ids, fields.to) };
    case 'edit': await db.updateItems(seller, ids, fields, role); break;
    case 'price': await db.lowerPrice(seller, ids, percent, amount, role); break;
    case 'approve':
      if (role !== 'seller') throw new HttpError('The seller approves their own listings.', 403);
      return db.approveItems(seller, ids, fields);
    default: return { ok: true, ...(await db.setStatus(seller, ids, action, role) ?? {}) };
  }
  return { ok: true };
}

export const itemsResponse = (req, db, env) => itemsApi(req, db, env).then(
  body => Response.json(body),
  e => Response.json({ error: e.message || 'Something went wrong.' }, { status: e.status || 400 }));

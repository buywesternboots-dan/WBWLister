import * as wbw from '../../../lib/wbw';
import { guardAction, handle, sellerOf, sessionSeller } from '../../../lib/http';

// GET ?status= → the seller's items; GET ?source= → source ids they already have (start of an import).
export const GET = handle(req => {
  const q = new URL(req.url).searchParams;
  return q.get('source') ? wbw.getSourceIds(sellerOf(req), q.get('source')) : wbw.getItems(sellerOf(req), q.get('status') || 'review');
});

// POST item → import one listing (from the extension).
export const POST = handle(async req => {
  const item = await wbw.createItem(sellerOf(req), await req.json());
  return { item, duplicate: !item };
});

// PATCH { ids, action, … } → bulk actions.
export const PATCH = handle(async req => {
  const { ids, action, percent, amount, ...fields } = await req.json(), seller = sellerOf(req);
  if (!ids?.length) throw new Error('Select at least one item.');
  guardAction(req, action);
  switch (action) {
    case 'delete': return { deleted: await wbw.deleteItems(seller, ids) };
    case 'move': return { moved: await wbw.moveItems(seller, ids, fields.to) };
    case 'sync': return { removed: await wbw.syncSource(seller, fields.source, ids) };
    case 'edit': await wbw.updateItems(seller, ids, fields); break;
    case 'price': await wbw.lowerPrice(seller, ids, percent, amount); break;
    case 'approve':
      if (!sessionSeller(req)) throw new Error('The seller approves their own listings.');
      return { approved: await wbw.approveItems(seller, ids, fields) };
    default: await wbw.setStatus(seller, ids, action, sessionSeller(req) ? 'seller' : 'admin');
  }
  return { ok: true };
});

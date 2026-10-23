import { itemsResponse } from '../../../lib/items-api';
import * as wbw from '../../../lib/wbw';

export const dynamic = 'force-dynamic';

const db = {
  getItems: wbw.getItems,
  getSourceIds: wbw.getSourceIds,
  createItem: wbw.createItem,
  getByIds: wbw.getItemsByIds,
  deleteItems: wbw.deleteItems,
  moveItems: wbw.moveItems,
  syncSource: wbw.syncSource,
  updateItems: wbw.updateItems,
  lowerPrice: wbw.lowerPrice,
  approveItems: wbw.approveItems,
  setStatus: wbw.setStatus,
};

// GET ?status= → that seller's items. POST one listing. PATCH bulk actions.
// Seller scope is enforced in itemsApi from the signed session, not from the Bearer header alone.
export const GET = req => itemsResponse(req, db);
export const POST = req => itemsResponse(req, db);
export const PATCH = req => itemsResponse(req, db);

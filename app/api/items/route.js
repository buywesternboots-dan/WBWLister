import { itemsResponse } from '../../../lib/items-api';
import * as wbw from '../../../lib/wbw';

export const dynamic = 'force-dynamic';
// One-click AMCASO WBW reads and stores up to 30 full-size photos per pair.
export const maxDuration = 60;

const db = {
  getItems: wbw.getItems,
  getSourceIds: wbw.getSourceIds,
  createItem: wbw.createItem,
  claimImportWrite: wbw.claimImportWrite,
  unchangedImport: wbw.unchangedImport,
  getByIds: wbw.getItemsByIds,
  deleteItems: wbw.deleteItems,
  moveItems: wbw.moveItems,
  syncSource: wbw.syncSource,
  updateItems: wbw.updateItems,
  lowerPrice: wbw.lowerPrice,
  approveItems: wbw.approveItems,
  setStatus: wbw.setStatus,
  proposeOptimization: wbw.proposeOptimization,
  backfillOptimization: wbw.backfillOptimization,
  editOptimization: wbw.editOptimization,
  applyOptimization: wbw.applyOptimizationToItem,
  acceptStyleCandidate: wbw.acceptStyleCandidate,
  runAmcasowbw: wbw.runAmcasowbw,
  undoAmcasowbw: wbw.undoAmcasowbw,
  applyAmcasowbwResult: wbw.applyAmcasowbwResult,
  amcasoWbwOneClick: wbw.amcasoWbwOneClick,
};

// GET ?status= → that seller's items. POST one listing. PATCH bulk actions.
// Seller scope is enforced in itemsApi from the signed session, not from the Bearer header alone.
export const GET = req => itemsResponse(req, db);
export const POST = req => itemsResponse(req, db);
export const PATCH = req => itemsResponse(req, db);

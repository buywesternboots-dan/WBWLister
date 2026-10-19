import { handle, teamOnly } from '../../../lib/http';
import { scanItem, idExport } from '../../../lib/wbw';

export const maxDuration = 60;
// Team only. POST { id } scans one item's photos for ID info; GET lists every item with ID-info photos (knowledge base export).
export const POST = handle(async req => { teamOnly(req); return scanItem((await req.json()).id); });
export const GET = handle(req => { teamOnly(req); return idExport(); });

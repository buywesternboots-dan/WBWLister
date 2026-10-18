import * as wbw from '../../../lib/wbw';
import { handle, sessionSeller, teamOnly } from '../../../lib/http';

// GET → sellers (details + item counts; a seller's login sees only themselves).
// Team only: POST { name, display_name, …, rename_from?, login_password? } → create, update or rename; DELETE ?name= → remove one with no items.
export const GET = handle(req => wbw.getSellers(sessionSeller(req)));
export const POST = handle(async req => { teamOnly(req); return wbw.saveSeller(await req.json()); });
export const DELETE = handle(req => { teamOnly(req); return wbw.deleteSeller(new URL(req.url).searchParams.get('name')?.trim().toLowerCase()); });

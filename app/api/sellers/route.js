import * as wbw from '../../../lib/wbw';
import { handle } from '../../../lib/http';

// GET → every seller (details + item counts). POST { name, display_name, …, rename_from? } → create, update or rename.
// DELETE ?name= → remove a seller with no items.
export const GET = handle(() => wbw.getSellers());
export const POST = handle(async req => wbw.saveSeller(await req.json()));
export const DELETE = handle(req => wbw.deleteSeller(new URL(req.url).searchParams.get('name')?.trim().toLowerCase()));

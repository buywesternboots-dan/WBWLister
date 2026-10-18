import * as wbw from '../../../lib/wbw';

const handle = fn => async req => {
  try { return Response.json(await fn(req)); }
  catch (e) { return Response.json({ error: e.message }, { status: 400 }); }
};

// GET → every seller (details + item counts). POST { name, display_name, … } → create or update a seller's details.
export const GET = handle(() => wbw.getSellers());
export const POST = handle(async req => wbw.saveSeller(await req.json()));

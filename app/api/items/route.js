import * as wbw from '../../../lib/wbw';

const seller = req => req.headers.get('authorization')?.replace('Bearer ', '') || 'demo'; // mock auth
const handle = fn => async req => {
  try { return Response.json(await fn(req)); }
  catch (e) { return Response.json({ error: e.message }, { status: 400 }); }
};

export const GET = handle(req => wbw.getItems(seller(req), new URL(req.url).searchParams.get('status') || 'review'));

export const POST = handle(async req => {
  const item = await wbw.createItem(seller(req), await req.json());
  return { item, duplicate: !item };
});

export const PATCH = handle(async req => {
  const { ids, action, percent, amount, ...fields } = await req.json();
  if (!ids?.length) throw new Error('Select at least one item.');
  if (action === 'edit') await wbw.updateItems(seller(req), ids, fields);
  else if (action === 'price') await wbw.lowerPrice(seller(req), ids, percent, amount);
  else await wbw.setStatus(seller(req), ids, action);
  return { ok: true };
});

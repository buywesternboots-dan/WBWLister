import * as wbw from '../../../lib/wbw';

const seller = req => req.headers.get('authorization')?.replace('Bearer ', '').trim().toLowerCase() || 'demo'; // mock auth, case-insensitive
const handle = fn => async req => {
  try { return Response.json(await fn(req)); }
  catch (e) { return Response.json({ error: e.message }, { status: 400 }); }
};

export const GET = handle(req => {
  const q = new URL(req.url).searchParams;
  if (q.has('sellers')) return wbw.getSellers();
  return q.get('source') ? wbw.getSourceIds(seller(req), q.get('source')) : wbw.getItems(seller(req), q.get('status') || 'review');
});

export const POST = handle(async req => {
  const item = await wbw.createItem(seller(req), await req.json());
  return { item, duplicate: !item };
});

export const PATCH = handle(async req => {
  const { ids, action, percent, amount, ...fields } = await req.json();
  if (!ids?.length) throw new Error('Select at least one item.');
  if (action === 'move') return { moved: await wbw.moveItems(seller(req), ids, fields.to) };
  if (action === 'sync') return { removed: await wbw.syncSource(seller(req), fields.source, ids) };
  if (action === 'edit') await wbw.updateItems(seller(req), ids, fields);
  else if (action === 'price') await wbw.lowerPrice(seller(req), ids, percent, amount);
  else await wbw.setStatus(seller(req), ids, action);
  return { ok: true };
});

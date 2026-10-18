// Shared API route helpers. Errors come back as { error } with status 400.
export const handle = fn => async req => {
  try { return Response.json(await fn(req)); }
  catch (e) { return Response.json({ error: e.message }, { status: 400 }); }
};

// The selected seller (Authorization: Bearer <seller name>, case-insensitive). The tool itself is password-protected (proxy.js).
export const sellerOf = req => {
  const s = req.headers.get('authorization')?.replace('Bearer ', '').trim().toLowerCase();
  if (!s) throw new Error('Pick a seller first.');
  return s;
};

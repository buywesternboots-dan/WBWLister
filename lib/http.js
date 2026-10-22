// Shared API route helpers. Errors come back as { error } with status 400.
export const handle = fn => async req => {
  try { return Response.json(await fn(req)); }
  catch (e) { return Response.json({ error: e.message }, { status: 400 }); }
};

// Seller logins are locked to their own seller (set by proxy.js); an admin picks one (Authorization: Bearer <seller name>).
export const sessionSeller = req => req.headers.get('x-session-seller');
export const sellerOf = req => {
  const s = sessionSeller(req) ?? req.headers.get('authorization')?.replace('Bearer ', '').trim().toLowerCase();
  if (!s) throw new Error('Pick a seller first.');
  return s;
};
export const teamOnly = req => { if (sessionSeller(req)) throw new Error('Only an admin can do that.'); };

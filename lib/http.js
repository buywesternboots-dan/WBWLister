// Shared API route helpers. HttpError.status is the HTTP status; other errors are 400.
export class HttpError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
export const handle = fn => async req => {
  try { return Response.json(await fn(req)); }
  catch (e) { return Response.json({ error: e.message || 'Something went wrong.' }, { status: e.status || 400 }); }
};

// Actions a seller session cannot perform. Edit, import, export, and sync of their own items are not in this list.
export const ADMIN_ACTIONS = ['delete', 'move', 'sellers', 'idcheck', 'backfill', 'optimize-backfill',
  'amcasowbw', 'amcasowbw-apply', 'amcasowbw-undo', 'amcasowbw-oneclick', 'asmowbw', 'asmowbw-apply', 'asmowbw-undo'];

// AMCASO was called ASMO before Nov 17, 2026. The old action names stay accepted and map to the new ones.
const ACTION_ALIASES = { asmowbw: 'amcasowbw', 'asmowbw-apply': 'amcasowbw-apply', 'asmowbw-undo': 'amcasowbw-undo' };
export const canonicalAction = action => ACTION_ALIASES[action] ?? action;
export const guardAction = (who, action) => {
  if (ADMIN_ACTIONS.includes(action) && who?.role !== 'admin') throw new HttpError('Only an admin can do that.', 403);
};

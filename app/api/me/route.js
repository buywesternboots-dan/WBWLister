import { handle, sessionSeller } from '../../../lib/http';

// GET → who's logged in: { role: 'admin' } or { role: 'seller', seller }. Both use the same home screen.
export const GET = handle(req => sessionSeller(req) ? { role: 'seller', seller: sessionSeller(req) } : { role: 'admin' });

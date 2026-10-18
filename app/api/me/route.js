import { handle, sessionSeller } from '../../../lib/http';

// GET → who's logged in: { role: 'team' } or { role: 'seller', seller }.
export const GET = handle(req => sessionSeller(req) ? { role: 'seller', seller: sessionSeller(req) } : { role: 'team' });

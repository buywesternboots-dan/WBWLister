import { loginResponse } from '../../../lib/login-api';
import { authenticate } from '../../../lib/wbw';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// POST { email|phone|id, password } → staff (username "admin") or that seller. DELETE → log out.
const db = { authenticate };
export const POST = req => loginResponse(req, db);
export const DELETE = req => loginResponse(req, db);

import { loginResponse } from '../../../lib/login-api';
import { authenticate, failAttempt, readAttempts } from '../../../lib/wbw';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// POST { email|phone|id, password } → staff (username "admin") or that seller. DELETE → log out.
const db = { authenticate, attempts: { read: readAttempts, fail: failAttempt } };
export const POST = req => loginResponse(req, db);
export const DELETE = req => loginResponse(req, db);

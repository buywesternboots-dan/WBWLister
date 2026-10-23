import { registerResponse } from '../../../lib/login-api';
import { claimInviteAccount, registerAccount } from '../../../lib/wbw';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// POST { display_name, email?, phone?, password } → create that seller and sign them in.
export const POST = req => registerResponse(req, { register: registerAccount, claimInvite: claimInviteAccount });

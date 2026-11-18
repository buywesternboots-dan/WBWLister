import { handle } from '../../../../lib/http';
import { knownApi } from '../../../../lib/known-api';
import { knownImports } from '../../../../lib/wbw';
// sellerContext runs inside knownApi before any lookup. This route does not write.

export const dynamic = 'force-dynamic';

// Which of these candidate links this seller already has. Does not write or remove anything.
export const POST = handle(req => knownApi(req, { knownImports }));

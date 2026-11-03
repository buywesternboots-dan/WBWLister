import { sellerContext } from '../../../../lib/access';
import { handle } from '../../../../lib/http';
import { lpApi } from '../../../../lib/lp-api';
import { finishLp, importLp } from '../../../../lib/wbw';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// An admin uploads for the seller they picked; a seller session only for themselves (sellerContext).
export const POST = handle(async req => {
  await sellerContext(req);
  return lpApi(req, { importLp, finishLp });
});

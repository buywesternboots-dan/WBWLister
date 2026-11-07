import { sellerContext } from '../../../lib/access';
import { handle, HttpError } from '../../../lib/http';
import { addReference, listReferences } from '../../../lib/wbw';
import { assertReferencePost, REFERENCE_NOTE } from '../../../lib/references';

export const dynamic = 'force-dynamic';

// Seller-entered maker/model notes for the signed-in seller. Not a live maker library.
export const GET = handle(async req => {
  const { seller } = await sellerContext(req);
  return { references: await listReferences(seller), connected: false, note: REFERENCE_NOTE };
});

export const POST = handle(async req => {
  const { seller } = await sellerContext(req);
  const body = await req.json().catch(() => { throw new HttpError('That note could not be read.'); });
  const parsed = assertReferencePost(body);
  if (!parsed.rows.length) throw new HttpError(parsed.errors[0]?.error || 'No reference notes found.');
  const saved = [];
  for (const row of parsed.rows) saved.push(await addReference(seller, row));
  return { references: saved, errors: parsed.errors, connected: false, model_lookup: false, note: REFERENCE_NOTE };
});

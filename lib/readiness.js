// Exceptions are only facts the seller left off. A pending title or description
// rewrite is optional, so it does not keep a listing from being export-ready.
// Photo order stays the source order. No column is added to the CSV.

const MIN_PHOTOS = 1;
const text = v => String(v ?? '').trim();

export function exportReadiness(item) {
  const missing = [];
  if (!text(item?.brand)) missing.push('no brand');
  if (!text(item?.size)) missing.push('missing size');
  if (!text(item?.width)) missing.push('missing width');
  if (!text(item?.id_text)) missing.push('no style number');
  const price = item?.wbw_price ?? item?.price;
  if (price == null || text(price) === '') missing.push('no price');
  if ((item?.photos ?? []).length < MIN_PHOTOS) missing.push('too few photos');
  return { ready: missing.length === 0, missing };
}

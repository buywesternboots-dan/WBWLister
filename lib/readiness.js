// What still needs a person before this listing is as export-ready as the rules allow.
// Photo order is the source order. The first stored photo is the export cover. No column is added to the CSV.

const text = v => String(v ?? '').trim();
const appliedOf = item => item?.opt_applied && typeof item.opt_applied === 'object' ? item.opt_applied : {};
const proposalOf = item => item?.opt_proposal && typeof item.opt_proposal === 'object' ? item.opt_proposal : {};

export function exportReadiness(item) {
  const missing = [];
  const applied = appliedOf(item);
  const proposal = proposalOf(item);
  const photos = item?.photos ?? [];
  if (!photos.length) missing.push('no photos');
  else if (applied.media !== 'lens') missing.push('photo names not ready');
  if (applied.brand_exact === false || (applied.brand_exact == null && !text(item?.brand))) missing.push('no brand match');
  if (applied.style_status === 'ambiguous') missing.push('style matches more than one catalog card');
  else if (applied.style_status === 'none') missing.push('style not in the catalog');
  else if (applied.style_status === 'blank' || (applied.style_status == null && !text(item?.id_text))) missing.push('blank style number');
  if (!text(item?.size)) missing.push('missing size');
  if (!text(item?.width)) missing.push('missing width');
  if (applied.material_status === 'needs-human') missing.push('material needs a human');
  if (text(proposal.title) && proposal.title !== item?.title) missing.push('title rewrite pending Apply');
  if (text(proposal.description) && proposal.description !== item?.description) missing.push('description rewrite pending Apply');
  return { ready: missing.length === 0, missing };
}

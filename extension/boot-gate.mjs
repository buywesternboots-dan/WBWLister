// Cowboy/western boot check. The product slug is not read. Uncertain text is not eligible.

const NON_FOOTWEAR = /\b(briefcases?|totes?|handbags?|purses?|backpacks?|duffels?|duffles?|satchels?|clutch(?:es)?|wallets?|bags?|belts?|buckles?|hats?|caps|shirts?|t-?shirts?|jackets?|dresses?|jeans|skirts?|hoodies?|jewelry|necklaces?|earrings?|bracelets?|saddles?|spurs?|chaps|wallets?)\b/i;
const OTHER_FOOTWEAR = /\b(sneakers?|trainers?|sandals?|pumps?|loafers?|oxfords?|mules?|clogs?|slippers?|flip[\s-]?flops?|cleats?|espadrilles?|moccasins?|high[\s-]?heels?|stiletto heels?|shoes?)\b/i;
const SHOE_SIZE = /\bshoes?\s+size\b/i;
const BOOT_NOUN = /\b(boots?|booties|botas)\b/i;
const WESTERN = /\b(cow\s?boys?|cow\s?girls?|cowboys?|cowgirls?|western|westren|vaqueros?|buckaroos?|ropers?)\b/i;

function listingText(item) {
  return `${item?.title || ''}\n${item?.description || ''}\n${item?.category || ''}`
    .replace(/\bboot[\s-]?cuts?\b/gi, ' ');
}

export function westernBootDecision(item) {
  const text = listingText(item).replace(SHOE_SIZE, ' ');
  const boot = BOOT_NOUN.test(text);
  const western = WESTERN.test(text);
  if (NON_FOOTWEAR.test(text))
    return { eligible: false, kind: 'non-footwear', reason: 'The listing text names a bag or another non-boot item. The product slug was not used.' };
  if (OTHER_FOOTWEAR.test(text))
    return { eligible: false, kind: 'other-footwear', reason: 'The listing text names other footwear. The product slug was not used.' };
  if (boot && western)
    return { eligible: true, kind: 'western-boot', reason: 'The title or description says it is a cowboy or western boot. The product slug was not used.' };
  return { eligible: false, kind: 'uncertain', reason: 'The listing does not clearly say cowboy or western boot. Uncertain items are not imported. The product slug was not used.' };
}

export function bootScanSummary({ scanned = 0, candidates = 0, eligible = 0, unopened = 0, skipped = {}, writeCap = 100, partial = false } = {}) {
  const bags = skipped['non-footwear'] || 0;
  const shoes = skipped['other-footwear'] || 0;
  const unsure = skipped.uncertain || 0;
  const unread = skipped.unread || 0;
  const already = skipped.already || 0;
  const rest = unopened === 1 ? ' 1 candidate link was not opened.' : unopened ? ` ${unopened} candidate links were not opened.` : '';
  const coverage = partial || unopened ? 'Partial coverage.' : 'Every queued candidate was checked.';
  return `Scanned ${scanned} of ${candidates} candidate pages. Skipped ${bags} non-footwear, ${shoes} other footwear, ${unsure} uncertain, ${unread} unread, ${already} already imported. Eligible western boots: ${eligible}.${rest} Import limit ${writeCap}. ${coverage} This scan is not the whole shop. Sync will not remove listings.`;
}

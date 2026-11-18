// Cowboy/western boot check. The product slug is not read. The title (first line) wins over
// later description words. "heel caps" is a boot part, not a hat.

const NON_FOOTWEAR = /\b(briefcases?|totes?|handbags?|purses?|backpacks?|duffels?|duffles?|satchels?|clutch(?:es)?|wallets?|bags?|belts?|buckles?|hats?|(?<!heel )(?<!toe )caps?|shirts?|t-?shirts?|jackets?|dresses?|jeans|skirts?|hoodies?|jewelry|necklaces?|earrings?|bracelets?|saddles?|spurs?|chaps)\b/i;
const OTHER_FOOTWEAR = /\b(sneakers?|trainers?|sandals?|pumps?|loafers?|oxfords?|mules?|clogs?|slippers?|flip[\s-]?flops?|cleats?|espadrilles?|moccasins?|high[\s-]?heels?|stiletto heels?|shoes?)\b/i;
const SHOE_SIZE = /\bshoes?\s+size\b/i;
const BOOT_NOUN = /\b(boots?|booties|botas)\b/i;
// "boot" in front of the real item: boot belt, boot buckle, boot bag, boot jack, boot charm.
const BOOT_MODIFIER = /\bboots?[\s-]+(belts?|buckles?|bolos?|wallets?|bags?|totes?|purses?|handbags?|hats?|charms?|jacks?|scrapers?|trees|stretchers?|racks?|covers?|cuffs|chains?|straps?|socks|boxes)\b|\bboot(?:jacks?|bags?|charms?|buckles?|belts?|bolos?)\b/i;
const WESTERN = /\b(cow\s?boys?|cow\s?girls?|cowboys?|cowgirls?|western|westren|vaqueros?|buckaroos?|ropers?)\b/i;
// Known western boot makers. A title needs one of these, or a western word, plus a boot noun.
const MAKER = /\b(tony lama|dan post|lucchese|nocona|corral|ariat|tecovas|rocketbuster|old gringo|anderson bean|black jack|el dorado|twisted x|larry mahan|los altos|paul bond|charlie dunn|fenoglio|olathe|boulet|durango|laredo|abilene|stetson|sendra|cowtown|justin|frye|dingo|acme|hondo|hyer|cuadra|ferrini|kimmel|rios of mercedes|caborca|chisos)\b/i;

// Bump when the decision changes, so remembered non-boots are opened again.
export const GATE_VERSION = 1;

const clean = text => String(text || '').replace(/\bboot[\s-]?cuts?\b/gi, ' ').replace(SHOE_SIZE, ' ');
const titleOf = item => clean(item?.title);
const restOf = item => clean(`${item?.description || ''}\n${item?.category || ''}`);

function named(text) {
  const hit = text.match(NON_FOOTWEAR);
  return hit ? hit[0] : '';
}

export function westernBootDecision(item) {
  const title = titleOf(item);
  const rest = restOf(item);
  const titleBoot = BOOT_NOUN.test(title) && !BOOT_MODIFIER.test(title);
  const titleWestern = WESTERN.test(title) || MAKER.test(title);
  const titleBag = named(title);
  if (BOOT_MODIFIER.test(title)) {
    const hit = title.match(BOOT_MODIFIER)?.[0] || 'boot';
    return { eligible: false, kind: 'non-footwear', store: 'boot-modifier', reason: `The title uses "boot" for a non-boot item ("${hit}"). The product slug was not used.` };
  }
  if (titleBag && !titleBoot)
    return { eligible: false, kind: 'non-footwear', reason: `The title names a non-boot item ("${titleBag}"). The product slug was not used.` };
  if (OTHER_FOOTWEAR.test(title) && !titleBoot)
    return { eligible: false, kind: 'other-footwear', reason: 'The title names other footwear. The product slug was not used.' };
  // A clear boot title is not cancelled by bag, wallet, hashtag, or "heel caps" later in the description.
  if (titleBoot && titleWestern)
    return { eligible: true, kind: 'western-boot', reason: 'The title names a cowboy or western boot. Words later in the description were not used to reject it. The product slug was not used.' };
  const text = `${title}\n${rest}`;
  const bag = named(text);
  if (bag)
    return { eligible: false, kind: 'non-footwear', reason: `The listing names a non-boot item ("${bag}") and the title does not name a western boot. The product slug was not used.` };
  if (OTHER_FOOTWEAR.test(text))
    return { eligible: false, kind: 'other-footwear', reason: 'The listing text names other footwear. The product slug was not used.' };
  if (BOOT_NOUN.test(text) && (WESTERN.test(text) || MAKER.test(text)))
    return { eligible: true, kind: 'western-boot', reason: 'The description names a cowboy or western boot. The product slug was not used.' };
  return { eligible: false, kind: 'uncertain', reason: 'The listing does not clearly say cowboy or western boot. Uncertain items are not imported. The product slug was not used.' };
}

// Uncertain and unread results are not remembered. A boot-modifier title is stored on its own.
export function rejectToStore(decision) {
  if (!decision || decision.eligible) return '';
  const code = decision.store || decision.kind;
  if (code === 'non-footwear' || code === 'other-footwear' || code === 'boot-modifier') return code;
  return '';
}

export function bootScanSummary({ scanned = 0, candidates = 0, eligible = 0, unopened = 0, skipped = {}, writeCap = 100, partial = false, limitHit = false } = {}) {
  const bags = skipped['non-footwear'] || 0;
  const shoes = skipped['other-footwear'] || 0;
  const unsure = skipped.uncertain || 0;
  const unread = skipped.unread || 0;
  const already = skipped.already || 0;
  const prior = skipped.prior || 0;
  const known = already ? ` ${already} already imported (skipped).` : '';
  const remembered = prior ? ` ${prior} previously not boots (skipped).` : '';
  const rest = unopened === 1 ? ' 1 candidate link was not opened.' : unopened ? ` ${unopened} candidate links were not opened.` : '';
  const coverage = limitHit
    ? 'Shop scroll hit its read limit before the grid settled. This may not be the whole shop.'
    : partial || unopened
      ? 'Partial coverage. This scan is not the whole shop.'
      : 'Every queued candidate was checked. The visible shop grid had stopped growing.';
  return `Scanned ${scanned} of ${candidates} candidate pages.${known}${remembered} Skipped ${bags} non-footwear, ${shoes} other footwear, ${unsure} uncertain, ${unread} unread. Eligible western boots: ${eligible}.${rest} Import limit ${writeCap}. ${coverage} Sync will not remove listings.`;
}

// Seller intake packet: shop links, listing habits, brand context, and two consent checks.
// Name, location, contact, and shipping live on the WBW profile and are not asked again here.
import { packShopLinks, parseShopLinks, SHOP_CHANNELS } from './seller-links';

export const isOn = v => v === true || v === 'on' || v === 'yes' || v === 1 || v === '1';

export function intakeStatus(seller = {}) {
  const missing = [];
  const channels = parseShopLinks(seller);
  if (!SHOP_CHANNELS.some(k => channels[k])) missing.push('shop links');
  if (!isOn(seller.photo_ok)) missing.push('photo OK');
  if (!isOn(seller.import_ok)) missing.push('import OK');
  return { done: missing.length === 0, missing };
}

export const intakeLabel = status => (status?.done ? 'Intake: done' : `Intake: missing ${(status?.missing ?? []).join(', ')}`);

const onOff = v => (isOn(v) ? 'on' : 'off');

// Patch of intake columns only. Omitted fields are left out so a save cannot blank other seller settings.
export function intakePatch(row = {}, p = {}) {
  const hasLinks = SHOP_CHANNELS.some(k => p[k] !== undefined) || p.shop_links !== undefined;
  const patch = hasLinks ? packShopLinks({
    ...parseShopLinks(row),
    ...Object.fromEntries(SHOP_CHANNELS.filter(k => p[k] !== undefined).map(k => [k, p[k]])),
  }) : {};
  if (p.terms !== undefined) patch.terms = String(p.terms ?? '').trim() || null;
  if (p.defaults !== undefined) patch.defaults = String(p.defaults ?? '').trim() || null;
  if (p.brand_context !== undefined) patch.brand_context = p.brand_context === 'off' ? 'off' : 'on';
  if (p.photo_ok !== undefined) patch.photo_ok = onOff(p.photo_ok);
  if (p.import_ok !== undefined) patch.import_ok = onOff(p.import_ok);
  return patch;
}

export function applyIntake(row = {}, p = {}) {
  return { ...row, ...intakePatch(row, p) };
}

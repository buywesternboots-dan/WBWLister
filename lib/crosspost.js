// Copy-ready posts for other marketplaces, built from a WBW-formatted item. Every post links back to the WBW listing (env NEXT_PUBLIC_WBW_ITEM_URL, {id} replaced).
import { photoUrl } from './seo';

export const CHANNELS = { craigslist: 'Craigslist', fbgroup: 'Facebook group', reddit: 'Reddit' };
const SPECS = [['Brand', 'brand'], ['Sized for', 'sized_for'], ['Size', 'size'], ['Width', 'width'], ['Material', 'material'], ['Cut', 'material_cut'], ['Color', 'color'], ['Made in', 'made_in'], ['Condition', 'condition'], ['Keywords', 'keywords'], ['Sole length', 'sole_length'], ['Sole width', 'sole_width'], ['Heel height', 'heel_height'], ['Shaft circumference', 'shaft_circ'], ['Shaft height', 'shaft_height'], ['Heel', 'heel'], ['Toe', 'toe'], ['Sole', 'sole']];

export function post(channel, i, origin, seller) {
  const price = `$${Number(i.wbw_price ?? i.price ?? 0).toFixed(0)}`, link = (process.env.NEXT_PUBLIC_WBW_ITEM_URL ?? '').replace('{id}', i.id);
  const name = [i.brand, i.sized_for && `${i.sized_for}'s`, i.material, i.boot === 'belt' ? 'belt' : 'cowboy boots', i.size && `size ${i.size}${i.width ?? ''}`].filter(Boolean).join(' ');
  const body = [price, SPECS.filter(([, k]) => i[k]).map(([l, k]) => `${l}: ${i[k]}`).join('\n'), i.description, i.id_text && `Model / date codes: ${i.id_text}`,
    seller?.display_name && `Sold by ${seller.display_name}${seller.location ? ` (${seller.location})` : ''}`, link && `More photos and details: ${link}`].filter(Boolean).join('\n\n');
  const title = { craigslist: name.slice(0, 70), fbgroup: `${name} - ${price}`, reddit: `[WTS] ${name} - ${price}` }[channel];
  return { title, body, photos: i.photos.slice(0, channel === 'craigslist' ? 24 : 20).map((_, n) => photoUrl(origin, i, n + 1)) };
}

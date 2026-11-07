// Sell-a-pair CSV. Column names and order are the WBW import contract. Do not add columns.
import { csvCell } from './csv';
import { altText, photoUrl } from './seo';
import { displayWidth } from './vocab';

export const CSV = {
  photos: 'Photos', title: 'Listing title', wbw_price: 'Asking price', brand: 'Brand', sized_for: 'Sized for', size: 'Size',
  size_estimated: 'Size estimated', condition: 'Condition', width: 'Width', material_type: 'Material type', material: 'Material / hide',
  material_cut: 'Material specifics (cut)', made_in: 'Where made', color: 'Color', keywords: 'Keywords', sole_length: 'Sole length',
  sole_width: 'Sole width', heel_height: 'Heel height', shaft_circ: 'Shaft circumference', shaft_height: 'Shaft height', sole: 'Sole',
  heel: 'Heel', toe: 'Toe', description: 'Description', seller: 'WBW Seller Name', price: 'Source price', id_text: 'Model / date codes',
  category: 'Category', website_url: 'Seller Website Link', alts: 'Image Alt Text', brand_context: 'Brand Context', brand_link: 'Brand Page Link',
  seller_context: 'Seller Context', source_id: 'Source ID',
};

const SIZED = { Men: "Men's", Women: "Women's", Kids: 'Kids' };
const GROUP = { boot: 'Boots', belt: 'Belts' };
const MARKET = new Set(['facebook', 'depop', 'poshmark', 'ebay']);

// Approved names only when each current photo is still the same stored URL at the same position.
// A reorder, add, or removal falls back to names built from the current photos.
function appliedNames(item) {
  const images = item.opt_applied?.images;
  const photos = item.photos ?? [];
  if (!images?.length || images.length !== photos.length) return null;
  for (let i = 0; i < photos.length; i++) {
    if (images[i]?.stored_url !== photos[i] || images[i].n !== i + 1) return null;
  }
  return images;
}

// Live title and description only. An unapplied proposal is ignored. Width is the display form (AAA → A, N stays N).
export function exportRecord(item, { origin = '', seller = {}, brands = {} } = {}) {
  const names = appliedNames(item);
  const photos = names
    ? names.map(im => `${origin}/img/${item.id}/${im.n}/${im.file}`)
    : (item.photos ?? []).map((_, n) => photoUrl(origin, item, n + 1));
  const alts = names ? names.map(im => im.alt) : (item.photos ?? []).map((_, n) => altText(item, n + 1));
  const brand = brands[item.brand];
  return {
    photos, title: item.title, wbw_price: item.wbw_price ?? item.price, brand: item.brand,
    sized_for: SIZED[item.sized_for] ?? item.sized_for, size: item.size,
    size_estimated: item.size_estimated || (/^estimated$/i.test(String(item.size ?? '')) ? 'Yes' : ''),
    condition: item.condition, width: displayWidth(item.width), material_type: item.material_type, material: item.material,
    material_cut: item.material_cut, made_in: item.made_in, color: item.color, keywords: item.keywords,
    sole_length: item.sole_length, sole_width: item.sole_width, heel_height: item.heel_height, shaft_circ: item.shaft_circ,
    shaft_height: item.shaft_height, sole: item.sole, heel: item.heel, toe: item.toe, description: item.description,
    seller: item.seller, price: item.price, id_text: item.id_text, category: GROUP[item.boot] ?? '',
    website_url: MARKET.has(item.source) ? '' : item.source_url, alts,
    brand_context: brand ? `${brand.text} ${[item.material, item.size && `size ${item.size}`].filter(Boolean).join(', ')}.` : '',
    brand_link: brand?.link ?? '',
    seller_context: seller.display_name ? `Sold by ${seller.display_name}${seller.location ? ` of ${seller.location}` : ''}.` : '',
    source_id: item.source_id,
  };
}

export function toCsv(rows, ctx) {
  const keys = Object.keys(CSV);
  return [Object.values(CSV), ...rows.map(r => keys.map(k => exportRecord(r, ctx)[k]))].map(line => line.map(csvCell).join(',')).join('\r\n');
}

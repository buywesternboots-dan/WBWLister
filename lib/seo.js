// SEO for photos: descriptive filenames, alt text, and embedded XMP metadata. The pixels are never touched.
// Names use the same factual fields as the listing draft. The URL name is not how the photo is found.
// Angles are not guessed. A photo we have not seen is "photo N of M", never "side" or "sole".
import { photoBits, possessive } from './facts';
import { colorPhrase, imageValues, listingModel } from './model';
import { withMergedXmp } from './photo-meta';

const slug = s => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').split('-').filter(Boolean);

function genderToken(who) {
  const s = String(who ?? '').toLowerCase();
  if (s.startsWith('women')) return 'womens';
  if (s.startsWith('men')) return 'mens';
  if (s.startsWith('kid')) return 'kids';
  return '';
}

function sizeToken(size, width) {
  const sz = String(size ?? '').toLowerCase().replace(/\./g, '-').replace(/[^a-z0-9-]+/g, '').replace(/^-|-$/g, '');
  const w = String(width ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  if (!sz && !w) return '';
  return `${sz}${w}`;
}

function fileTokens(item) {
  const values = imageValues(item);
  const model = listingModel(item);
  const size = sizeToken(values.size, values.width);
  const seq = [
    ...slug(values.brand_phrase || values.brand), genderToken(values.sized_for), ...slug(model),
    ...slug(colorPhrase(values.color).replace(/,/g, ' ')), ...slug(values.material), ...slug(values.noun), size,
  ];
  const seen = new Set();
  const tokens = [];
  for (const t of seq) {
    if (!t || seen.has(t)) continue;
    seen.add(t);
    tokens.push(t);
  }
  return { tokens, pinned: new Set([...slug(model), size].filter(Boolean)) };
}

function pack(tokens, pinned, max) {
  const list = [...tokens];
  const length = () => list.join('-').length;
  while (length() > max && list.some(t => !pinned.has(t))) {
    let drop = -1;
    for (let i = list.length - 1; i >= 0; i--) if (!pinned.has(list[i])) { drop = i; break; }
    if (drop < 0) break;
    list.splice(drop, 1);
  }
  let name = list.join('-');
  if (name.length > max) name = name.slice(0, max).replace(/-+$/, '').replace(/-[^-]*$/, '');
  return name;
}

export function altBits(item) {
  const values = imageValues(item);
  const who = values.sized_for ? possessive(values.sized_for) : '';
  return [values.brand, who, listingModel(item), colorPhrase(values.color), values.material, values.noun,
    values.size && `size ${values.size}`, values.width && `${values.width} width`].filter(Boolean);
}

export const altText = (item, n, total) => {
  const base = altBits(item).join(' ').replace(/\s+/g, ' ').trim() || 'listing photo';
  const count = Number(total || item?.photos?.length || 0);
  const num = Number(n) || 1;
  if (count > 1) return `${base} - photo ${num} of ${count}`;
  if (num > 1) return `${base} - photo ${num}`;
  return base;
};

// brand, gender, model, color, material, cowboy-boots, size, index. No angle word. At most 80 characters before .jpg.
export const fileName = (item, n) => {
  const index = String(Math.max(1, Number(n) || 1));
  const { tokens, pinned } = fileTokens(item);
  const tail = `-${index}`;
  const stem = pack(tokens, pinned, 80 - tail.length);
  return `${stem ? `${stem}${tail}` : index}.jpg`;
};

export function seoTitle(item, values) {
  const v = values ?? imageValues(item);
  const who = v.sized_for ? possessive(v.sized_for) : '';
  return [v.brand, who, listingModel(item), colorPhrase(v.color), v.material, v.noun,
    v.size && `size ${v.size}`, v.width && `${v.width} width`].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
}
export const photoUrl = (origin, i, n) => `${origin}/img/${i.id}/${n}/${fileName(i, n)}`;

// Merge title/description/keywords/credit into the file. Existing amcasoWBW XMP/IPTC wins; never add a second packet, never re-encode.
export function withXmp(buf, i, n) {
  const alt = altText(i, n);
  return withMergedXmp(buf, {
    title: alt,
    description: alt,
    keywords: [...new Set([...photoBits(i), ...altBits(i)])],
    credit: `${i.seller} via westernbootworld.com`,
    copyright: 'westernbootworld.com',
  });
}

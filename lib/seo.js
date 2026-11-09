// SEO for photos: descriptive filenames, alt text, and embedded XMP metadata. The pixels are never touched.
// Names use the same factual fields as the listing draft. The URL name is not how the photo is found.
// Angles are not guessed. A photo we have not seen is "photo N of M", never "side" or "sole".
import { listingFacts, photoBits, possessive } from './facts';
import { colorPhrase, listingModel } from './model';

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
  const { values } = listingFacts(item);
  const model = listingModel(item);
  const size = sizeToken(values.size, values.width);
  const seq = [
    ...slug(values.brand), genderToken(values.sized_for), ...slug(model),
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
  const { values } = listingFacts(item);
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
  const v = values ?? listingFacts(item).values;
  const who = v.sized_for ? possessive(v.sized_for) : '';
  return [v.brand, who, listingModel(item), colorPhrase(v.color), v.material, v.noun,
    v.size && `size ${v.size}`, v.width && `${v.width} width`].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
}
export const photoUrl = (origin, i, n) => `${origin}/img/${i.id}/${n}/${fileName(i, n)}`;

const esc = s => String(s).replace(/[<>&"]/g, c => `&#${c.charCodeAt(0)};`);
// JPEG: insert an XMP block (title, description, keywords, credit, copyright) after the first segment; everything else is copied byte for byte.
export function withXmp(buf, i, n) {
  if (buf[0] !== 0xff || buf[1] !== 0xd8) return buf;
  const alt = esc(altText(i, n)), kw = [...new Set([...photoBits(i), ...altBits(i)])].map(k => `<rdf:li>${esc(k)}</rdf:li>`).join('');
  const xmp = Buffer.from(`http://ns.adobe.com/xap/1.0/\0<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:photoshop="http://ns.adobe.com/photoshop/1.0/">`
    + `<dc:title><rdf:Alt><rdf:li xml:lang="x-default">${alt}</rdf:li></rdf:Alt></dc:title><dc:description><rdf:Alt><rdf:li xml:lang="x-default">${alt}</rdf:li></rdf:Alt></dc:description>`
    + `<dc:subject><rdf:Bag>${kw}</rdf:Bag></dc:subject><dc:rights><rdf:Alt><rdf:li xml:lang="x-default">westernbootworld.com</rdf:li></rdf:Alt></dc:rights><photoshop:Credit>${esc(i.seller)} via westernbootworld.com</photoshop:Credit></rdf:Description></rdf:RDF></x:xmpmeta>`);
  const head = Buffer.alloc(4); head.writeUInt16BE(0xffe1); head.writeUInt16BE(xmp.length + 2, 2);
  let at = 2; // after SOI, and after a leading JFIF (APP0) segment, which must stay first
  if (buf[2] === 0xff && buf[3] === 0xe0) at = 4 + buf.readUInt16BE(4);
  return Buffer.concat([buf.subarray(0, at), head, xmp, buf.subarray(at)]);
}

// SEO for photos: descriptive filenames, alt text, and embedded XMP metadata. The pixels are never touched.
const text = i => [i.brand, i.sized_for && `${i.sized_for}'s`, i.color, i.material, i.boot === 'belt' ? 'belt' : 'cowboy boots', i.size && `size ${i.size}`, i.width && `${i.width} width`].filter(Boolean);
export const altText = (i, n) => text(i).join(' ') + (n > 1 ? ` - view ${n}` : '');
export const fileName = (i, n) => `${text(i).join(' ').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80)}-${n}.jpg`;
export const photoUrl = (origin, i, n) => `${origin}/img/${i.id}/${n}/${fileName(i, n)}`;

const esc = s => String(s).replace(/[<>&"]/g, c => `&#${c.charCodeAt(0)};`);
// JPEG: insert an XMP block (title, description, keywords, credit, copyright) after the first segment; everything else is copied byte for byte.
export function withXmp(buf, i, n) {
  if (buf[0] !== 0xff || buf[1] !== 0xd8) return buf;
  const alt = esc(altText(i, n)), kw = text(i).map(k => `<rdf:li>${esc(k)}</rdf:li>`).join('');
  const xmp = Buffer.from(`http://ns.adobe.com/xap/1.0/\0<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:photoshop="http://ns.adobe.com/photoshop/1.0/">`
    + `<dc:title><rdf:Alt><rdf:li xml:lang="x-default">${alt}</rdf:li></rdf:Alt></dc:title><dc:description><rdf:Alt><rdf:li xml:lang="x-default">${alt}</rdf:li></rdf:Alt></dc:description>`
    + `<dc:subject><rdf:Bag>${kw}</rdf:Bag></dc:subject><dc:rights><rdf:Alt><rdf:li xml:lang="x-default">westernbootworld.com</rdf:li></rdf:Alt></dc:rights><photoshop:Credit>${esc(i.seller)} via westernbootworld.com</photoshop:Credit></rdf:Description></rdf:RDF></x:xmpmeta>`);
  const head = Buffer.alloc(4); head.writeUInt16BE(0xffe1); head.writeUInt16BE(xmp.length + 2, 2);
  let at = 2; // after SOI, and after a leading JFIF (APP0) segment, which must stay first
  if (buf[2] === 0xff && buf[3] === 0xe0) at = 4 + buf.readUInt16BE(4);
  return Buffer.concat([buf.subarray(0, at), head, xmp, buf.subarray(at)]);
}

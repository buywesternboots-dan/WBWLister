// Directory facts only, rearranged. No network and no new claims.
import { brandName } from './vocab';
import { makerKey } from './wbw-ref';

const NO_PLACE = /^location not documented$/i;
const OPENERS = ['About the maker', 'About this maker', 'Maker directory'];
const PLACE = [
  (n, p) => `The directory lists ${n} in ${p}.`,
  (n, p) => `${n} is listed in ${p}.`,
  (n, p) => `Directory location for ${n}: ${p}.`,
  (n, p) => `${p} is the location listed for ${n}.`,
];
const BLURB = [
  (n, b) => `The directory says: ${b}.`,
  (n, b) => `Directory listing for ${n}: ${b}.`,
  (n, b) => `Listed there as: ${b}.`,
];
const LINK = [
  (n, u) => `Maker page: ${u}.`,
  (n, u) => `Directory page for ${n}: ${u}.`,
];

function hash(seed) {
  let h = 2166136261;
  const s = String(seed ?? '');
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

function directoryRow(name, makers) {
  const key = makerKey(name);
  if (!key) return null;
  const hits = (makers ?? []).filter(m => makerKey(m.name) === key);
  return hits.length === 1 ? hits[0] : null;
}

export function exactMaker(brand, makers) {
  const raw = String(brand ?? '').trim();
  if (!raw || !makers?.length) return null;
  const direct = directoryRow(raw, makers);
  if (direct) return direct;
  const named = brandName(raw);
  if (!named || named === raw) return null;
  // A longer name that merely contains an alias is not that maker.
  if (makerKey(raw).startsWith(`${makerKey(named)} `)) return null;
  return directoryRow(named, makers);
}

export function makerSnippet(maker, seed) {
  if (!maker?.name) return '';
  const name = String(maker.name).trim();
  const place = String(maker.location ?? '').trim();
  const where = place && !NO_PLACE.test(place) ? place : '';
  const blurb = String(maker.search_blurb ?? '').trim();
  const url = String(maker.url ?? '').trim();
  const pick = (salt, n) => hash(`${seed}|${salt}`) % n;
  const lines = [];
  if (where) lines.push(PLACE[pick('place', PLACE.length)](name, where));
  if (blurb) lines.push(BLURB[pick('blurb', BLURB.length)](name, blurb));
  if (url) lines.push(LINK[pick('link', LINK.length)](name, url));
  if (!lines.length) lines.push(`${name} is listed in the maker directory.`);
  const ordered = pick('order', 2) ? [...lines].reverse() : lines;
  const drop = ordered.length > 1 ? pick('drop', ordered.length + 1) : ordered.length;
  const keep = drop < ordered.length ? ordered.filter((_, i) => i !== drop) : ordered;
  return `${OPENERS[pick('open', OPENERS.length)]}\n${keep.slice(0, 3).join(' ')}`;
}

export function appendMakerNote(original, note) {
  const base = String(original ?? '');
  const extra = String(note ?? '').trim();
  if (!extra) return base;
  return base ? `${base}\n\n${extra}` : extra;
}

export function withoutMakerNote(description, original, note) {
  const text = String(description ?? '');
  if (!note) return text;
  return text === appendMakerNote(original, note) ? String(original ?? '') : text;
}

export function replaceMakerNote(description, original, previous, next) {
  const text = String(description ?? '');
  const base = String(original ?? '');
  if (text !== base && text !== appendMakerNote(base, previous)) return text;
  return appendMakerNote(base, next);
}

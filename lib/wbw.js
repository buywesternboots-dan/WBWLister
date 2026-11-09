// Mock WBW backend. Replace this file only when connecting to the real WBW.
import { neon } from '@neondatabase/serverless';
import { put } from '@vercel/blob';
import { createHash } from 'crypto';
import { brandName, findBrand, findMaterial } from './vocab';
import { applyPassword, claimWithInvite, inviteHash, isEmail, loginId, matchSeller, MIN_PASSWORD, newInvite, normEmail, normPhone, registerSeller } from './auth';
import { hashPassword } from './passwords';
import { bump } from './login-limit';
import { allowedPhotoUrl, resolvePublic } from './net';
import { listingFacts } from './facts';
import { appendMakerNote, exactMaker, makerSnippet, replaceMakerNote, withoutMakerNote } from './maker-note';
import { applyAutoOptimization, applyOptimization, assertFresh, editProposal, importOriginal, optimize, sourceRefreshPlan } from './optimize';
import { assertCanPublish, blocksApproval, clearedApproval, liveRecord, pushStub, reviewAfterApply } from './publish';
import { referenceFromFields, referenceKey } from './references';
import { acceptedStyleRef, bundledStyleSample, matchStyleSample } from './style-sample';
import { bundledDirectory } from './wbw-ref';
import { clampImportLimit, nextImportCount } from './import-cap';
import { candidateId, KNOWN_CAP, matchKnown, normalizeUrl } from './known';
import { scanPhotos } from './idcheck';
import { ensureBugTables, useBugSql } from './bug-store';

let db;
const conn = () => db ??= neon(process.env.DATABASE_URL);
const sql = (...a) => conn()(...a);
// Local Postgres smoke tests inject a wire-protocol client. Production keeps the Neon driver.
export function useSql(client) {
  db = client;
  ready = null;
  useBugSql(client);
}
// Statuses: review (Newly imported) → published (Exported) ; pending (gone from the source) → sold (seller confirms, or after
// 30 days) ; removed (seller pulled it) → archived (after 30 days). status_at = when the status last changed.
const STATUS = { publish: 'published', remove: 'removed', restore: 'review', sold: 'sold' };
const CLOSED = ['removed', 'archived', 'sold'];
const MAX_PHOTOS = 30;

// Listing fields (all editable). Text unless listed in NUMERIC.
export const FIELDS = ['title', 'price', 'wbw_price', 'brand', 'sized_for', 'size', 'size_estimated', 'width', 'material_type', 'material', 'material_cut', 'made_in',
  'condition', 'color', 'keywords', 'sole_length', 'sole_width', 'heel_height', 'shaft_circ', 'shaft_height', 'sole', 'heel', 'toe', 'description', 'id_text'];
const NUMERIC = ['price', 'wbw_price'];
const NEW_COLS = FIELDS.filter(f => !['title', 'price', 'brand', 'size', 'condition', 'description'].includes(f));

// Category (stored in the boot column) + boot_score (0–1, how likely it is a boot). Boots/Belts only when near certain
// (≥ 0.97); anything with no boot/western signal is Other; everything in between is Unsure, sorted by score.
const WESTERN = /\b(cow[\s-]?(boy|girl|by|boi|bow)z?s?|w[ae]st[ae]rn|westren|vaquer[oa]s?|buckaroo|ropers?)\b/i;
const BOOT_WORD = /\b(boots?|bootz|botts?|botas?|booties)\b/i;
const BOOT_PHRASE = /\b(exotic|custom|hand[- ]?made|texas|pre[- ]?ban|vintage)\s+(cowboy\s+|western\s+)?boots?\b/i;
const WIDTH = '(?:quad(?:ruple)?|triple|double)\\s*A|[2-4]A|AAAA|AAA|AA|[2-4]E|EEEE|EEE|EE|[A-FMW]';
const SIZE_WIDTH = new RegExp(`\\b\\d{1,2}(\\.5)?\\s?-?\\s?(?:${WIDTH})\\b`, 'i');
const BELT = /\b(belts?|buckles?)\b/i;
// Title words that mean the item is about boots but isn't a pair of boots (bedding, art, clothing, accessories…).
const NOT_BOOT = /\b(sheets?|bedding|comforter|blankets?|quilts?|pillows?|pillowcases?|curtains?|towels?|rugs?|posters?|photos?|photograph|autograph(ed)?|paintings?|canvas|figurines?|statues?|ornaments?|toys?|dolls?|lamps?|mugs?|planters?|vases?|decor|signs?|stickers?|decals?|books?|dvds?|vhs|t-?shirts?|tees?|hoodies?|jackets?|vests?|hats?|jeans|skirts?|jewelry|necklaces?|earrings?|bracelets?|keychains?|wallets?|purses?|handbags?|costumes?|cake toppers?|cookie cutters?|fabric|magnets?|patches|spurs|saddles?|chaps|boot ?(jacks?|polish|cream|conditioner|oil|dryers?|trays?|racks?|scrapers?|stretchers?|trees|bags?|covers?|cuffs|charms?|chains?|straps?|harness(es)?|socks|box(es)?))\b/i;
export function classify(it) {
  const title = it.title ?? '', text = `${title}\n${it.description ?? ''}\n${it.category ?? ''}`; // category: source's own tags (Depop)
  if (BELT.test(`${title} ${it.category ?? ''}`) && !BOOT_WORD.test(title)) return { boot: 'belt', boot_score: 0 };
  const word = BOOT_WORD.test(text), sized = SIZE_WIDTH.test(title), brand = !!findBrand(text), exotic = !!findMaterial(text)?.exotic;
  const bootish = word || sized || brand || exotic, western = WESTERN.test(text);
  const score = NOT_BOOT.test(title) ? (bootish || western ? 0.2 : 0)
    : western && bootish ? 0.99
    : BOOT_PHRASE.test(text) ? 0.95
    : word && (brand || exotic || sized) ? 0.93
    : brand && (exotic || sized) ? 0.9
    : word ? 0.7
    : bootish || western ? 0.4 : 0;
  return { boot: score >= 0.97 ? 'boot' : score === 0 ? 'other' : 'unsure', boot_score: score };
}

// Seller-standardized "Label: value" lines in the description → field. These win over everything except title/price.
const DESC_LABELS = { width: 'width', 'wbw price': 'wbw_price', 'western boot world price': 'wbw_price', 'asking price': 'wbw_price', size: 'size', brand: 'brand', maker: 'brand',
  'sized for': 'sized_for', gender: 'sized_for', 'material type': 'material_type', material: 'material', leather: 'material', hide: 'material',
  'material specifics': 'material_cut', 'material cut': 'material_cut', cut: 'material_cut', keywords: 'keywords',
  'sole length': 'sole_length', 'sole heel to toe': 'sole_length', 'heel to toe': 'sole_length',
  'sole width': 'sole_width', 'sole widest part': 'sole_width', 'widest part': 'sole_width', 'widest spot': 'sole_width',
  'heel height': 'heel_height', 'shaft circumference': 'shaft_circ', 'shaft height': 'shaft_height',
  'us mens size': 'size', 'us men size': 'size', 'us womens size': 'size', 'us women size': 'size', 'us kids size': 'size',
  'where made': 'made_in', 'made in': 'made_in', origin: 'made_in', condition: 'condition', color: 'color', colour: 'color',
  sole: 'sole', heel: 'heel', toe: 'toe', 'toe shape': 'toe', 'size estimated': 'size_estimated' };
const MEAS = ['sole_length', 'sole_width', 'heel_height', 'shaft_circ', 'shaft_height'];
// "13 in", "1.75", and "2 1/8 in" (a mixed fraction). The first number alone would drop the fraction.
const inches = s => {
  const m = String(s ?? '').match(/(\d+(?:\.\d+)?)(?:\s+(\d+)\s*\/\s*(\d+))?/);
  if (!m) return null;
  const n = m[2] ? Number(m[1]) + Number(m[2]) / Number(m[3]) : Number(m[1]);
  return String(Math.round(n * 1000) / 1000);
};
// "double A", "2A", "AAA" → AA / AAA / AAAA. Every other width is kept as written, uppercased.
const normWidth = w => {
  const s = String(w ?? '').trim().replace(/\s+/g, ' ');
  if (!s) return '';
  const spelled = s.match(/^(quad(?:ruple)?|triple|double|[234])\s*a$/i);
  if (!spelled) return s.toUpperCase();
  return { '2': 'AA', double: 'AA', '3': 'AAA', triple: 'AAA', '4': 'AAAA', quad: 'AAAA', quadruple: 'AAAA' }[spelled[1].toLowerCase()];
};
const parseSize = v => {
  const m = String(v ?? '').trim().match(new RegExp(`(\\d{1,2}(?:\\.\\d+)?)(?:\\s*(${WIDTH})\\b)?`, 'i'));
  return m ? { size: m[1], width: m[2] ? normWidth(m[2]) : '' } : null;
};
const norm = s => String(s ?? '').replace(/[\u00a0\u202f\u2007\u2009]/g, ' ');
const measure = (text, res) => { for (const re of res) { const m = text.match(re); if (m?.[1]) return m[1]; } return null; };
const MEAS_RE = {
  sole_length: [/sole length[:\s]*(\d+(?:\.\d+)?)/i, /sole heel to toe[:\s]*(\d+(?:\.\d+)?)/i, /heel to toe[:\s]*(\d+(?:\.\d+)?)/i],
  sole_width: [/sole width[:\s]*(\d+(?:\.\d+)?)/i, /sole widest part[:\s]*(\d+(?:\.\d+)?)/i, /widest (?:part|spot)[:\s]*(\d+(?:\.\d+)?)/i],
  heel_height: [/heel height[:\s]*(\d+(?:\.\d+)?)/i, /\b(\d+(?:\.\d+)?)\s*-?\s*(?:in(?:ch|ches)?|")\s*(?:(?:riding|walking|roper|cuban|stockman|underslung|block|fashion|dogger)\s+)?heel\b/i],
  shaft_circ: [/shaft (?:circumference|opening)[:\s]*(\d+(?:\.\d+)?)/i, /\b(\d+(?:\.\d+)?)\s*-?\s*(?:in(?:ch|ches)?|")\s*(?:shaft\s+)?(?:circumference|opening|calf)\b/i],
  shaft_height: [/shaft height[:\s]*(\d+(?:\.\d+)?)/i, /\b(\d+(?:\.\d+)?)\s*-?\s*(?:in(?:ch|ches)?|")\s*(?:tall\s+)?shaft\b/i, /\b(\d+(?:\.\d+)?)\s*-?\s*(?:in(?:ch|ches)?|")\s*tall\b/i],
};
const KEYWORDS = [['Vintage', /\bvintage\b/i], ['Exotic', /\bexotic\b/i], ['Square toe', /\bsquare toes?\b/i], ['Custom', /\bcustom\b/i],
  ['High-end', /\bhigh[- ]end\b/i], ['Pre-ban', /\bpre[- ]?ban\b/i], ['Inlay / overlay', /\binlays?\b|\boverlays?\b/i],
  ['Limited Edition', /\blimited edition\b/i], ['Hand-tooled', /\bhand[- ]?tooled\b/i], ['Deadstock', /\bdeadstock\b/i]];
const cutOf = name => /full[- ]?quill/i.test(name) ? 'Full quill' : /\bhornback\b|\bhbl\b/i.test(name) ? 'Hornback'
  : /\bbelly\b/i.test(name) ? 'Belly' : /\bsmooth\b/i.test(name) ? 'Smooth' : /\bleg\b/i.test(name) ? 'Leg'
  : /\b(tail|shoulder|flank)\b/i.test(name) ? name.match(/\b(tail|shoulder|flank)\b/i)[1].replace(/^\w/, c => c.toUpperCase()) : null;
const labeled = desc => Object.fromEntries((desc ?? '').split('\n').map(l => l.match(/^\s*([a-z][a-z ’'/-]{1,30}?)\s*:\s*(.+?)\s*$/i))
  .filter(m => m && DESC_LABELS[m[1].toLowerCase().replace(/[’']/g, '')]).map(m => [DESC_LABELS[m[1].toLowerCase().replace(/[’']/g, '')], m[2]]));
const GENDER = /\b(women['’]?s|womens|ladies|cowgirls?|kids|youth|toddlers?|children['’]?s|boys['’]?|girls['’]?|men['’]?s|mens)\b/i;
const gender = w => /^(wom|lad|cowg)/i.test(w) ? 'Women' : /^(kid|you|tod|chi|boy|gir)/i.test(w) ? 'Kids' : 'Men';
const cap = s => s && s.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
// A comma stays only when the next part is a US state or a country ("El Paso, Texas", "Leon, Mexico").
const PLACE_NAMES = `alabama|alaska|arizona|arkansas|california|colorado|connecticut|delaware|florida|georgia|hawaii|idaho|illinois|indiana|iowa|kansas|kentucky|louisiana|maine|maryland|massachusetts|michigan|minnesota|mississippi|missouri|montana|nebraska|nevada|new hampshire|new jersey|new mexico|new york|north carolina|north dakota|ohio|oklahoma|oregon|pennsylvania|rhode island|south carolina|south dakota|tennessee|texas|utah|vermont|virginia|washington|west virginia|wisconsin|wyoming|district of columbia|mexico|canada|spain|italy|brazil|china|india|portugal|argentina|australia|england|united kingdom|uk|france|germany|japan|korea|south korea|north korea|vietnam|thailand|indonesia|philippines|taiwan|hong kong|scotland|ireland|poland|romania|hungary|czech republic|czechia|slovakia|austria|switzerland|belgium|netherlands|sweden|norway|denmark|finland|greece|turkey|morocco|tunisia|egypt|south africa|nigeria|ethiopia|kenya|colombia|peru|chile|ecuador|venezuela|cuba|dominican republic|puerto rico|guatemala|honduras|el salvador|nicaragua|costa rica|panama|bolivia|uruguay|paraguay|pakistan|bangladesh|sri lanka|nepal|mongolia|russia|ukraine|israel|new zealand`.split('|').sort((a, b) => b.length - a.length);
const showPlace = n => n === 'uk' ? 'UK' : n.replace(/\b\w/g, c => c.toUpperCase()).replace(/\bOf\b/g, 'of');
const USA_RE = /^(?:united states(?: of america)?|u\.?\s*s\.?\s*a\.?|u\.?\s*s\.?)$/i;
const exactPlace = segment => {
  const s = String(segment ?? '').trim().replace(/[.\s]+$/g, '');
  if (USA_RE.test(s)) return 'USA';
  const hit = PLACE_NAMES.find(n => n === s.toLowerCase());
  return hit ? showPlace(hit) : null;
};
const prefixPlace = segment => {
  const s = String(segment ?? '').trim();
  const exact = exactPlace(s);
  if (exact) return exact;
  const usa = s.match(/^(?:united states(?: of america)?|u\.?\s*s\.?\s*a\.?|u\.?\s*s\.?)\b/i);
  if (usa && /^[^a-z0-9]/i.test(s.slice(usa[0].length) || '.')) return 'USA';
  const lower = s.toLowerCase();
  const hit = PLACE_NAMES.find(n => lower.startsWith(n) && lower[n.length] && /[^a-z]/.test(lower[n.length]));
  return hit ? showPlace(hit) : null;
};
const place = s => {
  if (!s) return null;
  const raw = String(s).replace(/\s+/g, ' ').trim();
  if (!raw) return null;
  const bits = raw.split(',');
  const head = bits[0].trim();
  const known = exactPlace(head);
  const cut = head.split(/\.\s|!|\?/)[0];
  const first = known || exactPlace(cut) || cut.replace(/[.\s;]+$/g, '').trim();
  if (!first) return null;
  if (bits.length < 2) return known || first;
  const second = prefixPlace(bits.slice(1).join(','));
  return second ? `${first}, ${second}` : first;
};

// Fills WBW fields from the listing. `guessed` = fields read from free text (the seller should verify them).
// A source column (raw.brand / color / size / material) beats a guess and a "Label: value" line.
export function enrich(raw) {
  const description = norm(raw.description), title = norm(raw.title);
  const lab = labeled(description);
  if (lab.wbw_price) lab.wbw_price = lab.wbw_price.replace(/[^\d.]/g, '') || undefined;
  if (lab.sized_for) lab.sized_for = gender(lab.sized_for);
  const whoLine = description.match(/^\s*us (men|women|kids)['’]?s?\s+size\s*:/im);
  if (whoLine && !lab.sized_for) lab.sized_for = gender(whoLine[1]);
  const fromLabel = parseSize(lab.size), colRaw = parseSize(raw.size);
  const col = colRaw && fromLabel && Number(colRaw.size) >= 30 && Number(fromLabel.size) < 30 ? null : colRaw;
  if (fromLabel) lab.size = fromLabel.size;
  for (const f of MEAS) if (lab[f]) lab[f] = inches(lab[f]) || undefined;
  if (lab.size_estimated) lab.size_estimated = /^(y|yes|true|estimated)$/i.test(lab.size_estimated) ? 'Yes' : undefined;
  const it = { ...raw, ...Object.fromEntries(Object.entries(lab).filter(([, v]) => v)) };
  if (col?.size) it.size = col.size;
  const text = `${title}\n${description}`, find = re => text.match(re)?.[1];
  const labeledSize = text.match(new RegExp(`\\bsize:?\\s*(\\d{1,2}(?:\\.5)?)(?:\\s*(${WIDTH}))?\\b`, 'i'));
  const gluedSize = `${title} ${col?.size || fromLabel?.size || ''}`.match(new RegExp(`\\b(\\d{1,2}(?:\\.5)?)[ -]?(${WIDTH})\\b`, 'i'));
  const trailingSize = title.match(new RegExp(`\\b(\\d{1,2}(?:\\.5)?)(?:\\s*(${WIDTH}))?\\s*$`, 'i'));
  const sz = labeledSize || gluedSize || trailingSize;
  const mat = findMaterial(text);
  // Brand: the source's (standardised), else a known maker named in the listing, else "Custom" if the title says custom.
  const brand = raw.brand ? brandName(raw.brand) : it.brand ? brandName(it.brand) : findBrand(title)?.name || findBrand(text)?.name || (/\bcustom\b/i.test(title) ? 'Custom' : null);
  const noBrand = brand ? text.replace(findBrand(brand)?.re ?? brand, '') : text; // so "Black Jack" isn't read as a color
  const who = (title.match(GENDER) || text.match(GENDER))?.[1];
  const width = normWidth(col?.width || lab.width || fromLabel?.width || sz?.[2] || it.width) || null;
  const material = raw.material?.trim() || it.material || mat?.name || null;
  const explicitNew = /^\s*(brand )?new\s*$/i.test(it.condition ?? '') || /\b(brand new|new with(out)? (tags|box)|new in box|nwt|nwob|nib|never worn|unworn|deadstock)\b/i.test(text);
  const toe = it.toe || find(/\b(wide square|broad square|medium round|snip|square|round|cutter|roper|needle|pointed|french|\d|j|r) toe\b/i)?.replace(/^\w/, c => c.toUpperCase()).concat(' toe') || null;
  const tags = KEYWORDS.filter(([, re]) => re.test(text)).map(([n]) => n);
  if (mat?.exotic && !tags.includes('Exotic')) tags.push('Exotic');
  if (/square/i.test(toe ?? '') && !tags.includes('Square toe')) tags.push('Square toe');
  if (brand === 'Custom' && !tags.includes('Custom')) tags.push('Custom');
  const out = {
    ...it,
    brand,
    size: col?.size || fromLabel?.size || sz?.[1] || (/^estimated$/i.test(String(raw.size ?? '')) ? 'Estimated' : null),
    size_estimated: it.size_estimated || (/^estimated$/i.test(it.size ?? '') || /\b(size (is )?estimated|estimated size)\b/i.test(text) ? 'Yes' : null),
    width, // left blank if the listing doesn't say (shown red as a heads-up, not required)
    sized_for: it.sized_for || (who ? gender(who) : 'Men'), // men's unless the listing says otherwise
    // New when explicitly new (not "like new"). Custom Made when the listing says so. Otherwise Broken In.
    condition: explicitNew ? 'New' : /\bcustom[- ]made\b|\bmade to order\b/i.test(text) ? 'Custom Made' : 'Broken In',
    material,
    material_type: it.material_type || (mat ? (mat.exotic ? 'Exotic' : 'Leather') : null),
    material_cut: (it.material_cut && (cutOf(it.material_cut) || it.material_cut)) || cutOf(material ?? '') || cutOf(text.match(/\b(full[- ]?quill|hornback|hbl|belly|tail|shoulder|flank)\b/i)?.[1] ?? '') || null,
    made_in: place(it.made_in) || place(find(/where made:?[ \t]*([^\n]+)/i)) || place(find(/\bmade in (?:the )?([^\n]{2,120})/i)) || null,
    color: raw.color?.trim() || it.color || cap(noBrand.match(/\b(black cherry|chocolate brown|black|brown|tan|cognac|chocolate|honey|red|bone|white|grey|gray|blue|green|burgundy|oxblood|natural|camel|saddle|rust|cherry)\b/i)?.[1]) || null,
    keywords: it.keywords || (tags.length ? tags.join(', ') : null),
    sole_length: inches(it.sole_length) || measure(text, MEAS_RE.sole_length),
    sole_width: inches(it.sole_width) || measure(text, MEAS_RE.sole_width),
    heel_height: inches(it.heel_height) || measure(text, MEAS_RE.heel_height),
    shaft_circ: inches(it.shaft_circ) || measure(text, MEAS_RE.shaft_circ),
    shaft_height: inches(it.shaft_height) || measure(text, MEAS_RE.shaft_height),
    toe,
    heel: it.heel || cap(find(/\b(riding|walking|roper|cuban|stockman|underslung|block|fashion|dogger) heel/i))?.concat(' heel') || null,
    sole: it.sole || cap(find(/\b(leather|rubber|crepe|lug|vibram|composite) soles?\b/i)) || (/\bpeg(s|ged)\b/i.test(text) ? 'Leather, pegged' : null),
  };
  // Given (not flagged) = from the source's own fields or a "Label: value" line. The default "Men" isn't flagged either;
  // genderDefaulted lets a seller's own default replace it.
  const given = f => lab[f] || raw[f] || (f === 'size' && !!(col?.size || fromLabel)) || (f === 'width' && !!(col?.width || fromLabel?.width)) || (f === 'sized_for' && !who);
  return { ...out, ...classify(out), genderDefaulted: !it.sized_for && !who, guessed: [...GUESSED, 'size'].filter(f => out[f] && !given(f)) };
}

// Schema changes run on the first request. There is no separate migration runner.
// `if not exists` keeps a second boot from failing. A failure clears `ready` so the next request tries again.
// New imports store opt_original. Older rows stay null until the next import of that listing, or until Prepare
// saves a snapshot of the text it saw. boot_references is one note per seller + maker + model.
let ready;
const init = () => ready ??= sql`create table if not exists items (
  id serial primary key, seller text not null, status text not null default 'review', boot text not null,
  source text, source_id text, title text, price numeric, description text, size text, condition text, brand text,
  photos text[] not null default '{}', created_at timestamptz default now(), unique (seller, source, source_id))`
  .then(() => conn().query(`alter table items add column if not exists removed_at timestamptz, add column if not exists status_at timestamptz,
    add column if not exists changed_at timestamptz,
    add column if not exists enrich_v int default 0, add column if not exists guessed text[] default '{}', add column if not exists src_hash text,
    add column if not exists boot_score real, add column if not exists source_url text,
    add column if not exists id_photos jsonb, add column if not exists posted jsonb, add column if not exists id_checked_at timestamptz,
    add column if not exists approved_at timestamptz, add column if not exists approved_by text,
    add column if not exists markets text, add column if not exists src_photos text, add column if not exists verified text[] default '{}',
    ${NEW_COLS.map(c => `add column if not exists ${c} ${NUMERIC.includes(c) ? 'numeric' : 'text'}`).join(', ')}`))
  .then(() => sql`alter table items add column if not exists opt_original jsonb, add column if not exists opt_proposal jsonb, add column if not exists opt_applied jsonb, add column if not exists style_ref jsonb`)
  .then(() => sql`create table if not exists boot_references (
    id serial primary key, seller text not null, maker text not null, model text not null default '',
    status text not null, provenance text not null, notes text not null default '', created_at timestamptz default now())`)
  .then(() => sql`create index if not exists boot_references_seller_idx on boot_references (seller)`)
  // Drop later duplicate notes before the unique index, or an existing database would fail init.
  .then(() => sql`delete from boot_references a using boot_references b
    where a.id > b.id and a.seller = b.seller and lower(a.maker) = lower(b.maker) and lower(a.model) = lower(b.model)`)
  .then(() => sql`create unique index if not exists boot_references_maker_model on boot_references (seller, lower(maker), lower(model))`)
  .then(() => sql`create table if not exists sellers (name text primary key, display_name text, contact text, email text, phone text,
    location text, website text, fb_profile text, notes text, created_at timestamptz default now())`)
  .then(() => sql`alter table sellers add column if not exists sync text default 'off', add column if not exists terms text, add column if not exists defaults text,
    add column if not exists login_hash text, add column if not exists login_salt text,
    add column if not exists ship_price text, add column if not exists handle_days text, add column if not exists return_days text, add column if not exists brand_context text,
    add column if not exists invite_hash text, add column if not exists invite_expires timestamptz, add column if not exists session_v int not null default 0`)
  .then(() => sql`create table if not exists login_attempts (key text primary key, n int not null, window_start timestamptz not null)`)
  .then(() => sql`alter table items add column if not exists source_condition text, add column if not exists opt_error text`)
  .then(() => sql`alter table items add column if not exists missing_group_price boolean not null default false`)
  .then(() => sql`create table if not exists import_writes (seller text not null, job text not null, n int not null, primary key (seller, job))`)
  .then(() => sql`alter table import_writes add column if not exists lim int not null default 100`)
  .then(() => sql`update items set status_at = coalesce(removed_at, now()) where status in ('removed', 'pending') and status_at is null`)
  .then(() => sql`update items set seller = lower(trim(seller)) where seller <> lower(trim(seller))`)
  .then(async () => { // re-run enrich() on items imported under older rules: only guessed fields are re-derived; source/seller values and WBW price kept
    const rows = await sql`select * from items where coalesce(enrich_v, 0) < ${ENRICH_V}`;
    const sellers = Object.fromEntries((await sql`select * from sellers`).map(s => [s.name, s]));
    for (let i = 0; i < rows.length; i += 25) await Promise.all(rows.slice(i, i + 25).map(r => {
      const e = enrichFor({ ...r, ...Object.fromEntries((r.guessed ?? []).filter(f => f !== 'size').map(f => [f, null])) }, sellers[r.seller]);
      return setFields(r.id, { ...e, wbw_price: e.wbw_price ?? r.wbw_price ?? r.price, enrich_v: ENRICH_V });
    }));
  })
  .then(() => ensureBugTables())
  .catch(e => { ready = null; throw e; }); // retry setup on the next request instead of caching the failure
const ENRICH_V = 12; // bump to re-run enrich() over existing items after parsing changes
// Fields enrich() may infer from free text (flagged for the seller to verify).
const GUESSED = ['brand', 'sized_for', 'width', 'material_type', 'material', 'material_cut', 'made_in', 'color', 'keywords',
  'sole_length', 'sole_width', 'heel_height', 'shaft_circ', 'shaft_height', 'size_estimated', 'sole', 'heel', 'toe'];

// Writes the given columns of `it` (FIELDS plus internal ones) to one item — only if it belongs to `seller`, when given.
const WRITABLE = [...FIELDS, 'boot', 'boot_score', 'status', 'photos', 'enrich_v', 'guessed', 'src_hash', 'source_url', 'source_condition', 'opt_error', 'missing_group_price', 'status_at', 'changed_at', 'id_photos', 'id_checked_at', 'approved_at', 'approved_by', 'markets', 'src_photos', 'verified', 'opt_original', 'opt_proposal', 'opt_applied', 'style_ref'];
const JSONB = new Set(['id_photos', 'posted', 'opt_original', 'opt_proposal', 'opt_applied', 'style_ref']);
// One JSON text value, then ::jsonb in SQL. A plain object and an already-stringified value both become a jsonb object, not a jsonb string.
const jsonValue = v => v == null || v === '' ? null : (typeof v === 'string' ? v : JSON.stringify(v));
const setFields = (id, it, seller) => {
  const keys = WRITABLE.filter(f => it[f] !== undefined);
  const vals = [id, ...keys.map(k => JSONB.has(k) ? jsonValue(it[k]) : (it[k] === '' ? null : it[k]))];
  if (!keys.length) return [];
  const scope = seller ? ` and seller = $${vals.push(seller)}` : '';
  return conn().query(`update items set ${keys.map((k, i) => `${k} = $${i + 2}${JSONB.has(k) ? '::jsonb' : ''}`).join(', ')} where id = $1${scope} returning *`, vals);
};

// Every photo must download (up to 30), or the import fails. Photos already on Blob or R2 are kept.
// A Blob put error (quota or otherwise) keeps the source URL so the item still imports; backfill copies it later.
const blobHost = src => {
  try {
    const u = new URL(src), host = u.hostname.toLowerCase();
    return u.protocol === 'https:' && (host === 'blob.vercel-storage.com' || host.endsWith('.blob.vercel-storage.com'));
  } catch { return false; }
};
export async function importPhoto(src, n, putFn = put) {
  if (blobHost(src) || allowedPhotoUrl(src)) return src;
  let u;
  try { u = new URL(src); } catch { throw new Error(`Photo ${n} didn't import (bad url)`); }
  if ((u.protocol !== 'http:' && u.protocol !== 'https:') || u.username || u.password) throw new Error(`Photo ${n} didn't import (bad url)`);
  try { await resolvePublic(u.hostname); }
  catch (e) { throw new Error(`Photo ${n} didn't import (${e.message})`); }
  const r = await fetch(u.href, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!r.ok) throw new Error(`Photo ${n} didn't import (HTTP ${r.status})`);
  const body = await r.blob(), type = r.headers.get('content-type') || 'image/jpeg';
  try {
    return (await putFn(`photos/${crypto.randomUUID()}.jpg`, body, { access: 'public', contentType: type })).url;
  } catch { return src; }
}

// Copies photos still linked to their source into Blob, a few items per call; returns how many items are left.
export async function backfillPhotos(limit = 5) {
  await init();
  const rows = await sql`select id, photos from items where exists (select 1 from unnest(photos) p where p not like 'https://%.blob.vercel-storage.com/%' and p not like 'https://blob.vercel-storage.com/%') order by id limit ${limit}`;
  for (const r of rows) await setFields(r.id, { photos: await Promise.all(r.photos.map((p, i) => importPhoto(p, i + 1).catch(() => p))) });
  return { left: (await sql`select count(*)::int n from items where exists (select 1 from unnest(photos) p where p not like 'https://%.blob.vercel-storage.com/%' and p not like 'https://blob.vercel-storage.com/%')`)[0].n };
}

// After 30 days: Pending sold → Sold, Removed → Archived.
export async function getItems(seller, status) {
  await init();
  await sql`update items set status = case status when 'pending' then 'sold' else 'archived' end, status_at = now()
    where seller = ${seller} and status in ('pending', 'removed') and status_at < now() - interval '30 days'`;
  return sql`select * from items where seller = ${seller} and status = ${status} order by created_at desc`;
}

// Sellers: WBW seller name (key, lowercase) + details. A seller needs details before any import (pull) can run for them.
export const SELLER_FIELDS = ['display_name', 'contact', 'email', 'phone', 'location', 'website', 'fb_profile', 'sync', 'notes', 'terms', 'defaults', 'ship_price', 'handle_days', 'return_days', 'brand_context'];

// Seller listing-style rules, one "left = right" per line. terms: seller shorthand → meaning (used only to read the listing;
// the listing text itself is kept as written). defaults: field = value, used when the listing doesn't say.
const pairs = txt => (txt ?? '').split('\n').map(l => l.split('=').map(x => x.trim())).filter(([a, b]) => a && b);
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export function enrichFor(raw, s) {
  const terms = pairs(s?.terms), expand = t => terms.reduce((x, [a, b]) => x?.replace(new RegExp(`(?<![\\w])${esc(a)}(?![\\w])`, 'gi'), b), t);
  const e = enrich({ ...raw, title: expand(raw.title) ?? '', description: expand(raw.description) });
  for (const [f, v] of pairs(s?.defaults)) { const k = f.toLowerCase().replace(/ /g, '_'); if (FIELDS.includes(k) && (!e[k] || (k === 'sized_for' && e.genderDefaulted))) e[k] = v; }
  return { ...e, title: raw.title, description: raw.description };
}
const sellerRow = async name => (await sql`select * from sellers where name = ${name}`)[0];

// Sellers — with details if entered — and their item counts; `only` = just that seller (a seller's own login).
// Login hashes never leave the server; has_login says whether one is set.
export async function getSellers(only) {
  await init();
  const rows = await sql`select coalesce(s.name, i.seller) as seller, s.*, coalesce(i.review, 0) as review, coalesce(i.active, 0) as active
    from sellers s full join (select seller, count(*) filter (where status = 'review')::int as review,
      count(*) filter (where status in ('review', 'published', 'pending'))::int as active from items group by seller) i on i.seller = s.name
    order by 1`;
  return rows.filter(r => !only || r.seller === only).map(({ login_hash, login_salt, invite_hash, invite_expires, session_v, ...r }) => ({ ...r, has_login: String(login_hash ?? '').startsWith('scrypt$') }));
}

const accountRows = () => sql`select name, display_name, email, phone, login_salt as salt, login_hash as hash, coalesce(session_v, 0)::int as session_v from sellers`;
const attemptKeys = (ip, account) => [`ip:${ip || 'unknown'}`, account ? `acct:${String(account).slice(0, 200)}` : ''].filter(Boolean);

export async function readAttempts(ip, account) {
  await init();
  const rows = await sql`select key, n, window_start from login_attempts where key = any(${attemptKeys(ip, account)})`;
  return rows.map(r => ({ key: r.key, n: Number(r.n), start: new Date(r.window_start).getTime() }));
}
export async function failAttempt(ip, account) {
  await init();
  for (const key of attemptKeys(ip, account)) {
    const [row] = await sql`select n, window_start from login_attempts where key = ${key}`;
    const next = bump(row && { n: Number(row.n), start: new Date(row.window_start).getTime() });
    const at = new Date(next.start).toISOString();
    await sql`insert into login_attempts (key, n, window_start) values (${key}, ${next.n}, ${at})
      on conflict (key) do update set n = ${next.n}, window_start = ${at}`;
  }
}

// A new seller only. An email or phone already on a row is rejected, with or without a password.
export async function registerAccount(p) {
  await init();
  const { row } = await registerSeller(await accountRows(), p);
  await sql`insert into sellers (name, display_name, email, phone, login_salt, login_hash, session_v) values (${row.name}, ${row.display_name}, ${row.email}, ${row.phone}, ${row.salt}, ${row.hash}, 0)`;
  return { name: row.name, display_name: row.display_name, email: row.email, phone: row.phone, version: 0 };
}

// An admin-issued invite. The code is checked against its hash, then cleared so it cannot be used again.
export async function claimInviteAccount(code, password) {
  await init();
  const hash = inviteHash(code);
  const [row] = await sql`select name, invite_hash, invite_expires, coalesce(session_v, 0)::int as session_v from sellers where invite_hash = ${hash}`;
  if (!row) throw new Error('That invite is not valid.');
  const next = await claimWithInvite([row], code, password);
  const updated = await sql`update sellers set login_salt = ${next.salt}, login_hash = ${next.hash}, invite_hash = null, invite_expires = null, session_v = ${next.session_v}
    where name = ${row.name} and invite_hash = ${hash} returning name`;
  if (!updated.length) throw new Error('That invite is not valid.');
  return { name: row.name, version: next.session_v };
}

// Email or phone + password. → { role: 'seller', seller } | null. Staff sign-in is the admin password, checked before this.
export async function authenticate(id, password) {
  if (!loginId(id) || !String(password ?? '')) return null;
  await init();
  return matchSeller(await accountRows(), id, password);
}

export async function saveSeller(p) {
  await init();
  const name = p.name?.trim().toLowerCase();
  if (!name || !p.display_name?.trim()) throw new Error('WBW seller name and display name are required.');
  const email = p.email?.trim() ? normEmail(p.email) : '';
  if (p.email?.trim() && !isEmail(email)) throw new Error('Email has to look like an email address.');
  const phone = p.phone?.trim() ? normPhone(p.phone) : '';
  if (p.phone?.trim() && !phone) throw new Error('Phone number needs at least 10 digits.');
  // Renamed (rename_from = old name): move the seller record and their items to the new name.
  const from = p.rename_from?.trim().toLowerCase();
  if (from && from !== name) {
    if ((await sql`select 1 from sellers where name = ${name}`).length) throw new Error(`There's already a seller named "${name}".`);
    await sql`update sellers set name = ${name} where name = ${from}`;
    await sql`update items set seller = ${name} where seller = ${from}`;
  }
  const others = await sql`select name, email, phone from sellers where name <> ${name}`;
  if (email && others.some(s => normEmail(s.email) === email)) throw new Error('Another seller already uses that email.');
  if (phone && others.some(s => normPhone(s.phone) === phone)) throw new Error('Another seller already uses that phone number.');
  const vals = SELLER_FIELDS.map(f => f === 'email' ? (email || null) : f === 'phone' ? (phone || null) : (p[f]?.trim() || null));
  await conn().query(`insert into sellers (name, ${SELLER_FIELDS}) values ($1, ${SELLER_FIELDS.map((_, i) => `$${i + 2}`)})
    on conflict (name) do update set ${SELLER_FIELDS.map(f => `${f} = excluded.${f}`)}`, [name, ...vals]);
  const password = String(p.password ?? '');
  if (password) {
    if (password.length < MIN_PASSWORD) throw new Error(`Password needs at least ${MIN_PASSWORD} characters.`);
    if (password.length > 200) throw new Error('Password is too long.');
    const [cur] = await sql`select coalesce(session_v, 0)::int as session_v from sellers where name = ${name}`;
    const next = applyPassword(cur ?? { session_v: 0 }, await hashPassword(password));
    await sql`update sellers set login_salt = ${next.salt}, login_hash = ${next.hash}, invite_hash = null, invite_expires = null, session_v = ${next.session_v} where name = ${name}`;
  }
  let invite;
  if (p.issue_invite) {
    const inv = newInvite();
    await sql`update sellers set invite_hash = ${inv.hash}, invite_expires = ${inv.expires} where name = ${name}`;
    invite = { invite: inv.code, invite_expires: inv.expires };
  }
  const fresh = await sellerRow(name);
  const { login_hash, login_salt, invite_hash, invite_expires, session_v, ...pub } = fresh;
  return { ...pub, has_login: String(login_hash ?? '').startsWith('scrypt$'), ...invite };
}

// Deletes a seller's record — only when they have no items left (move or delete those first).
export async function deleteSeller(name) {
  await init();
  if ((await sql`select 1 from items where seller = ${name} limit 1`).length) throw new Error('This seller still has items — move or delete them first.');
  await sql`delete from sellers where name = ${name}`;
  return { ok: true };
}

// Imports (pulls) start by listing what the seller already has, so that's where seller details are required.
export async function getSourceIds(seller, source) {
  await init();
  if (!(await sellerRow(seller))) throw new Error(`Add details for seller "${seller}" on the inventory page before importing for them.`);
  return (await sql`select source_id from items where seller = ${seller} and source = ${source}`).map(r => r.source_id);
}

// Candidate ids and URLs this seller already stored. Other sellers' rows are not read. Nothing is written.
export async function knownImports(seller, source, candidates) {
  await init();
  if (!(await sellerRow(seller))) throw new Error(`Add details for seller "${seller}" on the inventory page before importing for them.`);
  if (source !== 'depop' && source !== 'facebook') throw new Error('That source cannot be checked.');
  const list = (Array.isArray(candidates) ? candidates : []).slice(0, KNOWN_CAP);
  const ids = [];
  const urls = [];
  for (const c of list) {
    const id = String(c?.id || candidateId(c?.url) || '').trim();
    const raw = String(c?.url || '').trim();
    const norm = normalizeUrl(raw);
    if (id) ids.push(id);
    if (raw) urls.push(raw);
    if (norm && norm !== raw) urls.push(norm);
  }
  if (!ids.length && !urls.length) return { known: [] };
  const rows = await sql`select source_id, source_url from items where seller = ${seller} and source = ${source}
    and (source_id = any(${ids.length ? ids : ['']}) or source_url = any(${urls.length ? urls : ['']}))`;
  return matchKnown(rows, list);
}

// Fingerprint of what the source said (not the seller's edits), to tell real source changes from re-imports.
const SOURCE_KEYS = ['title', 'price', 'description', 'condition', 'brand', 'size', 'sized_for', 'color', 'material'];
const fingerprint = raw => createHash('sha1').update(JSON.stringify([...SOURCE_KEYS.map(k => String(raw[k] ?? '').trim()), (raw.photos ?? []).length])).digest('hex'); // photo count, not URLs (FB's change daily)

// New item → insert. Already imported → ignored, unless the source listing changed since — or it was pending sold and is
// back on sale — then it's refreshed and sent back to Newly imported, marked changed, for the seller to review.
// Atomic per seller + job. A second server process reads the same row, so the cap is not lost on restart.
export async function unchangedImport(seller, raw) {
  await init();
  const sourceId = String(raw?.source_id || '');
  if (!sourceId) return false;
  const [old] = await sql`select src_hash, status, source_url from items where seller = ${seller} and source = ${raw.source ?? null} and source_id = ${sourceId}`;
  if (!old || old.status === 'pending' || !old.src_hash || !old.source_url) return false;
  if (['removed', 'archived', 'sold'].includes(old.status)) return true;
  return old.src_hash === fingerprint(raw);
}

export async function claimImportWrite(seller, jobId, limit) {
  await init();
  const job = String(jobId || '').trim();
  const cap = clampImportLimit(limit);
  nextImportCount(0, job, cap);
  const [row] = await sql`insert into import_writes (seller, job, n, lim) values (${seller}, ${job}, 1, ${cap})
    on conflict (seller, job) do update set n = import_writes.n + 1
    where import_writes.n < least(import_writes.lim, ${cap})
    returning n`;
  if (!row) {
    const err = new Error(`This import already used its ${cap} listing writes.`);
    err.status = 429;
    throw err;
  }
  return Number(row.n);
}

export async function createItem(seller, raw) {
  await init();
  const it = enrichFor(raw, await sellerRow(seller)), src_hash = fingerprint(raw);
  const source_condition = String(raw?.condition || '').trim().slice(0, 40) || null;
  const [old] = it.source_id ? await sql`select * from items where seller = ${seller} and source = ${it.source ?? null} and source_id = ${it.source_id}` : [];
  // Imported before fingerprints / item links: take today's as the baseline and fill in the link.
  if (old && (!old.src_hash || !old.source_url)) await setFields(old.id, { src_hash: old.src_hash ?? src_hash, source_url: old.source_url ?? it.source_url });
  if (old && old.status !== 'pending' && (!old.src_hash || old.src_hash === src_hash || CLOSED.includes(old.status))) return null;
  if (!it.photos?.length) throw new Error('No photos found');
  const photos = await Promise.all(it.photos.slice(0, MAX_PHOTOS).map((p, i) => importPhoto(p, i + 1)));
  const imported = importOriginal(raw, photos, new Date().toISOString());
  const fields = { ...Object.fromEntries(FIELDS.map(f => [f, it[f] ?? null])), boot: it.boot, boot_score: it.boot_score, photos,
    guessed: it.guessed, src_hash, source_url: it.source_url, source_condition, enrich_v: ENRICH_V,
    // Seller-set WBW price survives source changes; otherwise it follows the source price.
    wbw_price: it.wbw_price ?? (old && Number(old.wbw_price) !== Number(old.price) ? old.wbw_price : it.price ?? null) };
  const refresh = sourceRefreshPlan(old, src_hash, imported);
  if (refresh) {
    fields.opt_original = refresh.opt_original;
    if (refresh.opt_proposal === null) fields.opt_proposal = null;
    if (refresh.opt_applied === null) fields.opt_applied = null;
    if (refresh.style_ref === null) fields.style_ref = null;
  }
  try {
    const snap = bundledDirectory();
    applyAutoOptimization(fields, { ...it, photos, source_id: it.source_id, id: old?.id, opt_original: fields.opt_original }, {
      refs: await listReferences(seller), now: imported.captured_at, directory: snap.makers, fetched_at: snap.fetched_at, styleSample: bundledStyleSample(),
    });
  } catch (e) {
    fields.opt_error = e?.message || 'Optimization failed.';
  }
  const id = old?.id ?? (await sql`insert into items (seller, boot, source, source_id)
    values (${seller}, ${it.boot}, ${it.source ?? null}, ${it.source_id ?? null}) returning id`)[0].id;
  const [row] = await setFields(id, old ? { ...fields, status: 'review', status_at: new Date(), changed_at: new Date(), ...clearedApproval } : fields);
  return old ? { ...row, updated: true } : row;
}

// Listings no longer at the source → Pending sold (the seller confirms, or they become Sold after 30 days).
export async function syncSource(seller, source, sourceIds) {
  return (await sql`update items set status = 'pending', status_at = now() where seller = ${seller} and source = ${source}
    and status in ('review', 'published') and not (source_id = any(${sourceIds})) returning id`).length;
}

// Saving from the edit form = the fields are verified. A seller's edit of a live item comes back for another check.
// An admin edit stays live. The source snapshot is not rewritten here. Export drops applied photo names when the facts no longer match.
export async function updateItems(seller, ids, p, role = 'seller') {
  const fields = Object.fromEntries(FIELDS.filter(f => p[f] !== undefined).map(f => [f, p[f]]));
  const extra = role === 'admin' ? { guessed: [], changed_at: null } : { guessed: [], changed_at: null, ...clearedApproval };
  if (p.brand !== undefined || p.id_text !== undefined) extra.style_ref = null;
  // Saving the form verifies those fields. A later source sync must not overwrite them.
  const verified = FIELDS.filter(f => p[f] !== undefined);
  await Promise.all(ids.map(id => setFields(id, { ...fields, ...extra, verified }, seller)));
  if (role !== 'admin') await sql`update items set status = 'review', status_at = now() where seller = ${seller} and id = any(${ids}) and status = 'published'`;
}

const jsonField = v => {
  if (v == null || v === '') return null;
  if (typeof v === 'string') { try { return JSON.parse(v); } catch { return null; } }
  return v;
};
const asJson = v => v == null ? null : JSON.stringify(v);

export async function listReferences(seller) {
  await init();
  return sql`select id, seller, maker, model, status, provenance, notes, created_at from boot_references where seller = ${seller} order by id`;
}

export async function addReference(seller, input) {
  await init();
  const row = referenceFromFields(input);
  const saved = await listReferences(seller);
  if (saved.some(r => referenceKey(r) === referenceKey(row))) throw new Error('That maker and model note is already saved.');
  try {
    const [inserted] = await sql`insert into boot_references (seller, maker, model, status, provenance, notes)
      values (${seller}, ${row.maker}, ${row.model}, ${row.status}, ${row.provenance}, ${row.notes})
      returning id, seller, maker, model, status, provenance, notes, created_at`;
    return inserted;
  } catch (e) {
    if (/duplicate|unique/i.test(String(e?.message))) throw new Error('That maker and model note is already saved.');
    throw e;
  }
}

async function itemFor(seller, id) {
  const [item] = await sql`select * from items where id = ${id} and seller = ${seller}`;
  if (!item) throw new Error('That listing was not found.');
  return item;
}

// Staff-started from Optimize existing. Does not run during import.
// Rewrites photo names, alt text, and SEO meta when this lens pass is missing.
// The patch has no title, description, or price, so those stored values stay put.
export async function backfillOptimization(seller, limit = 25) {
  await init();
  const take = Math.min(100, Math.max(1, Math.floor(Number(limit) || 25)));
  const rows = await sql`select * from items where seller = ${seller} and coalesce(opt_applied->>'media', '') <> 'lens' order by id limit ${take}`;
  const refs = await listReferences(seller);
  const snap = bundledDirectory();
  const styleSample = bundledStyleSample();
  const now = new Date().toISOString();
  let optimized = 0, failed = 0;
  for (const row of rows) {
    const fields = {};
    try {
      applyAutoOptimization(fields, row, { refs, now, directory: snap.makers, fetched_at: snap.fetched_at, styleSample });
    } catch (e) {
      fields.opt_error = e?.message || 'Optimization failed.';
    }
    if (fields.opt_error) failed++; else optimized++;
    await setFields(row.id, fields, seller);
  }
  const [{ n }] = await sql`select count(*)::int as n from items where seller = ${seller} and coalesce(opt_applied->>'media', '') <> 'lens'`;
  return { optimized, failed, left: n };
}

// Draft only. Title, description, and photos stay as imported until apply.
export async function proposeOptimization(seller, id) {
  await init();
  const item = await itemFor(seller, id);
  const refs = await listReferences(seller);
  const snap = bundledDirectory();
  const out = optimize(item, refs, { now: new Date().toISOString(), directory: snap.makers, fetched_at: snap.fetched_at, styleSample: bundledStyleSample() });
  await setFields(id, { opt_original: asJson(out.original), opt_proposal: asJson(out.proposal) }, seller);
  const fresh = await itemFor(seller, id);
  return { item: fresh, proposal: out.proposal, reference_note: out.proposal.reference_note };
}

export async function acceptStyleCandidate(seller, id, recordUrl) {
  await init();
  const item = await itemFor(seller, id);
  const match = matchStyleSample(item, bundledStyleSample(), listingFacts(item).values.brand);
  const style_ref = acceptedStyleRef(match, recordUrl, new Date().toISOString());
  const description = item.description;
  await setFields(id, { style_ref }, seller);
  const fresh = await itemFor(seller, id);
  if (fresh.description !== description || fresh.title !== item.title) throw new Error('Keeping a catalog reference changed the listing.');
  return { item: fresh, style_ref };
}

export async function makerNoteAction(seller, id, mode) {
  await init();
  const item = await itemFor(seller, id);
  const original = jsonField(item.opt_original)?.description ?? '';
  const applied = jsonField(item.opt_applied) ?? {};
  const proposal = jsonField(item.opt_proposal) ?? {};
  const previous = applied.maker_note || proposal.maker_note || '';
  if (mode === 'remove') {
    const description = withoutMakerNote(item.description, original, previous);
    if (description === item.description) throw new Error('The maker note is not a separate ending on this description.');
    applied.maker_note = '';
    proposal.maker_note = '';
    await setFields(id, { description, opt_applied: asJson(applied), opt_proposal: asJson(proposal) }, seller);
    return { item: await itemFor(seller, id) };
  }
  if (mode === 'regenerate') {
    const maker = exactMaker(item.brand, bundledDirectory().makers);
    const next = makerSnippet(maker, item.source_id || item.id);
    const description = replaceMakerNote(item.description, original, previous, next);
    applied.maker_note = next;
    proposal.maker_note = next;
    await setFields(id, { description, opt_applied: asJson(applied), opt_proposal: asJson(proposal) }, seller);
    return { item: await itemFor(seller, id) };
  }
  throw new Error('Unknown maker note action.');
}

export async function editOptimization(seller, id, fields) {
  await init();
  const item = await itemFor(seller, id);
  const current = jsonField(item.opt_proposal);
  if (!current) throw new Error('Prepare an optimization before editing it.');
  assertFresh(item, current);
  const proposal = editProposal(current, fields);
  await setFields(id, { opt_proposal: asJson(proposal) }, seller);
  const fresh = await itemFor(seller, id);
  return { item: fresh, proposal };
}

export async function applyOptimizationToItem(seller, id, fields, role = 'seller') {
  await init();
  const item = await itemFor(seller, id);
  const current = jsonField(item.opt_proposal);
  if (!current) throw new Error('Prepare an optimization before applying it.');
  const patch = applyOptimization(item, { original: jsonField(item.opt_original), proposal: current }, { title: fields.title, description: fields.description, now: new Date().toISOString() });
  const review = reviewAfterApply();
  if (role !== 'admin' && role !== 'seller') throw new Error('Sign in to apply an optimization.');
  await setFields(id, {
    title: patch.title, description: patch.description, opt_original: asJson(patch.opt_original),
    opt_proposal: asJson(patch.opt_proposal), opt_applied: asJson(patch.opt_applied),
    approved_at: review.approved_at, approved_by: review.approved_by,
  }, seller);
  await sql`update items set status = 'review', status_at = now() where seller = ${seller} and id = ${id} and status = 'published'`;
  return { item: await itemFor(seller, id) };
}

// Seller approves their own listing. Staff, viewing that seller, can clear the check too.
// Either way it is published immediately, through the mock export only. approved_by is "staff" for an admin.
export function approvePlan(role, account, rows, ids, patch) {
  if ((rows?.length ?? 0) !== (ids?.length ?? 0)) throw new Error('Those items are not all on this seller.');
  for (const row of rows) {
    const missing = blocksApproval({ ...row, ...patch });
    if (missing.length) throw new Error(`Still missing: ${missing.join(', ')}`);
  }
  const who = role === 'admin' ? 'staff' : (isEmail(account?.email) ? normEmail(account.email) : normPhone(account?.phone));
  return { ...patch, ...liveRecord(who), verified: FIELDS };
}

export async function approveItems(seller, ids, p, role = 'seller') {
  await init();
  const patch = Object.fromEntries(FIELDS.filter(f => p?.[f] !== undefined).map(f => [f, p[f]]));
  const rows = await sql`select * from items where seller = ${seller} and id = any(${ids})`;
  const stamp = approvePlan(role, await sellerRow(seller), rows, ids, patch);
  await Promise.all(ids.map(id => setFields(id, stamp, seller)));
  return { approved: ids.length, ...pushStub(rows) };
}

// Deletes items from the tool, but their photos stay in Blob and the item's details move to photo_archive (WBW's boot-ID image archive).
export async function deleteItems(seller, ids) {
  await sql`create table if not exists photo_archive (id serial primary key, seller text, item jsonb, archived_at timestamptz default now())`;
  const rows = await sql`delete from items where seller = ${seller} and id = any(${ids}) returning *`;
  for (const r of rows) if (r.photos.length) await sql`insert into photo_archive (seller, item) values (${seller}, ${JSON.stringify(r)})`;
  return rows.length;
}

// Moves items to another seller (items that seller already has from the same listing are left where they are).
export async function moveItems(seller, ids, to) {
  to = to?.trim().toLowerCase();
  if (!to) throw new Error('Enter the seller to move to.');
  return (await sql`update items i set seller = ${to} where i.seller = ${seller} and i.id = any(${ids})
    and not exists (select 1 from items o where o.seller = ${to} and o.source = i.source and o.source_id = i.source_id) returning id`).length;
}

// Bulk price changes apply to the WBW price. The new price is the seller's, so a source sync leaves it alone.
export async function lowerPrice(seller, ids, percent = 0, amount = 0, role = 'seller') {
  if (role === 'admin') {
    await sql`update items set wbw_price = greatest(round(coalesce(wbw_price, price) * (1 - ${percent}::numeric / 100) - ${amount}::numeric, 2), 0)
      where seller = ${seller} and id = any(${ids})`;
  } else {
    await sql`update items set wbw_price = greatest(round(coalesce(wbw_price, price) * (1 - ${percent}::numeric / 100) - ${amount}::numeric, 2), 0),
      approved_at = null, approved_by = null where seller = ${seller} and id = any(${ids})`;
    await sql`update items set status = 'review', status_at = now() where seller = ${seller} and id = any(${ids}) and status = 'published'`;
  }
  await sql`update items set verified = (select coalesce(array_agg(distinct v), '{}') from unnest(coalesce(items.verified, '{}') || array['wbw_price']::text[]) as v) where seller = ${seller} and id = any(${ids})`;
}

export async function setStatus(seller, ids, action, role = 'seller') {
  if (!STATUS[action]) throw new Error(`Unknown action: ${action}`);
  await init();
  if (action === 'publish') {
    const rows = await sql`select id, approved_at from items where seller = ${seller} and id = any(${ids})`;
    assertCanPublish(role, rows);
    await sql`update items set status = ${STATUS[action]}, status_at = now() where seller = ${seller} and id = any(${ids})`;
    return pushStub(rows);
  }
  await sql`update items set status = ${STATUS[action]}, status_at = now() where seller = ${seller} and id = any(${ids})`;
}

// Rows for an ownership check. The caller still has to match them to the session seller.
export async function getItemsByIds(ids) {
  await init();
  if (!ids?.length) return [];
  return sql`select * from items where id = any(${ids})`;
}

// One item by id (for the public photo route).
export async function getItem(id) {
  await init();
  return (await sql`select * from items where id = ${id}`)[0];
}

// Published rows only. An applied rewrite is back in review until approveItems, so it is not in this feed.
export async function getFeedItems() {
  await init();
  return sql`select i.*, s.ship_price, s.handle_days, s.return_days from items i left join sellers s on s.name = i.seller where i.status = 'published' order by i.id`;
}

// Scans one item's photos for model/date code info (flags it for the WBW admin; suggested text goes in id_text until the admin corrects it).
export async function scanItem(id) {
  await init();
  const it = (await sql`select id, photos, id_text from items where id = ${id}`)[0];
  if (!it?.photos.length) return { found: 0 };
  const found = await scanPhotos(it.photos);
  await setFields(id, { id_photos: JSON.stringify(found), id_checked_at: new Date().toISOString(), ...(!it.id_text && found.length ? { id_text: found.map(f => f.text).join('; ') } : {}) });
  return { found: found.length };
}

// Items with ID-info photos, for the WBW knowledge base.
export async function idExport() {
  await init();
  return sql`select id, seller, brand, title, material, size, id_text, id_photos, photos from items where jsonb_array_length(coalesce(id_photos, '[]')) > 0 order by id`;
}

export async function importLp(seller, csv) {
  await init();
  // Photos stay as the source URLs here. backfillPhotos copies them through the same safeFetch path.
  const s = await sellerRow(seller);
  if (!s) throw new Error(`Add details for seller "${seller}" on the inventory page before importing for them.`);
  const { runLpImport } = await import('./lp.js');
  return runLpImport(csv, {
    enrich: raw => enrichFor(raw, s),
    async load(ids) {
      if (!ids.length) return [];
      return sql`select * from items where seller = ${seller} and source = 'listperfectly' and source_id = any(${ids})`;
    },
    async insert(sourceId, fields) {
      const [row] = await sql`insert into items (seller, boot, source, source_id, status) values (${seller}, ${fields.boot || 'unsure'}, 'listperfectly', ${sourceId}, ${fields.status || 'review'}) returning id`;
      await setFields(row.id, { ...fields, enrich_v: ENRICH_V });
    },
    async update(id, fields) {
      await setFields(id, { ...fields, enrich_v: ENRICH_V }, seller);
    },
  }, s);
}

// Listings from an earlier LP import that the new file does not contain → Pending sold.
export async function finishLp(seller, sourceIds) {
  await init();
  if (!(await sellerRow(seller))) throw new Error(`Add details for seller "${seller}" on the inventory page before importing for them.`);
  const ids = [...new Set((sourceIds ?? []).map(id => String(id)))];
  if (!ids.length) return 0;
  return syncSource(seller, 'listperfectly', ids);
}

// Records that an item was posted to another channel (craigslist, fbgroup, reddit…).
export async function markPosted(seller, id, channel) {
  await init();
  return sql`update items set posted = coalesce(posted, '{}') || jsonb_build_object(${channel}::text, now()) where id = ${id} and seller = ${seller} returning posted`.then(r => r[0]);
}

// Boot measurements, in the sell-a-pair field names. A value is stored only when the
// listing states it. Nothing is inferred from the brand. Centimeters become decimal inches.
// A range stays a range ("12-13"). An insole length is not its own column: it fills
// sole length only when the listing never states a sole length.
export const MEASUREMENTS = [
  ['shaft_height', 'Shaft height', [5, 24]],
  ['shaft_circ', 'Shaft circumference', [8, 24]],
  ['heel_height', 'Heel height', [0.125, 5]],
  ['sole_length', 'Sole length', [6, 16]],
  ['sole_width', 'Sole width', [2.5, 7]],
];
export const MEASUREMENT_KEYS = MEASUREMENTS.map(([k]) => k);
const RANGE = Object.fromEntries(MEASUREMENTS.map(([k, , range]) => [k, range]));

const UNI = { '½': ' 1/2', '⅓': ' 1/3', '⅔': ' 2/3', '¼': ' 1/4', '¾': ' 3/4', '⅛': ' 1/8', '⅜': ' 3/8', '⅝': ' 5/8', '⅞': ' 7/8' };
const NUM = String.raw`(?<![.\d/])(?:(\d{1,2}(?:\.\d+)?)(?:\s*[- ]\s*(\d{1,2})\s*/\s*(\d{1,2}))?|(\d{1,2})\s*/\s*(\d{1,2}))(?![\d/])`;
const UNIT = String.raw`(?:"|″|”|inches\b|inch\b|in\b|centimeters\b|centimeter\b|centimetres\b|centimetre\b|cm\b)`;
// [key, pattern, bare number ok]. Longer labels win when they overlap a shorter one.
const LABEL_RES = [
  ['shaft_circ', String.raw`\b(?:shaft\s+(?:circumference|circ|opening)|(?:top|calf)\s+circumference|(?:top|shaft)\s+opening|circumference)\b`, true],
  ['shaft_circ', String.raw`\b(?:circ|calf|opening)\b`, false],
  ['shaft_height', String.raw`\b(?:shaft\s*(?:height|ht)|boot\s+height)\b`, true],
  ['shaft_height', String.raw`\b(?:shaft|tall)\b`, false],
  ['heel_height', String.raw`\bheel\s*(?:height|ht)\b`, true],
  ['heel_height', String.raw`\bheel\b`, false],
  ['sole_width', String.raw`\b(?:(?:outsole|sole)\s+width(?:\s+at\s+the\s+ball)?|width\s+at\s+the\s+ball|ball\s+width|at\s+the\s+ball|widest\s+(?:part|spot)|sole\s+widest\s+part)\b`, true],
  ['sole_length', String.raw`\b(?:(?:outsole|sole)\s+length|(?:sole\s+)?heel\s+to\s+toe|length\s+of\s+(?:the\s+)?(?:outsole|sole))\b`, true],
  ['insole_length', String.raw`\b(?:insole\s+length|footbed\s+length|length\s+of\s+(?:the\s+)?insole)\b`, true],
  ['insole_length', String.raw`\binsole\b`, false],
].map(([key, src, bare]) => ({ key, bare, re: new RegExp(src, 'gi') }));

const FILL = new Set('is of about approx approximately around roughly tall high long wide riding walking roper cuban stockman underslung block fashion dogger cowboy stacked leather'.split(' '));
const BARE_GAP = String.raw`\s*(?:(?:is|of|about|approx(?:imately)?|around|roughly)\s+)*[:\-≈~]?\s*`;
const WIDTH_AFTER = /^\s*[- ]?\s*(?:[2-4]E|EEEE|EEE|EE|[A-EMW])\b/i;
const IN_NEXT = new Set('shaft heel circ circumference top insole outsole sole length height width tall high long wide riding walking roper cuban stockman underslung block fashion dogger cowboy stacked leather and with about approx approximately around opening calf'.split(' '));

const normalize = s => s.replace(/&quot;|&#0*34;|&#8243;|&Prime;/gi, '"').replace(/&frac12;|&#189;/gi, ' 1/2')
  .replace(/&frac14;|&#188;/gi, ' 1/4').replace(/&frac34;|&#190;/gi, ' 3/4')
  .replace(/[½⅓⅔¼¾⅛⅜⅝⅞]/g, c => UNI[c]).replace(/[″”]/g, '"').replace(/''/g, '"');

// "Heel: 2 in" is a height, not a heel style.
export const isMeasurementValue = v => /\d/.test(v ?? '') && /(?:"|″|”|\bin(?:ch(?:es)?)?\b|\bcm\b|centimet)/i.test(v);

const fmt = n => String(Math.round(Number(n) * 1000) / 1000);

function toInches(m, unit) {
  let n = m[1] != null ? parseFloat(m[1]) : 0;
  const num = m[2] ?? m[4], den = m[3] ?? m[5];
  if (m[1] == null && num == null) return null;
  if (num != null) { const d = parseInt(den, 10); if (!d) return null; n += parseInt(num, 10) / d; }
  if (/^(?:cm|centimet)/i.test(unit)) n /= 2.54;
  return Number.isFinite(n) && n > 0 ? Math.round(n * 1000) / 1000 : null;
}

function findMeasures(t) {
  const out = [], taken = [];
  const used = (start, end) => taken.some(([a, b]) => start < b && end > a);
  const rangeRe = new RegExp(String.raw`(?<![.\d/$])(\d{1,2}(?:\.\d+)?)\s*(?:-|–|to)\s*(\d{1,2}(?:\.\d+)?)(?!\s*/)\s*-?\s*(${UNIT})`, 'gi');
  let m;
  while ((m = rangeRe.exec(t))) {
    if (t[m.index - 1] === '$') continue;
    let lo = parseFloat(m[1]), hi = parseFloat(m[2]);
    if (!(hi > lo)) continue;
    if (/^(?:cm|centimet)/i.test(m[3])) { lo /= 2.54; hi /= 2.54; }
    const end = m.index + m[0].length;
    out.push({ value: `${fmt(lo)}-${fmt(hi)}`, lo, hi, start: m.index, end });
    taken.push([m.index, end]);
  }
  const re = new RegExp(`${NUM}\\s*-?\\s*(${UNIT})`, 'gi');
  while ((m = re.exec(t))) {
    if (t[m.index - 1] === '$' || used(m.index, m.index + m[0].length)) continue;
    const unit = m[6];
    if (/^in$/i.test(unit)) {
      const word = t.slice(m.index + m[0].length).match(/^[ \t]+([a-z']+)/i)?.[1]?.toLowerCase().replace(/'s$/, '');
      if (word && !IN_NEXT.has(word)) continue;
    }
    const inches = toInches(m, unit);
    if (inches != null) out.push({ value: fmt(inches), inches, start: m.index, end: m.index + m[0].length });
  }
  return out;
}

function findLabels(t) {
  const found = [];
  for (const { key, bare, re } of LABEL_RES) for (const hit of t.matchAll(re)) found.push({ key, bare, start: hit.index, end: hit.index + hit[0].length });
  found.sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start));
  const kept = [];
  for (const lab of found) if (!kept.some(k => lab.start < k.end && lab.end > k.start)) kept.push(lab);
  return kept;
}

function gapLen(gap, forward) {
  if (/\d/.test(gap) || gap.length > 40 || /\n\s*\n/.test(gap)) return null;
  if (!forward && /[.!?]/.test(gap)) return null;
  const g = gap.replace(/^[.:\-≈~,\s]+/, '').replace(/[.:\-≈~,\s]+$/, '');
  if (/[.!?]/.test(g)) return null;
  const words = g.toLowerCase().split(/[^a-z]+/).filter(Boolean);
  if (words.length > 3 || words.some(w => !FILL.has(w))) return null;
  return gap.length;
}

function inRange(key, meas) {
  const [lo, hi] = RANGE[key] ?? RANGE.sole_length;
  const a = meas.lo ?? meas.inches, b = meas.hi ?? meas.inches;
  return a >= lo && b <= hi;
}

// Reads measurements the listing actually states. Keys omitted when nothing was found.
export function readMeasurements(text) {
  if (!text || !String(text).trim()) return {};
  const t = normalize(String(text));
  const labels = findLabels(t), measures = findMeasures(t), pairs = [];
  for (const lab of labels) for (let i = 0; i < measures.length; i++) {
    const meas = measures[i];
    const forward = meas.start >= lab.end ? gapLen(t.slice(lab.end, meas.start), true) : null;
    const back = lab.start >= meas.end ? gapLen(t.slice(meas.end, lab.start), false) : null;
    if (forward == null && back == null) continue;
    if (!inRange(lab.key === 'insole_length' ? 'sole_length' : lab.key, meas)) continue;
    const dist = forward != null && back != null ? Math.min(forward, back) : forward ?? back;
    pairs.push({ lab, i, dist, backOnly: forward == null });
  }
  pairs.sort((a, b) => a.dist - b.dist || a.backOnly - b.backOnly);
  const usedL = new Set(), usedM = new Set(), out = {};
  for (const p of pairs) {
    if (usedL.has(p.lab) || usedM.has(p.i) || out[p.lab.key]) continue;
    usedL.add(p.lab); usedM.add(p.i); out[p.lab.key] = measures[p.i].value;
  }
  const bareRange = new RegExp(`^${BARE_GAP}(\\d{1,2}(?:\\.\\d+)?)\\s*(?:-|–|to)\\s*(\\d{1,2}(?:\\.\\d+)?)(?!\\s*/)`, 'i');
  const bareNum = new RegExp(`^${BARE_GAP}${NUM}`, 'i');
  for (const lab of labels) {
    if (!lab.bare || out[lab.key]) continue;
    const after = t.slice(lab.end, lab.end + 48);
    const range = after.match(bareRange);
    let value = null, lo, hi, used = 0;
    if (range && !WIDTH_AFTER.test(after.slice(range.index + range[0].length))) {
      lo = parseFloat(range[1]); hi = parseFloat(range[2]);
      if (hi > lo) { value = `${fmt(lo)}-${fmt(hi)}`; used = range[0].length; }
    }
    if (value == null) {
      const hit = after.match(bareNum);
      if (!hit || WIDTH_AFTER.test(after.slice(hit.index + hit[0].length))) continue;
      const inches = toInches(hit, 'in');
      if (inches == null) continue;
      value = fmt(inches); lo = hi = inches; used = hit[0].length;
    }
    const key = lab.key === 'insole_length' ? 'sole_length' : lab.key;
    if (value == null || lo < RANGE[key][0] || hi > RANGE[key][1]) continue;
    if (WIDTH_AFTER.test(after.slice(used))) continue;
    out[lab.key] = value;
  }
  if (!out.sole_length && out.insole_length) out.sole_length = out.insole_length;
  delete out.insole_length;
  return out;
}

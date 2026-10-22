// Provisional measurement fields. WBW's real column names are not in this repo
// (no schema or import mapping) — confirm keys and CSV headers before a real import.
// Values are decimal inches. Centimeters in a listing are converted. Nothing is invented:
// a field stays blank when the listing doesn't state that measurement.
export const MEASUREMENTS = [
  ['shaft_height', 'Shaft height (in)', [5, 24]],
  ['shaft_circ', 'Shaft circumference (in)', [8, 24]],
  ['heel_height', 'Heel height (in)', [0.125, 5]],
  ['outsole_length', 'Outsole length (in)', [6, 16]],
  ['outsole_width', 'Outsole width at the ball (in)', [2.5, 7]],
  ['insole_length', 'Insole length (in)', [6, 16]],
];
export const MEASUREMENT_KEYS = MEASUREMENTS.map(([k]) => k);
export const MEASUREMENT_LABELS = Object.fromEntries(MEASUREMENTS.map(([k, label]) => [k, label]));
const RANGE = Object.fromEntries(MEASUREMENTS.map(([k, , range]) => [k, range]));

const UNI = { '½': ' 1/2', '⅓': ' 1/3', '⅔': ' 2/3', '¼': ' 1/4', '¾': ' 3/4', '⅛': ' 1/8', '⅜': ' 3/8', '⅝': ' 5/8', '⅞': ' 7/8' };
// Whole number, mixed number (12 1/2, 12-1/2), or a bare fraction (1/2). Not part of a longer digit run (years, phones).
const NUM = String.raw`(?<![.\d/])(?:(\d{1,2}(?:\.\d+)?)(?:\s*[- ]\s*(\d{1,2})\s*/\s*(\d{1,2}))?|(\d{1,2})\s*/\s*(\d{1,2}))(?![\d/])`;
const UNIT = String.raw`(?:"|″|”|inches\b|inch\b|in\b|centimeters\b|centimeter\b|centimetres\b|centimetre\b|cm\b)`;
// [key, pattern, bare number ok]. Longer labels are kept when they overlap a shorter one.
// A bare number is accepted only after a specific label (height/length/width/circumference), never after shorthand.
const LABEL_RES = [
  ['shaft_circ', String.raw`\b(?:shaft\s+(?:circumference|circ)|(?:top|calf)\s+circumference|(?:top|shaft)\s+opening|circumference)\b`, true],
  ['shaft_circ', String.raw`\b(?:circ|top)\b`, false],
  ['shaft_height', String.raw`\b(?:shaft\s*(?:height|ht)|boot\s+height)\b`, true],
  ['shaft_height', String.raw`\bshaft\b`, false],
  ['heel_height', String.raw`\bheel\s*(?:height|ht)\b`, true],
  ['heel_height', String.raw`\bheel\b`, false],
  ['outsole_width', String.raw`\b(?:(?:outsole|sole)\s+width(?:\s+at\s+the\s+ball)?|width\s+at\s+the\s+ball|ball\s+width|at\s+the\s+ball)\b`, true],
  ['outsole_length', String.raw`\b(?:(?:outsole|sole)\s+length|length\s+of\s+(?:the\s+)?(?:outsole|sole))\b`, true],
  ['insole_length', String.raw`\b(?:insole\s+length|footbed\s+length|length\s+of\s+(?:the\s+)?insole)\b`, true],
  ['insole_length', String.raw`\binsole\b`, false],
].map(([key, src, bare]) => ({ key, bare, re: new RegExp(src, 'gi') }));

const FILL = new Set('is of about approx approximately around roughly tall high long wide riding walking roper cuban stockman underslung block fashion dogger cowboy stacked leather'.split(' '));
const BARE_GAP = String.raw`\s*(?:(?:is|of|about|approx(?:imately)?|around|roughly)\s+)*[:\-≈~]?\s*`;
const WIDTH_AFTER = /^\s*[- ]?\s*(?:[2-4]E|EEEE|EEE|EE|[A-EMW])\b/i;
// "12 in stock" / "10 in men's" — bare "in" is a preposition unless the next word is part of the measurement.
const IN_NEXT = new Set('shaft heel circ circumference top insole outsole sole length height width tall high long wide riding walking roper cuban stockman underslung block fashion dogger cowboy stacked leather and with about approx approximately around'.split(' '));

const normalize = s => s.replace(/&quot;|&#0*34;|&#8243;|&Prime;/gi, '"').replace(/&frac12;|&#189;/gi, ' 1/2')
  .replace(/&frac14;|&#188;/gi, ' 1/4').replace(/&frac34;|&#190;/gi, ' 3/4')
  .replace(/[½⅓⅔¼¾⅛⅜⅝⅞]/g, c => UNI[c]).replace(/[″”]/g, '"').replace(/''/g, '"');

// A "heel: 2 in" line is a height, not a heel style.
export const isMeasurementValue = v => /\d/.test(v ?? '') && /(?:"|″|”|\bin(?:ch(?:es)?)?\b|\bcm\b|centimet)/i.test(v);

function toInches(m, unit) {
  let n = m[1] != null ? parseFloat(m[1]) : 0;
  const num = m[2] ?? m[4], den = m[3] ?? m[5];
  if (m[1] == null && num == null) return null;
  if (num != null) { const d = parseInt(den, 10); if (!d) return null; n += parseInt(num, 10) / d; }
  if (/^(?:cm|centimet)/i.test(unit)) n /= 2.54;
  return Number.isFinite(n) && n > 0 ? Math.round(n * 1000) / 1000 : null;
}
const fmt = n => String(n);

function findMeasures(t) {
  const re = new RegExp(`${NUM}\\s*(${UNIT})`, 'gi'), out = [];
  let m;
  while ((m = re.exec(t))) {
    if (t[m.index - 1] === '$') continue;
    const unit = m[6];
    // "12 in stock" / "10 in men's" on the same line. A new sentence after "2 in" is still a measurement.
    if (/^in$/i.test(unit)) {
      const word = t.slice(m.index + m[0].length).match(/^[ \t]+([a-z']+)/i)?.[1]?.toLowerCase().replace(/'s$/, '');
      if (word && !IN_NEXT.has(word)) continue;
    }
    const inches = toInches(m, unit);
    if (inches != null) out.push({ inches, start: m.index, end: m.index + m[0].length });
  }
  return out;
}

function findLabels(t) {
  const found = [];
  for (const { key, bare, re } of LABEL_RES) for (const m of t.matchAll(re)) found.push({ key, bare, start: m.index, end: m.index + m[0].length });
  found.sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start));
  const kept = [];
  for (const lab of found) if (!kept.some(k => lab.start < k.end && lab.end > k.start)) kept.push(lab);
  return kept;
}

// Gap between a label and a measurement. Forward may cross an abbreviation dot ("ht. 12");
// backward may not cross a sentence ("12\". The shaft").
function gapLen(gap, forward) {
  if (/\d/.test(gap) || gap.length > 40 || /\n\s*\n/.test(gap)) return null;
  if (!forward && /[.!?]/.test(gap)) return null;
  const g = gap.replace(/^[.:\-≈~,\s]+/, '').replace(/[.:\-≈~,\s]+$/, '');
  if (/[.!?]/.test(g)) return null;
  const words = g.toLowerCase().split(/[^a-z]+/).filter(Boolean);
  if (words.length > 3 || words.some(w => !FILL.has(w))) return null;
  return gap.length;
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
    const inches = meas.inches;
    if (inches < RANGE[lab.key][0] || inches > RANGE[lab.key][1]) continue;
    const dist = forward != null && back != null ? Math.min(forward, back) : forward ?? back;
    pairs.push({ lab, i, dist, backOnly: forward == null });
  }
  pairs.sort((a, b) => a.dist - b.dist || a.backOnly - b.backOnly);
  const usedL = new Set(), usedM = new Set(), out = {};
  for (const p of pairs) {
    if (usedL.has(p.lab) || usedM.has(p.i) || out[p.lab.key]) continue;
    usedL.add(p.lab); usedM.add(p.i); out[p.lab.key] = fmt(measures[p.i].inches);
  }
  const bareRe = new RegExp(`^${BARE_GAP}${NUM}`, 'i');
  for (const lab of labels) {
    if (!lab.bare || out[lab.key]) continue;
    const after = t.slice(lab.end, lab.end + 48), m = after.match(bareRe);
    if (!m || WIDTH_AFTER.test(after.slice(m.index + m[0].length))) continue;
    const inches = toInches(m, 'in');
    if (inches == null || inches < RANGE[lab.key][0] || inches > RANGE[lab.key][1]) continue;
    out[lab.key] = fmt(inches);
  }
  return out;
}

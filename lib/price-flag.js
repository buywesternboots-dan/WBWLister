// Price flags only. Never writes a price. Exact brand, then exact brand + full style (leading zeros kept).
const MIN_GROUP = 5;
const Z_LIMIT = 3.5;

const text = v => String(v ?? '').trim();

export function askingPrice(item) {
  const raw = item?.wbw_price != null && text(item.wbw_price) !== '' ? item.wbw_price : item?.price;
  if (raw == null || text(raw) === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function median(values) {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

function groupStats(rows) {
  if (rows.length < MIN_GROUP) return null;
  const prices = rows.map(r => r.price);
  const med = median(prices);
  const dev = median(prices.map(p => Math.abs(p - med)));
  return { median: med, mad: dev, count: rows.length };
}

function directionOf(price, stats) {
  if (!stats) return null;
  if (stats.mad === 0) {
    if (price > stats.median) return 'high';
    if (price < stats.median) return 'low';
    return null;
  }
  const z = 0.6745 * (price - stats.median) / stats.mad;
  if (z > Z_LIMIT) return 'high';
  if (z < -Z_LIMIT) return 'low';
  return null;
}

// Map of item id → { direction, group, label, median, count, price }. Ids are strings.
export function priceFlags(items) {
  const rows = (items ?? []).map(it => ({ it, price: askingPrice(it) })).filter(r => r.price != null);
  const styleGroups = new Map();
  const brandGroups = new Map();
  for (const row of rows) {
    const brand = text(row.it.brand);
    const style = text(row.it.id_text);
    if (!brand) continue;
    const brandKey = brand;
    if (!brandGroups.has(brandKey)) brandGroups.set(brandKey, []);
    brandGroups.get(brandKey).push(row);
    if (!style) continue;
    const styleKey = `${brand}\n${style}`;
    if (!styleGroups.has(styleKey)) styleGroups.set(styleKey, []);
    styleGroups.get(styleKey).push(row);
  }
  const styleStats = new Map();
  for (const [key, list] of styleGroups) {
    const stats = groupStats(list);
    if (stats) styleStats.set(key, { ...stats, label: `${key.split('\n')[0]} style ${key.split('\n')[1]}` });
  }
  const brandStats = new Map();
  for (const [key, list] of brandGroups) {
    const stats = groupStats(list);
    if (stats) brandStats.set(key, { ...stats, label: key });
  }
  const out = new Map();
  for (const row of rows) {
    const brand = text(row.it.brand);
    const style = text(row.it.id_text);
    if (!brand) continue;
    const styleKey = style ? `${brand}\n${style}` : '';
    const styleHit = styleKey ? styleStats.get(styleKey) : null;
    const brandHit = brandStats.get(brand);
    const chosen = styleHit || brandHit;
    if (!chosen) continue;
    const direction = directionOf(row.price, chosen);
    if (!direction) continue;
    out.set(String(row.it.id), {
      direction,
      group: styleHit ? 'brand+style' : 'brand',
      label: chosen.label,
      median: round2(chosen.median),
      count: chosen.count,
      price: row.price,
    });
  }
  return out;
}

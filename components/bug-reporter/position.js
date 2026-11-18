// Floating button geometry. Pure so a phone and a desktop window share one clamp/snap rule.
export const BUTTON = 48;
export const DRAG_THRESHOLD = 8;

export function safeBox({ vw, vh, size = BUTTON, inset = {} }) {
  const left = Math.max(0, Number(inset.left) || 0);
  const top = Math.max(0, Number(inset.top) || 0);
  const right = Math.max(0, Number(inset.right) || 0);
  const bottom = Math.max(0, Number(inset.bottom) || 0);
  return {
    left, top, right, bottom, size,
    maxX: Math.max(left, vw - size - right),
    maxY: Math.max(top, vh - size - bottom),
  };
}

export function clampPosition(x, y, metrics) {
  const b = safeBox(metrics);
  const nx = Number.isFinite(x) ? x : b.maxX;
  const ny = Number.isFinite(y) ? y : b.maxY;
  return { x: Math.min(b.maxX, Math.max(b.left, nx)), y: Math.min(b.maxY, Math.max(b.top, ny)) };
}

export function defaultPosition(metrics) {
  const b = safeBox(metrics);
  return clampPosition(b.maxX, b.maxY, metrics);
}

export function sideOf(x, metrics) {
  const b = safeBox(metrics);
  return x <= (b.left + b.maxX) / 2 ? 'left' : 'right';
}

export function placePosition(stored, metrics) {
  const b = safeBox(metrics);
  const side = stored?.side === 'left' ? 'left' : 'right';
  const y = typeof stored?.y === 'number' ? stored.y : b.maxY;
  return { ...clampPosition(side === 'left' ? b.left : b.maxX, y, metrics), side };
}

export function snapPosition(x, y, metrics) {
  const c = clampPosition(x, y, metrics);
  return placePosition({ side: sideOf(c.x, metrics), y: c.y }, metrics);
}

export function parseStoredPosition(raw, metrics) {
  try {
    const p = JSON.parse(raw);
    if (p && (p.side === 'left' || p.side === 'right')) return placePosition(p, metrics);
    if (p && typeof p.x === 'number' && typeof p.y === 'number') return snapPosition(p.x, p.y, metrics);
  } catch { /* missing or corrupt storage falls through */ }
  return { ...defaultPosition(metrics), side: 'right' };
}

export function movedPastThreshold(dx, dy, threshold = DRAG_THRESHOLD) {
  return dx * dx + dy * dy >= threshold * threshold;
}

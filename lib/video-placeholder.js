// Placeholder for the future "Make video from photos" tool (built elsewhere, plugged in later).
// No video processing happens in BootLister yet. When it does: optimization only, no compression, originals untouched.
// WBW listing video limits, per Dan (Nov 15, 2026). Those limits may force a size reduction later; that is not decided.
export const WBW_VIDEO_LIMITS = { count: 1, seconds: 30, megabytes: 100 };
export const VIDEO_TOOL_LABEL = 'Make video from photos (coming soon)';
export const VIDEO_TOOL_NOTE = `WBW allows ${WBW_VIDEO_LIMITS.count} video, up to ${WBW_VIDEO_LIMITS.seconds} seconds, ${WBW_VIDEO_LIMITS.megabytes} MB. Optimization only: no compression, and the original is not changed.`;

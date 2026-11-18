import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { VIDEO_TOOL_LABEL, VIDEO_TOOL_NOTE, WBW_VIDEO_LIMITS } from '../lib/video-placeholder.js';

test('video placeholder: disabled button with WBW limits, shown in the optimize panel, no processing', () => {
  assert.equal(VIDEO_TOOL_LABEL, 'Make video from photos (coming soon)');
  assert.deepEqual(WBW_VIDEO_LIMITS, { count: 1, seconds: 30, megabytes: 100 });
  assert.equal(VIDEO_TOOL_NOTE, 'WBW allows 1 video, up to 30 seconds, 100 MB. Optimization only: no compression, and the original is not changed.');
  const comp = readFileSync(new URL('../components/video-placeholder.js', import.meta.url), 'utf8');
  assert.match(comp, /<button type="button" disabled/);
  assert.doesNotMatch(comp, /onClick|fetch\(/);
  const panel = readFileSync(new URL('../components/optimize-panel.js', import.meta.url), 'utf8');
  assert.match(panel, /<VideoPlaceholder \/>/);
});

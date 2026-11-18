// The JavaScript amcasoWBW engine must match the Python tool (amcasoWBW 0.3.2) on names, copy, and prepared bytes.
// Golden output: test/fixtures/amcaso-golden/python-0.3.2.json, written by the Python tool from inputs.json (no pixel view analysis).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { planListing, runEngine } from '../lib/amcaso-wbw-engine.js';
import { prepareWbwImage, hasGps, stripGpsTiff, tiffHasGps, size } from '../lib/amcaso-wbw-media.js';
import { jpegIccSegments, jpegScanPayload, readXmpFields } from '../lib/photo-meta.js';

const DIR = dirname(fileURLToPath(import.meta.url));
const G = join(DIR, 'fixtures', 'amcaso-golden');
const inputs = JSON.parse(readFileSync(join(G, 'inputs.json'), 'utf8'));
const golden = JSON.parse(readFileSync(join(G, 'python-0.3.2.json'), 'utf8'));
const photo = name => readFileSync(join(DIR, 'fixtures', 'photos', name));
const sha = b => createHash('sha256').update(b).digest('hex');

for (const c of inputs) {
  test(`names and copy match Python amcasoWBW: ${c.name}`, () => {
    const want = golden.text.find(t => t.name === c.name);
    const plan = planListing(c.input);
    assert.equal(plan.facts_fp, want.facts_fp);
    assert.equal(plan.seo_title, want.seo_title);
    assert.equal(plan.seo_description, want.seo_description);
    assert.equal(plan.credit, want.credit);
    assert.equal(plan.listing_slug, want.listing_slug);
    assert.deepEqual(plan.facts.flags, want.flags);
    assert.deepEqual(plan.facts.omitted, want.omitted);
    const taken = new Set();
    const images = want.images.map(w => ({ n: w.n, filename: plan.fileName(w.n, taken, '.jpg'), ...plan.photo(w.n), keywords: plan.keywords }));
    assert.deepEqual(images, want.images);
  });
}

for (const m of golden.media) {
  test(`prepared bytes are identical to Python amcasoWBW: ${m.name}`, async () => {
    const src = photo(m.name);
    const got = await prepareWbwImage(src, golden.meta);
    assert.equal(sha(got.image), m.sha256);
    assert.equal(got.format, m.format);
    assert.equal(got.width, m.width);
    assert.equal(got.height, m.height);
    assert.equal(got.orientation, m.orientation);
    assert.deepEqual(got.warnings, m.warnings);
  });
}

test('JPEG prep keeps scan data and ICC, writes XMP + IPTC, never re-encodes', async () => {
  const src = photo('cmyk.jpg');
  const { image } = await prepareWbwImage(src, golden.meta);
  assert.deepEqual(jpegScanPayload(image), jpegScanPayload(src));
  assert.deepEqual(jpegIccSegments(image), jpegIccSegments(src));
  const x = readXmpFields(image);
  assert.equal(x.title, golden.meta.title.replace(/&/g, '&amp;'));
  assert.ok(image.includes(Buffer.from('Photoshop 3.0\0')));
});

// Minimal EXIF with a GPS IFD (two entries, one rational value outside the entry).
function exifWithGps() {
  const t = Buffer.alloc(80);
  t.write('II', 0, 'latin1'); t.writeUInt16LE(42, 2); t.writeUInt32LE(8, 4);
  t.writeUInt16LE(2, 8); // IFD0: orientation + GPS pointer
  t.writeUInt16LE(0x0112, 10); t.writeUInt16LE(3, 12); t.writeUInt32LE(1, 14); t.writeUInt16LE(6, 18);
  t.writeUInt16LE(0x8825, 22); t.writeUInt16LE(4, 24); t.writeUInt32LE(1, 26); t.writeUInt32LE(38, 30);
  t.writeUInt32LE(0, 34);
  t.writeUInt16LE(2, 38); // GPS IFD
  t.writeUInt16LE(1, 40); t.writeUInt16LE(2, 42); t.writeUInt32LE(2, 44); t.write('N\0', 48, 'latin1');
  t.writeUInt16LE(2, 52); t.writeUInt16LE(5, 54); t.writeUInt32LE(1, 56); t.writeUInt32LE(68, 60);
  t.writeUInt32LE(0, 64); t.writeUInt32LE(4012345, 68); t.writeUInt32LE(100000, 72);
  return t;
}

test('EXIF GPS is removed in place; orientation and everything else stay', async () => {
  const tiff = exifWithGps();
  assert.equal(tiffHasGps(tiff), true);
  const { tiff: clean, gps } = stripGpsTiff(tiff);
  assert.equal(gps, true);
  assert.equal(tiffHasGps(clean), false);
  assert.equal(clean.readUInt32LE(68), 0);
  assert.equal(clean.readUInt16LE(18), 6);
  const src = photo('tiny.jpg');
  const app1 = Buffer.concat([Buffer.from([0xff, 0xe1, 0, 0]), Buffer.from('Exif\0\0'), tiff]);
  app1.writeUInt16BE(app1.length - 2, 2);
  const withGps = Buffer.concat([src.subarray(0, 2), app1, src.subarray(2)]);
  assert.equal(hasGps(withGps), true);
  const out = await prepareWbwImage(withGps, golden.meta);
  assert.equal(out.gps_stripped, true);
  assert.equal(hasGps(out.image), false);
  assert.equal(out.orientation, 6);
  assert.deepEqual(jpegScanPayload(out.image), jpegScanPayload(withGps));
});

test('still GIF and BMP keep original bytes and pixel size', async () => {
  const sharp = (await import('sharp')).default;
  const gif = await sharp({ create: { width: 1200, height: 1000, channels: 3, background: '#8b4513' } }).gif().toBuffer();
  const g = await prepareWbwImage(gif, golden.meta);
  assert.equal(g.format, 'gif');
  assert.equal(g.converted, false);
  assert.equal(g.metadata_written, false);
  assert.equal(g.image.equals(gif), true);
  assert.deepEqual([g.width, g.height], [1200, 1000]);
  assert.match(g.warnings.join(' '), /GIF kept as original/);
  const w = 3, h = 2, row = 12, bmp = Buffer.alloc(54 + row * h);
  bmp.write('BM', 0, 'latin1'); bmp.writeUInt32LE(bmp.length, 2); bmp.writeUInt32LE(54, 10); bmp.writeUInt32LE(40, 14);
  bmp.writeInt32LE(w, 18); bmp.writeInt32LE(h, 22); bmp.writeUInt16LE(1, 26); bmp.writeUInt16LE(24, 28);
  const b = await prepareWbwImage(bmp, golden.meta);
  assert.equal(b.format, 'bmp');
  assert.equal(b.converted, false);
  assert.equal(b.image.equals(bmp), true);
  assert.deepEqual([b.width, b.height], [3, 2]);
});

test('an optimized JPEG keeps the source pixel dimensions', async () => {
  const sharp = (await import('sharp')).default;
  const wide = await sharp({ create: { width: 2400, height: 1800, channels: 3, background: '#8b4513' } }).jpeg().toBuffer();
  const { jpegScanPayload } = await import('../lib/photo-meta.js');
  const out = await prepareWbwImage(wide, golden.meta);
  assert.deepEqual([out.width, out.height], [2400, 1800]);
  assert.deepEqual(size(out.image), { width: 2400, height: 1800, components: 3 });
  assert.deepEqual(jpegScanPayload(out.image), jpegScanPayload(wide));
  assert.equal(out.converted, false);
});

test('runEngine reports an unreadable photo as an error and returns no file for it', async () => {
  const c = inputs.find(x => x.name === 'guessed');
  const { result, files } = await runEngine(c.input, [{ n: 1, bytes: photo('prepared-lucchese.jpg') }, { n: 2, error: 'blocked' }]);
  assert.equal(result.ok, false);
  assert.deepEqual(result.errors, ['photo 2: blocked']);
  assert.equal(files.length, 1);
});

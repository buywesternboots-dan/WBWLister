import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { appliedAmcaso, storePreparedPhotos, undoPreparedPhotos, qualityWarnings, SMALL_FILE_BYTES } from '../lib/amcaso-wbw.js';
import { exportRecord } from '../lib/export.js';
import { withXmp } from '../lib/seo.js';
import { countXmpPackets, imageSize, jpegIccSegments, jpegScanPayload, readXmpFields, sniffFormat } from '../lib/photo-meta.js';

const FIX = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'photos');
const load = name => readFileSync(join(FIX, name));

const AMCASO_TITLE = 'Lucchese 0123 side';
const AMCASO_DESC = 'Lucchese 0123 goat cowboy boots, side view';
const AMCASO_KW = ['Lucchese', '0123', 'goat'];

const itemBase = {
  id: 44,
  seller: 'ada',
  brand: 'Lucchese',
  boot: 'boot',
  size: '9',
  width: 'AAA',
  verified: ['brand', 'size', 'width'],
  guessed: [],
  title: 'Lucchese cowboy boots',
  description: 'Worn goat boots.',
  photos: ['https://cdn.example/source-a.jpg', 'https://cdn.example/source-b.jpg'],
};

function resultFor(images) {
  return {
    ok: true,
    tool: 'amcasoWBW',
    version: '0.3.1',
    facts_fp: 'abc123',
    seo_title: 'Lucchese 0123 cowboy boots',
    seo_description: 'Lucchese 0123 goat cowboy boots size 9.',
    credit: 'Ada via westernbootworld.com',
    images,
    warnings: images.flatMap(im => im.warnings || []),
  };
}

function memoryPut() {
  const blobs = new Map();
  const putFn = async (path, body, opt) => {
    assert.equal(opt.access, 'public');
    assert.equal(path.startsWith('prepared/'), true, path);
    assert.equal(path.includes('photos/'), false);
    const url = `https://store.test/${path}`;
    blobs.set(url, Buffer.from(body));
    return { url };
  };
  putFn.blobs = blobs;
  return putFn;
}

test('stored photos are the prepared file bytes, not the source or a thumbnail', async () => {
  const prepared = load('prepared-lucchese.jpg');
  const png = load('prepared-side.png');
  const put = memoryPut();
  const item = { ...itemBase };
  const result = resultFor([
    { n: 1, filename: 'lucchese-0123-cowboy-boots-1.jpg', alt: 'side', title: AMCASO_TITLE, width: 1200, height: 1200, format: 'jpeg' },
    { n: 2, filename: 'lucchese-0123-cowboy-boots-2.png', alt: 'pair', title: AMCASO_TITLE, width: 1200, height: 800, format: 'png' },
  ]);
  const stored = await storePreparedPhotos(item, result, [
    { n: 1, filename: 'lucchese-0123-cowboy-boots-1.jpg', bytes: prepared },
    { n: 2, filename: 'lucchese-0123-cowboy-boots-2.png', bytes: png },
  ], put, { now: '2026-11-17T10:13:00.000Z' });

  assert.equal(stored.photos.length, 2);
  assert.deepEqual(put.blobs.get(stored.photos[0]), prepared);
  assert.deepEqual(put.blobs.get(stored.photos[1]), png);
  assert.deepEqual(stored.asmowbw.original_photos, item.photos);
  assert.equal(stored.asmowbw.images[0].stored_url, stored.photos[0]);
  assert.equal(stored.asmowbw.images[1].stored_url, stored.photos[1]);
  assert.equal(stored.asmowbw.images[0].original_url, item.photos[0]);
  const live = { ...item, photos: stored.photos, asmowbw: stored.asmowbw };
  assert.ok(appliedAmcaso(live));
  const row = exportRecord(live, { origin: 'https://bootlister.test' });
  assert.equal(row.photos[0], 'https://bootlister.test/img/44/1/lucchese-0123-cowboy-boots-1.jpg');
  assert.equal(row.photos[1], 'https://bootlister.test/img/44/2/lucchese-0123-cowboy-boots-2.png');
  assert.equal(row.seo_title, 'Lucchese 0123 cowboy boots');
  const undone = undoPreparedPhotos(live);
  assert.deepEqual(undone.photos, item.photos);
  assert.equal(undone.asmowbw, null);
});

test('/img output keeps dimensions, ICC, and amcasoWBW metadata instead of clobbering them', () => {
  const prepared = load('prepared-lucchese.jpg');
  const item = {
    ...itemBase,
    photos: ['https://store.test/prepared/44/1/lucchese-0123-cowboy-boots-1.jpg'],
    material: 'Alligator',
    guessed: ['material'],
  };
  const before = readXmpFields(prepared);
  assert.equal(before.title, AMCASO_TITLE);
  assert.equal(before.description, AMCASO_DESC);
  assert.deepEqual(before.keywords, AMCASO_KW);
  const size = imageSize(prepared);
  const icc = jpegIccSegments(prepared);
  assert.equal(size.width, 1200);
  assert.equal(size.height, 1200);
  assert.ok(icc.length);

  const out = withXmp(prepared, item, 1);
  assert.deepEqual(out, prepared);
  assert.equal(countXmpPackets(out), 1);
  assert.deepEqual(jpegScanPayload(out), jpegScanPayload(prepared));
  assert.deepEqual(jpegIccSegments(out), icc);
  assert.deepEqual(imageSize(out), size);
  const after = readXmpFields(out);
  assert.equal(after.title, AMCASO_TITLE);
  assert.equal(after.description, AMCASO_DESC);
  assert.deepEqual(after.keywords, AMCASO_KW);
  assert.equal(after.title.includes('Alligator'), false);
  assert.equal(String(after.keywords).includes('Alligator'), false);
});

test('a photo with no metadata still receives BootLister XMP once, without a second packet', () => {
  const raw = load('tiny.jpg');
  assert.equal(countXmpPackets(raw), 0);
  const item = { ...itemBase, photos: ['https://cdn.example/tiny.jpg'] };
  const out = withXmp(raw, item, 1);
  assert.equal(countXmpPackets(out), 1);
  assert.deepEqual(jpegScanPayload(out), jpegScanPayload(raw));
  const xmp = readXmpFields(out);
  assert.match(xmp.title, /Lucchese/);
  assert.match(xmp.title, /AAA/);
  assert.equal(xmp.title.includes('Alligator'), false);
});

test('odd seller inputs stay native: tiny, PNG, WebP, portrait, EXIF-rotated, and CMYK', async () => {
  const files = {
    tiny: load('tiny.jpg'),
    png: load('prepared-side.png'),
    webp: load('prepared-landscape.webp'),
    portrait: load('portrait.png'),
    rotated: load('rotated.jpg'),
    cmyk: load('cmyk.jpg'),
  };
  assert.equal(sniffFormat(files.png), 'png');
  assert.equal(sniffFormat(files.webp), 'webp');
  assert.equal(sniffFormat(files.cmyk), 'jpeg');
  assert.deepEqual(imageSize(files.tiny), { width: 200, height: 180 });
  assert.deepEqual(imageSize(files.png), { width: 1200, height: 800 });
  assert.deepEqual(imageSize(files.webp), { width: 1600, height: 900 });
  assert.deepEqual(imageSize(files.portrait), { width: 800, height: 1400 });
  assert.deepEqual(imageSize(files.rotated), { width: 1500, height: 1000 });
  assert.deepEqual(imageSize(files.cmyk), { width: 1200, height: 1100 });
  assert.ok(files.tiny.length < SMALL_FILE_BYTES);
  assert.ok(qualityWarnings(files.tiny, 200, 180).some(w => w.includes('under 1000 px')));
  assert.ok(qualityWarnings(files.tiny, 200, 180).some(w => w.includes('very small')));

  // PNG and WebP already prepared: /img must pass them through, keep pixels/size, and keep amcaso XMP.
  for (const name of ['png', 'webp']) {
    const src = files[name];
    const out = withXmp(src, itemBase, 1);
    assert.deepEqual(out, src);
    assert.equal(countXmpPackets(out), 1);
    assert.deepEqual(imageSize(out), imageSize(src));
    assert.equal(readXmpFields(out).title, AMCASO_TITLE);
  }

  // Portrait PNG without metadata: write native XMP, do not convert to JPEG.
  const portraitOut = withXmp(files.portrait, itemBase, 1);
  assert.equal(sniffFormat(portraitOut), 'png');
  assert.equal(countXmpPackets(portraitOut), 1);
  assert.deepEqual(imageSize(portraitOut), { width: 800, height: 1400 });
  assert.match(readXmpFields(portraitOut).title, /Lucchese/);

  // EXIF-rotated JPEG: stored dimensions stay 1500x1000 (pixels not rotated); scan and ICC kept.
  const rotatedOut = withXmp(files.rotated, itemBase, 1);
  assert.deepEqual(imageSize(rotatedOut), { width: 1500, height: 1000 });
  assert.deepEqual(jpegScanPayload(rotatedOut), jpegScanPayload(files.rotated));
  assert.deepEqual(jpegIccSegments(rotatedOut), jpegIccSegments(files.rotated));
  assert.equal(countXmpPackets(rotatedOut), 1);

  // CMYK JPEG: scan and ICC kept, still JPEG after withXmp.
  const cmykOut = withXmp(files.cmyk, itemBase, 1);
  assert.equal(sniffFormat(cmykOut), 'jpeg');
  assert.deepEqual(imageSize(cmykOut), { width: 1200, height: 1100 });
  assert.deepEqual(jpegScanPayload(cmykOut), jpegScanPayload(files.cmyk));
  assert.deepEqual(jpegIccSegments(cmykOut), jpegIccSegments(files.cmyk));

  const put = memoryPut();
  const mixed = {
    ...itemBase,
    photos: ['https://cdn.example/t.jpg', 'https://cdn.example/p.png', 'https://cdn.example/w.webp', 'https://cdn.example/port.png', 'https://cdn.example/r.jpg', 'https://cdn.example/c.jpg'],
  };
  const result = resultFor([
    { n: 1, filename: 'tiny-1.jpg', width: 200, height: 180, format: 'jpeg', warnings: qualityWarnings(files.tiny, 200, 180) },
    { n: 2, filename: 'side-2.png', width: 1200, height: 800, format: 'png' },
    { n: 3, filename: 'landscape-3.webp', width: 1600, height: 900, format: 'webp' },
    { n: 4, filename: 'portrait-4.png', width: 800, height: 1400, format: 'png', warnings: qualityWarnings(files.portrait, 800, 1400) },
    { n: 5, filename: 'rotated-5.jpg', width: 1500, height: 1000, format: 'jpeg', orientation: 6 },
    { n: 6, filename: 'cmyk-6.jpg', width: 1200, height: 1100, format: 'jpeg', color_mode: 'CMYK' },
  ]);
  const stored = await storePreparedPhotos(mixed, result, [
    { n: 1, filename: 'tiny-1.jpg', bytes: files.tiny },
    { n: 2, filename: 'side-2.png', bytes: files.png },
    { n: 3, filename: 'landscape-3.webp', bytes: files.webp },
    { n: 4, filename: 'portrait-4.png', bytes: files.portrait },
    { n: 5, filename: 'rotated-5.jpg', bytes: files.rotated },
    { n: 6, filename: 'cmyk-6.jpg', bytes: files.cmyk },
  ], put);
  assert.equal(stored.photos.length, 6);
  assert.deepEqual(put.blobs.get(stored.photos[0]), files.tiny);
  assert.deepEqual(put.blobs.get(stored.photos[2]), files.webp);
  assert.deepEqual(put.blobs.get(stored.photos[5]), files.cmyk);
  assert.ok(stored.asmowbw.warnings.some(w => w.includes('under 1000 px')));
  const live = { ...mixed, photos: stored.photos, asmowbw: stored.asmowbw };
  const row = exportRecord(live, { origin: 'https://bootlister.test' });
  assert.equal(row.photos[2], 'https://bootlister.test/img/44/3/landscape-3.webp');
  assert.equal(row.photos[5], 'https://bootlister.test/img/44/6/cmyk-6.jpg');
});

test('storePreparedPhotos refuses to run without a put function so tests never hit Blob or R2', async () => {
  await assert.rejects(() => storePreparedPhotos(itemBase, resultFor([{ n: 1, filename: 'a.jpg' }]), [{ n: 1, bytes: load('tiny.jpg') }]), /put function/i);
});

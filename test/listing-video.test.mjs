import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ASPECTS, DEFAULT_ASPECT, MAX_PHOTOS, PHOTO_MS, FADE_MS,
  buildTimeline, canvasSize, clipOpacity, clipsAt, coverRect, easeInOut,
  kenBurnsAt, kenBurnsRange, listingPhotoUrl, listingVideoSources,
  pickRecorderMime, selectPhotos, videoExtension, videoFileName,
} from '../lib/listing-video.js';

describe('photo selection', () => {
  it('keeps at most six non-empty photo urls, in order', () => {
    const photos = ['a', '', '  ', null, 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
    assert.deepEqual(selectPhotos(photos), ['a', 'b', 'c', 'd', 'e', 'f']);
    assert.equal(selectPhotos(photos).length, MAX_PHOTOS);
    assert.deepEqual(selectPhotos(null), []);
    assert.deepEqual(selectPhotos(undefined), []);
  });

  it('builds same-origin /img/ urls from the listing id and photo index', () => {
    const item = { id: 42, photos: ['https://cdn.example/a.jpg', 'https://blob.vercel-storage.com/b.jpg'] };
    assert.equal(listingPhotoUrl('https://bootlister.example', item, 1), 'https://bootlister.example/img/42/1/photo.jpg');
    assert.equal(listingPhotoUrl('https://bootlister.example/', item, 2), 'https://bootlister.example/img/42/2/photo.jpg');
    assert.deepEqual(listingVideoSources(item, 'https://bootlister.example'), [
      'https://bootlister.example/img/42/1/photo.jpg',
      'https://bootlister.example/img/42/2/photo.jpg',
    ]);
    assert.equal(listingPhotoUrl('', { id: 1 }, 1), '/img/1/1/photo.jpg');
    assert.equal(listingPhotoUrl('https://x', {}, 1), null);
  });
});

describe('timeline and Ken Burns keyframes', () => {
  it('defaults to a 1080 square canvas and exposes a 9:16 option', () => {
    assert.equal(DEFAULT_ASPECT, 'square');
    assert.deepEqual(canvasSize(), { width: 1080, height: 1080, label: 'Square' });
    assert.deepEqual(canvasSize('9:16'), { width: 1080, height: 1920, label: '9:16' });
    assert.deepEqual(canvasSize('nope'), ASPECTS.square);
    assert.equal(buildTimeline(2, { aspect: '9:16' }).height, 1920);
  });

  it('gives one photo 2.5s with no fade', () => {
    const t = buildTimeline(1);
    assert.equal(t.durationMs, PHOTO_MS);
    assert.equal(t.clips.length, 1);
    assert.equal(t.clips[0].fadeInMs, 0);
    assert.equal(t.clips[0].fadeOutMs, 0);
    assert.equal(t.width, 1080);
    assert.equal(t.height, 1080);
  });

  it('fits six photos in a 10-15s video with overlapping crossfades', () => {
    const t = buildTimeline(6);
    assert.equal(t.clips.length, 6);
    assert.equal(t.durationMs, 6 * PHOTO_MS - 5 * FADE_MS);
    assert.ok(t.durationMs >= 10000 && t.durationMs <= 15000, t.durationMs);
    for (let i = 0; i < 5; i++) {
      assert.equal(t.clips[i].endMs - t.clips[i + 1].startMs, FADE_MS);
      assert.equal(t.clips[i].fadeOutMs, FADE_MS);
      assert.equal(t.clips[i + 1].fadeInMs, FADE_MS);
    }
    assert.equal(t.clips[0].fadeInMs, 0);
    assert.equal(t.clips[5].fadeOutMs, 0);
  });

  it('returns no clips when there are no photos', () => {
    assert.deepEqual(buildTimeline(0).clips, []);
    assert.equal(buildTimeline(0).durationMs, 0);
  });

  it('crossfades at half opacity in the middle of a fade', () => {
    const t = buildTimeline(2);
    const mid = t.clips[1].startMs + FADE_MS / 2;
    const active = clipsAt(t, mid);
    assert.equal(active.length, 2);
    assert.equal(active[0].index, 0);
    assert.equal(active[1].index, 1);
    assert.ok(Math.abs(active[0].opacity - 0.5) < 1e-9);
    assert.ok(Math.abs(active[1].opacity - 0.5) < 1e-9);
    assert.equal(clipOpacity(t.clips[0], mid) + clipOpacity(t.clips[1], mid), 1);
  });

  it('interpolates Ken Burns scale and pan from start to end', () => {
    const range = kenBurnsRange(0);
    assert.deepEqual(kenBurnsAt(range, 0), range.from);
    assert.deepEqual(kenBurnsAt(range, 1), range.to);
    const mid = kenBurnsAt(range, 0.5);
    assert.equal(mid.scale, (range.from.scale + range.to.scale) / 2);
    assert.notDeepEqual(kenBurnsRange(0), kenBurnsRange(1));
    assert.ok(easeInOut(0.5) === 0.5);
    assert.ok(easeInOut(0.25) < 0.25);
    assert.ok(easeInOut(0.75) > 0.75);
  });

  it('covers the canvas and zooms past the edges when scale is greater than 1', () => {
    const fit = coverRect(2000, 1000, 1080, 1080, { scale: 1, x: 0, y: 0 });
    assert.ok(fit.dw >= 1080 && fit.dh >= 1080);
    assert.equal(fit.dh, 1080);
    const zoom = coverRect(2000, 1000, 1080, 1080, { scale: 1.12, x: 0, y: 0 });
    assert.ok(zoom.dw > fit.dw && zoom.dh > fit.dh);
    const pan = coverRect(2000, 1000, 1080, 1080, { scale: 1.12, x: 1, y: 0 });
    assert.ok(pan.dx > zoom.dx);
  });
});

describe('recorder mime and file name', () => {
  it('prefers mp4 when the browser supports it, otherwise webm', () => {
    assert.equal(pickRecorderMime(t => t === 'video/mp4'), 'video/mp4');
    assert.equal(pickRecorderMime(t => t.startsWith('video/webm')), 'video/webm;codecs=vp9');
    assert.equal(pickRecorderMime(() => false), '');
    assert.equal(videoExtension('video/mp4'), 'mp4');
    assert.equal(videoExtension('video/webm;codecs=vp8'), 'webm');
    assert.equal(videoFileName({ title: 'Lucchese 1883 boots' }, 'video/mp4'), 'lucchese-1883-boots-video.mp4');
    assert.equal(videoFileName({ id: 9 }, 'video/webm'), '9-video.webm');
  });
});

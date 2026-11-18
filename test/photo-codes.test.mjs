import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyPhotoText, photoCodePatch, readPhotoCodes } from '../lib/photo-codes.js';
import { recognizePhoto } from '../lib/ocr.js';

test('photo text becomes unverified candidates and does not look like a listing field', () => {
  const codes = classifyPhotoText('Style 09050\n10.5 D\nWidth EE\nSerial 00421\n03/12/98\nFactory 7\nL4481', 2);
  const by = type => codes.filter(c => c.type === type).map(c => c.text);
  assert.deepEqual(by('style'), ['09050']);
  assert.ok(by('size').includes('10.5 D'));
  assert.ok(by('width').includes('D'));
  assert.ok(by('width').includes('EE'));
  assert.deepEqual(by('serial'), ['00421', '03/12/98']);
  assert.ok(by('other').includes('7') || by('other').includes('L4481'));
  for (const c of codes) {
    assert.equal(c.photo, 2);
    assert.equal(c.from_photo, true);
    assert.equal(c.verified, false);
  }
  assert.equal(codes.find(c => c.type === 'style').text, '09050');
  assert.notEqual(codes.find(c => c.type === 'style').text, '9050');
});

test('a second photo is kept apart, and OCR is mocked', async () => {
  const photos = ['https://example.com/insole.jpg', 'https://example.com/box.jpg'];
  const seen = [];
  const codes = await readPhotoCodes(photos, async (url, n) => {
    seen.push([url, n]);
    if (n === 1) return '9 EE\nmodel #0030';
    if (n === 2) throw new Error('blurry');
    return '';
  });
  assert.deepEqual(seen, [[photos[0], 1], [photos[1], 2]]);
  assert.equal(codes.find(c => c.type === 'style')?.text, '0030');
  assert.equal(codes.find(c => c.type === 'size')?.text, '9 EE');
  assert.ok(codes.every(c => c.photo === 1 && c.from_photo === true && c.verified === false));
  const item = { size: '10', width: 'D', id_text: '1883', title: 'Boots' };
  const next = { ...item, ...photoCodePatch(codes) };
  assert.equal(next.size, '10');
  assert.equal(next.width, 'D');
  assert.equal(next.id_text, '1883');
  assert.equal(next.photo_codes.length, codes.length);
  assert.deepEqual(Object.keys(photoCodePatch(codes)), ['photo_codes']);
});

test('the free reader stays quiet when no key is set and tesseract is not invoked for an empty list', async () => {
  const prev = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  assert.equal(typeof recognizePhoto, 'function');
  const codes = await readPhotoCodes([], recognizePhoto);
  assert.deepEqual(codes, []);
  if (prev) process.env.GEMINI_API_KEY = prev;
});

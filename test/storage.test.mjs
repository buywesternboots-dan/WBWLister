import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'crypto';
import { HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { copyPhoto, isOurs, photoKey, r2ClientOptions, r2Config, storePhoto } from '../lib/storage.js';

const KEYS = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET', 'R2_PUBLIC_BASE_URL', 'R2_ENDPOINT'];
const ENV = {
  R2_ACCOUNT_ID: 'acct123',
  R2_ACCESS_KEY_ID: 'key',
  R2_SECRET_ACCESS_KEY: 'secret',
  R2_BUCKET: 'wbw-photos',
  R2_PUBLIC_BASE_URL: 'https://pub-abc.r2.dev/',
};

async function withEnv(vals, fn) {
  const prev = new Map(KEYS.map(k => [k, process.env[k]]));
  for (const k of KEYS) delete process.env[k];
  Object.assign(process.env, vals);
  try { return await fn(); }
  finally {
    for (const [k, v] of prev) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

function mockS3(have = new Set()) {
  const calls = [];
  return {
    calls,
    async send(cmd) {
      calls.push(cmd);
      if (cmd instanceof HeadObjectCommand) {
        if (!have.has(cmd.input.Key)) {
          const err = new Error('NotFound');
          err.name = 'NotFound';
          err.$metadata = { httpStatusCode: 404 };
          throw err;
        }
        return {};
      }
      if (cmd instanceof PutObjectCommand) { have.add(cmd.input.Key); return {}; }
      throw new Error(`unexpected ${cmd.constructor.name}`);
    },
  };
}

const jpeg = Buffer.from('boot-photo-bytes');
const hash = buf => createHash('sha256').update(buf).digest('hex');
const fetched = (body, status = 200, type = 'image/jpeg') => async () => ({
  ok: status >= 200 && status < 300, status,
  headers: { get: h => (h.toLowerCase() === 'content-type' ? type : null) },
  arrayBuffer: async () => Uint8Array.from(body).buffer,
});

test('key is photos/<sha256>.<ext> from the bytes and content type', () => {
  assert.equal(photoKey(jpeg, 'image/jpeg'), `photos/${hash(jpeg)}.jpg`);
  assert.equal(photoKey(jpeg, 'image/png; charset=binary'), `photos/${hash(jpeg)}.png`);
  assert.equal(photoKey(jpeg, 'application/octet-stream'), `photos/${hash(jpeg)}.jpg`);
  assert.notEqual(photoKey(Buffer.from('other'), 'image/jpeg'), photoKey(jpeg, 'image/jpeg'));
});

test('upload stores the object once and returns the public URL', async () => {
  await withEnv(ENV, async () => {
    const s3 = mockS3();
    const url = await copyPhoto('https://cdn.example/a.jpg', { n: 2, fetch: fetched(jpeg, 200, 'image/png; charset=binary'), client: s3 });
    const key = `photos/${hash(jpeg)}.png`;
    assert.equal(url, `https://pub-abc.r2.dev/${key}`);
    const put = s3.calls.find(c => c instanceof PutObjectCommand);
    assert.equal(put.input.Bucket, 'wbw-photos');
    assert.equal(put.input.Key, key);
    assert.equal(put.input.ContentType, 'image/png');
    assert.deepEqual(Buffer.from(put.input.Body), jpeg);
    const again = await copyPhoto('https://cdn.example/a.jpg?changed=1', { fetch: fetched(jpeg, 200, 'image/png'), client: s3 });
    assert.equal(again, url);
    assert.equal(s3.calls.filter(c => c instanceof PutObjectCommand).length, 1);
  });
});

test('missing or partial R2 env keeps the source URL and does not upload', async () => {
  const src = 'https://facebook.com/photo.jpg';
  await withEnv({}, async () => {
    let fetchedOnce = false;
    const url = await copyPhoto(src, { fetch: async () => { fetchedOnce = true; } });
    assert.equal(url, src);
    assert.equal(fetchedOnce, false);
    assert.equal(await storePhoto(jpeg, 'image/jpeg'), null);
    assert.equal(r2Config(), null);
  });
  await withEnv({ ...ENV, R2_BUCKET: '  ' }, async () => {
    assert.equal(r2Config(), null);
    assert.equal(await copyPhoto(src, { force: true, fetch: async () => { throw new Error('should not fetch'); } }), src);
  });
});

test('legacy Blob URLs and current R2 URLs are not uploaded again', async () => {
  await withEnv(ENV, async () => {
    const blob = 'https://abc.blob.vercel-storage.com/photos/old.jpg';
    const r2 = `https://pub-abc.r2.dev/photos/${hash(jpeg)}.jpg`;
    assert.equal(isOurs(blob), true);
    assert.equal(isOurs(r2), true);
    assert.equal(isOurs('https://pub-abc.r2.dev.evil.example/photos/x.jpg'), false);
    assert.equal(await copyPhoto(blob, { fetch: async () => { throw new Error('should not fetch'); } }), blob);
    assert.equal(await copyPhoto(r2, { fetch: async () => { throw new Error('should not fetch'); } }), r2);
    const s3 = mockS3();
    const moved = await copyPhoto(blob, { force: true, fetch: fetched(jpeg), client: s3 });
    assert.equal(moved, `https://pub-abc.r2.dev/photos/${hash(jpeg)}.jpg`);
    assert.equal(s3.calls.filter(c => c instanceof PutObjectCommand).length, 1);
  });
});

test('a failed download fails the import when R2 is configured', async () => {
  await withEnv(ENV, async () => {
    await assert.rejects(copyPhoto('https://cdn.example/gone.jpg', { n: 4, fetch: fetched(jpeg, 404), client: mockS3() }),
      /Photo 4 didn't import \(HTTP 404\)/);
  });
});

test('S3 client targets the R2 endpoint and skips default checksums', () => {
  const cfg = {
    accountId: 'acct123', accessKeyId: 'key', secretAccessKey: 'secret', bucket: 'wbw-photos',
    publicBaseUrl: 'https://pub-abc.r2.dev', endpoint: 'https://acct123.r2.cloudflarestorage.com',
  };
  const opts = r2ClientOptions(cfg);
  assert.equal(opts.region, 'auto');
  assert.equal(opts.endpoint, 'https://acct123.r2.cloudflarestorage.com');
  assert.equal(opts.requestChecksumCalculation, 'WHEN_REQUIRED');
  assert.equal(opts.responseChecksumValidation, 'WHEN_REQUIRED');
  assert.equal(opts.credentials.accessKeyId, 'key');
});

test('optional R2_ENDPOINT overrides the account endpoint', async () => {
  await withEnv({ ...ENV, R2_ENDPOINT: 'https://acct123.eu.r2.cloudflarestorage.com/' }, async () => {
    assert.equal(r2Config().endpoint, 'https://acct123.eu.r2.cloudflarestorage.com');
    assert.equal(r2Config().publicBaseUrl, 'https://pub-abc.r2.dev');
  });
});

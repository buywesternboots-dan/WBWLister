import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'crypto';
import { readFileSync } from 'node:fs';
import { HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { copyPhoto, imageType, isBlobUrl, isBlockedIp, isOurs, LIMITS, photoKey, r2ClientOptions, r2Config, storePhoto } from '../lib/storage.js';

const KEYS = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET', 'R2_PUBLIC_BASE_URL', 'R2_ENDPOINT', 'BLOB_READ_WRITE_TOKEN', 'APP_PASSWORD'];
const ENV = {
  R2_ACCOUNT_ID: 'acct123',
  R2_ACCESS_KEY_ID: 'key',
  R2_SECRET_ACCESS_KEY: 'secret',
  R2_BUCKET: 'wbw-photos',
  R2_PUBLIC_BASE_URL: 'https://pub-abc.r2.dev/',
};
const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('png')]);
const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.from('jpeg')]);
const hash = buf => createHash('sha256').update(buf).digest('hex');
const publicLookup = async () => [{ address: '93.184.216.34', family: 4 }];
const net = { lookup: publicLookup };

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

const headers = type => ({ get: h => (h.toLowerCase() === 'content-type' ? type : h.toLowerCase() === 'location' ? null : null) });
const fetched = (body, status = 200, type = 'image/jpeg') => async () => ({
  ok: status >= 200 && status < 300, status, headers: headers(type),
  arrayBuffer: async () => Uint8Array.from(body).buffer,
});

test('key is photos/<sha256>.<ext> from the bytes and content type', () => {
  assert.equal(photoKey(jpeg, 'image/jpeg'), `photos/${hash(jpeg)}.jpg`);
  assert.equal(photoKey(png, 'image/png; charset=binary'), `photos/${hash(png)}.png`);
  assert.equal(photoKey(jpeg, 'image/webp'), `photos/${hash(jpeg)}.webp`);
  assert.throws(() => photoKey(jpeg, 'application/octet-stream'), /unsupported image type/);
  assert.notEqual(photoKey(Buffer.from('other'), 'image/jpeg'), photoKey(jpeg, 'image/jpeg'));
});

test('upload stores the object once and returns the public URL', async () => {
  await withEnv(ENV, async () => {
    const s3 = mockS3();
    const url = await copyPhoto('https://cdn.example/a.jpg', { n: 2, fetch: fetched(png, 200, 'image/png; charset=binary'), client: s3, ...net });
    const key = `photos/${hash(png)}.png`;
    assert.equal(url, `https://pub-abc.r2.dev/${key}`);
    const put = s3.calls.find(c => c instanceof PutObjectCommand);
    assert.equal(put.input.Bucket, 'wbw-photos');
    assert.equal(put.input.Key, key);
    assert.equal(put.input.ContentType, 'image/png');
    assert.deepEqual(Buffer.from(put.input.Body), png);
    const again = await copyPhoto('https://cdn.example/a.jpg?changed=1', { fetch: fetched(png, 200, 'image/png'), client: s3, ...net });
    assert.equal(again, url);
    assert.equal(s3.calls.filter(c => c instanceof PutObjectCommand).length, 1);
  });
});

test('missing or partial R2 env keeps the source URL and does not upload', async () => {
  const src = 'https://facebook.com/photo.jpg';
  await withEnv({}, async () => {
    let fetchedOnce = false;
    const url = await copyPhoto(src, { fetch: async () => { fetchedOnce = true; }, ...net });
    assert.equal(url, src);
    assert.equal(fetchedOnce, false);
    assert.equal(await storePhoto(jpeg, 'image/jpeg'), null);
    assert.equal(r2Config(), null);
  });
  await withEnv({ ...ENV, R2_BUCKET: '  ' }, async () => {
    assert.equal(r2Config(), null);
    assert.equal(await copyPhoto(src, { force: true, fetch: async () => { throw new Error('should not fetch'); }, ...net }), src);
  });
});

test('hostname match is the Blob host or the R2 origin, not a substring', async () => {
  await withEnv(ENV, async () => {
    const blob = 'https://abc.public.blob.vercel-storage.com/photos/old.jpg';
    const r2 = `https://pub-abc.r2.dev/photos/${hash(jpeg)}.jpg`;
    assert.equal(isBlobUrl(blob), true);
    assert.equal(isOurs(blob), true);
    assert.equal(isOurs(r2), true);
    assert.equal(isBlobUrl('https://abc.blob.vercel-storage.com/photos/old.jpg'), false);
    assert.equal(isBlobUrl('http://abc.public.blob.vercel-storage.com/photos/old.jpg'), false);
    assert.equal(isBlobUrl('https://evil.example/blob.vercel-storage.com/a.jpg'), false);
    assert.equal(isBlobUrl('https://abc.public.blob.vercel-storage.com.evil.example/a.jpg'), false);
    assert.equal(isOurs('https://pub-abc.r2.dev.evil.example/photos/x.jpg'), false);
    assert.equal(isOurs('https://evil.example/?u=https://pub-abc.r2.dev/a.jpg'), false);
    assert.equal(await copyPhoto(blob, { fetch: async () => { throw new Error('should not fetch'); }, ...net }), blob);
    assert.equal(await copyPhoto(r2, { fetch: async () => { throw new Error('should not fetch'); }, ...net }), r2);
    let calls = 0;
    const lookalike = 'https://evil.example/path/blob.vercel-storage.com/a.jpg';
    await assert.rejects(copyPhoto(lookalike, { force: true, fetch: () => { calls += 1; }, lookup: async () => [{ address: '10.0.0.5', family: 4 }] }), /blocked url/);
    assert.equal(calls, 0);
    const s3 = mockS3();
    const moved = await copyPhoto(blob, { force: true, fetch: fetched(jpeg), client: s3, ...net });
    assert.equal(moved, `https://pub-abc.r2.dev/photos/${hash(jpeg)}.jpg`);
    assert.equal(s3.calls.filter(c => c instanceof PutObjectCommand).length, 1);
  });
});

test('private, loopback, and link-local addresses are blocked', () => {
  for (const ip of ['127.0.0.1', '127.0.0.2', '10.1.2.3', '172.16.0.1', '172.31.255.1', '192.168.1.9', '169.254.169.254', '0.0.0.0', '::1', '::', 'fe80::1', 'fd00::1', '::ffff:127.0.0.1', '::ffff:7f00:1'])
    assert.equal(isBlockedIp(ip), true, ip);
  for (const ip of ['8.8.8.8', '93.184.216.34', '1.1.1.1', '2001:4860:4860::8888'])
    assert.equal(isBlockedIp(ip), false, ip);
});

test('downloads allow only public http(s), re-check redirects, and cap hops', async () => {
  await withEnv(ENV, async () => {
    const s3 = mockS3();
    const blocked = async (url, lookup) => {
      let calls = 0;
      await assert.rejects(copyPhoto(url, { fetch: () => { calls += 1; }, lookup, client: s3 }), /blocked url/);
      assert.equal(calls, 0);
    };
    await blocked('file:///etc/passwd', publicLookup);
    await blocked('http://127.0.0.1/latest', publicLookup);
    await blocked('http://169.254.169.254/latest/meta-data', publicLookup);
    await blocked('http://2130706433/', publicLookup);
    await blocked('http://0177.0.0.1/', publicLookup);
    await blocked('http://[::1]/', publicLookup);
    await blocked('https://internal.example/a.jpg', async () => [{ address: '192.168.0.4', family: 4 }]);
    await blocked('https://localhost/a.jpg', publicLookup);
    const hops = [];
    const redirectFetch = async url => {
      hops.push(url);
      if (url === 'https://cdn.example/start') return { status: 302, headers: { get: h => (h.toLowerCase() === 'location' ? 'http://127.0.0.1/secret' : null) }, body: { cancel: async () => {} } };
      return fetched(jpeg)();
    };
    await assert.rejects(copyPhoto('https://cdn.example/start', { fetch: redirectFetch, ...net, client: s3 }), /blocked url/);
    assert.deepEqual(hops, ['https://cdn.example/start']);
    let fetches = 0;
    await assert.rejects(copyPhoto('https://cdn.example/loop', {
      ...net, client: s3,
      fetch: async () => {
        fetches += 1;
        return { status: 302, headers: { get: h => (h.toLowerCase() === 'location' ? 'https://cdn.example/next' : null) }, body: { cancel: async () => {} } };
      },
    }), /too many redirects/);
    assert.equal(fetches, LIMITS.redirects + 1);
  });
});

test('a download stops at 15 MB and at 4 at a time', async () => {
  await withEnv(ENV, async () => {
    const s3 = mockS3();
    let sent = 0;
    const body = new ReadableStream({
      pull(controller) {
        if (sent > LIMITS.bytes) return controller.close();
        const n = 1024 * 1024;
        controller.enqueue(new Uint8Array(n));
        sent += n;
      },
    });
    await assert.rejects(copyPhoto('https://cdn.example/big.jpg', {
      ...net, client: s3,
      fetch: async () => ({ ok: true, status: 200, headers: headers('image/jpeg'), body }),
    }), /over 15 MB/);
    assert.equal(s3.calls.filter(c => c instanceof PutObjectCommand).length, 0);
    let current = 0, max = 0;
    const fetch = async () => {
      current += 1;
      max = Math.max(max, current);
      await new Promise(r => setTimeout(r, 40));
      current -= 1;
      return fetched(jpeg)();
    };
    await Promise.all(Array.from({ length: 8 }, (_, i) => copyPhoto(`https://cdn.example/p${i}.jpg`, { fetch, ...net, client: s3 })));
    assert.equal(max, LIMITS.downloads);
  });
});

test('HTML and JSON are rejected; magic bytes set the stored type', async () => {
  await withEnv(ENV, async () => {
    const s3 = mockS3();
    await assert.rejects(copyPhoto('https://cdn.example/page', { fetch: fetched(Buffer.from('<!DOCTYPE html><html></html>'), 200, 'text/html'), ...net, client: s3 }), /not an image/);
    await assert.rejects(copyPhoto('https://cdn.example/data', { fetch: fetched(Buffer.from('{"a":1}'), 200, 'application/json'), ...net, client: s3 }), /not an image/);
    await assert.rejects(copyPhoto('https://cdn.example/lie', { fetch: fetched(Buffer.from('<html>nope</html>'), 200, 'image/jpeg'), ...net, client: s3 }), /not an image/);
    assert.equal(imageType(jpeg, 'application/octet-stream'), 'image/jpeg');
    assert.equal(imageType(png, 'text/plain'), 'image/png');
    const url = await copyPhoto('https://cdn.example/raw', { fetch: fetched(jpeg, 200, 'application/octet-stream'), ...net, client: s3 });
    assert.equal(url, `https://pub-abc.r2.dev/photos/${hash(jpeg)}.jpg`);
    const put = s3.calls.find(c => c instanceof PutObjectCommand);
    assert.equal(put.input.ContentType, 'image/jpeg');
  });
});

test('Blob is the fallback when R2 is unset and the token is set', async () => {
  const src = 'https://cdn.example/a.jpg';
  await withEnv({ BLOB_READ_WRITE_TOKEN: 'blob-token' }, async () => {
    const puts = [];
    const url = await copyPhoto(src, {
      ...net, fetch: fetched(png, 200, 'image/png'),
      blobPut: async (key, body, opts) => {
        puts.push({ key, body, opts });
        return { url: `https://store.public.blob.vercel-storage.com/${key}` };
      },
    });
    assert.equal(puts.length, 1);
    assert.equal(puts[0].key, `photos/${hash(png)}.png`);
    assert.equal(puts[0].opts.access, 'public');
    assert.equal(puts[0].opts.contentType, 'image/png');
    assert.equal(puts[0].opts.token, 'blob-token');
    assert.equal(url, `https://store.public.blob.vercel-storage.com/${puts[0].key}`);
  });
  await withEnv({ ...ENV, BLOB_READ_WRITE_TOKEN: 'blob-token' }, async () => {
    let blobCalls = 0;
    const s3 = mockS3();
    const url = await copyPhoto(src, { ...net, fetch: fetched(jpeg), client: s3, blobPut: async () => { blobCalls += 1; } });
    assert.equal(blobCalls, 0);
    assert.equal(url, `https://pub-abc.r2.dev/photos/${hash(jpeg)}.jpg`);
  });
});

test('a failed download fails the import when R2 is configured', async () => {
  await withEnv(ENV, async () => {
    await assert.rejects(copyPhoto('https://cdn.example/gone.jpg', { n: 4, fetch: fetched(jpeg, 404), client: mockS3(), ...net }),
      /Photo 4 didn't import \(HTTP 404\)/);
  });
});

test('download times out', async () => {
  await withEnv(ENV, async () => {
    const fetch = (_url, { signal }) => new Promise((_, reject) => {
      signal.addEventListener('abort', () => { const e = new Error('The operation was aborted'); e.name = 'TimeoutError'; reject(e); });
    });
    await assert.rejects(copyPhoto('https://cdn.example/slow.jpg', { fetch, ...net, timeoutMs: 30, client: mockS3() }), /timed out/);
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

test('migrate route checks admin itself', () => {
  const src = readFileSync(new URL('../app/api/migrate-photos/route.js', import.meta.url), 'utf8');
  assert.match(src, /requireAdmin/);
  assert.doesNotMatch(src, /teamOnly/);
});

// Listing photos. Swap this file to change stores. lib/wbw.js uses storageConfigured, copyPhoto, isBlobUrl, and BLOB_HOST.
// Order: Cloudflare R2, then Vercel Blob when BLOB_READ_WRITE_TOKEN is set, then the source URL (import does not fail).
// Downloads go through lib/net.js safeFetch, which pins the connection to the address it already checked.
//
// R2 (all five required): R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_PUBLIC_BASE_URL
//   R2_PUBLIC_BASE_URL is the public origin (https://pub-….r2.dev or a custom domain), no trailing slash.
// Optional: R2_ENDPOINT — S3 API host. Default https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com
// Blob fallback: BLOB_READ_WRITE_TOKEN (used only when R2 is unset).
// Uploads go to the S3 endpoint or the Blob API. The public URL is never used for writes.
import { createHash } from 'crypto';
import { HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { put as blobPut } from '@vercel/blob';
import { safeFetch } from './net';

export const BLOB_HOST = 'public.blob.vercel-storage.com';
export const LIMITS = { bytes: 15 * 1024 * 1024, downloads: 4, timeoutMs: 15000 };
const REQUIRED = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET', 'R2_PUBLIC_BASE_URL'];
const EXT = { 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/pjpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif' };

const trim = v => v?.trim() || '';
const typeOf = contentType => String(contentType || '').split(';')[0].trim().toLowerCase();
const photoError = (n, msg) => new Error(n ? `Photo ${n} didn't import (${msg})` : `Photo didn't import (${msg})`);

export function r2Config(env = process.env) {
  const v = Object.fromEntries(REQUIRED.map(k => [k, trim(env[k])]));
  if (REQUIRED.some(k => !v[k])) return null;
  return {
    accountId: v.R2_ACCOUNT_ID,
    accessKeyId: v.R2_ACCESS_KEY_ID,
    secretAccessKey: v.R2_SECRET_ACCESS_KEY,
    bucket: v.R2_BUCKET,
    publicBaseUrl: v.R2_PUBLIC_BASE_URL.replace(/\/+$/, ''),
    endpoint: (trim(env.R2_ENDPOINT) || `https://${v.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`).replace(/\/+$/, ''),
  };
}

export const blobConfigured = (env = process.env) => !!trim(env.BLOB_READ_WRITE_TOKEN);
export const storageConfigured = (env = process.env) => !!r2Config(env) || blobConfigured(env);

// SDK checksums (default since client-s3 3.729) are not accepted by R2 unless limited to WHEN_REQUIRED.
export function r2ClientOptions(cfg) {
  return {
    region: 'auto',
    endpoint: cfg.endpoint,
    credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  };
}

// photos/<sha256>.<ext> — identical bytes of the same type share one object.
export function photoKey(bytes, contentType) {
  const ext = EXT[typeOf(contentType)];
  if (!ext) throw new Error('unsupported image type');
  return `photos/${createHash('sha256').update(bytes).digest('hex')}.${ext}`;
}

// Public Vercel Blob URLs are https://<store>.public.blob.vercel-storage.com/...
export function isBlobUrl(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') return false;
    const host = u.hostname.toLowerCase().replace(/\.$/, '');
    return host === BLOB_HOST || host.endsWith(`.${BLOB_HOST}`);
  } catch { return false; }
}

function isR2PublicUrl(url, cfg) {
  if (!cfg?.publicBaseUrl) return false;
  let u, b;
  try { u = new URL(url); b = new URL(cfg.publicBaseUrl); }
  catch { return false; }
  if ((u.protocol !== 'https:' && u.protocol !== 'http:') || u.protocol !== b.protocol) return false;
  if (u.hostname.toLowerCase() !== b.hostname.toLowerCase() || u.port !== b.port) return false;
  const basePath = b.pathname.replace(/\/+$/, '');
  return !basePath || u.pathname === basePath || u.pathname.startsWith(`${basePath}/`);
}

export function isOurs(url, cfg = r2Config()) {
  return isBlobUrl(url) || isR2PublicUrl(url, cfg);
}

const SIGNS = [
  ['image/jpeg', b => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff],
  ['image/png', b => b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))],
  ['image/gif', b => b.length >= 6 && (b.subarray(0, 6).toString() === 'GIF87a' || b.subarray(0, 6).toString() === 'GIF89a')],
  ['image/webp', b => b.length >= 12 && b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP'],
  ['image/avif', b => b.length >= 12 && b.subarray(4, 8).toString() === 'ftyp' && /^(avif|avis|mif1)/.test(b.subarray(8, 12).toString())],
];

// Real type from magic bytes. SVG, HTML, and JSON are never stored.
export function imageType(bytes, header) {
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  const declared = typeOf(header);
  if (['text/html', 'application/xhtml+xml', 'application/json', 'text/json', 'image/svg+xml'].includes(declared)) return null;
  const sniffed = SIGNS.find(([, test]) => test(buf));
  if (sniffed) return sniffed[0];
  const start = buf.subarray(0, 64).toString('utf8').trimStart().toLowerCase();
  if (start.startsWith('<') || start.startsWith('{') || start.startsWith('[') || start.includes('<svg')) return null;
  if (declared.startsWith('image/') && EXT[declared]) return EXT[declared] === 'jpg' ? 'image/jpeg' : declared;
  return null;
}

let active = 0;
const waiters = [];
function withDownloadSlot(fn) {
  return new Promise((resolve, reject) => {
    const start = () => {
      active += 1;
      Promise.resolve().then(fn).then(resolve, reject).finally(() => {
        active -= 1;
        waiters.shift()?.();
      });
    };
    if (active < LIMITS.downloads) start();
    else waiters.push(start);
  });
}

function mapFetchError(e, n) {
  if (String(e?.message || '').startsWith('Photo ')) throw e;
  const msg = e?.message || 'download failed';
  if (/timed out/i.test(msg)) throw photoError(n, 'timed out');
  if (/too large/i.test(msg)) throw photoError(n, 'photo is over 15 MB');
  throw photoError(n, msg);
}

// safeFetch checks the address and pins the socket. This adds the size cap, magic bytes, and SVG rejection.
export async function downloadPhoto(url, { n, fetch: doFetch = safeFetch, timeoutMs = LIMITS.timeoutMs } = {}) {
  let got;
  try { got = await doFetch(url, { maxBytes: LIMITS.bytes, timeout: timeoutMs }); }
  catch (e) { mapFetchError(e, n); }
  if (got.status && (got.status < 200 || got.status >= 300)) mapFetchError(new Error(`HTTP ${got.status}`), n);
  const bytes = Buffer.from(got.body);
  if (bytes.length > LIMITS.bytes) mapFetchError(new Error('File is too large.'), n);
  if (!bytes.length) throw photoError(n, 'empty file');
  const contentType = imageType(bytes, got.contentType);
  if (!contentType) throw photoError(n, 'not an image');
  return { bytes, contentType };
}

let cached;
function clientFor(cfg) {
  const id = `${cfg.endpoint}\0${cfg.accessKeyId}\0${cfg.secretAccessKey}`;
  if (cached?.id === id) return cached.client;
  cached = { id, client: new S3Client(r2ClientOptions(cfg)) };
  return cached.client;
}

async function hasObject(s3, bucket, key) {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return true;
  } catch { return false; } // missing, or Head not allowed — Put of the same bytes is safe
}

export async function storePhoto(bytes, contentType, { client, config } = {}) {
  const cfg = config === undefined ? r2Config() : config;
  if (!cfg) return null;
  const key = photoKey(bytes, contentType);
  const s3 = client ?? clientFor(cfg);
  if (!(await hasObject(s3, cfg.bucket, key))) {
    await s3.send(new PutObjectCommand({
      Bucket: cfg.bucket, Key: key, Body: bytes, ContentType: contentType,
      CacheControl: 'public, max-age=31536000, immutable',
    }));
  }
  return `${cfg.publicBaseUrl}/${key}`;
}

async function storeBlob(bytes, contentType, putImpl) {
  const key = photoKey(bytes, contentType);
  const res = await putImpl(key, bytes, {
    access: 'public', contentType, addRandomSuffix: false, allowOverwrite: true,
    token: process.env.BLOB_READ_WRITE_TOKEN, cacheControlMaxAge: 31536000,
  });
  if (!isBlobUrl(res?.url)) throw photoError(undefined, 'blob upload failed');
  return res.url;
}

// Copies one source photo. Already-stored https Blob or R2 URLs are returned unchanged.
// force is only honored for a real Blob hostname (migration onto R2). No store configured → source URL, not fetched.
export async function copyPhoto(src, opts = {}) {
  const cfg = opts.config === undefined ? r2Config() : opts.config;
  if (!src) throw photoError(opts.n, 'no url');
  const migrating = !!opts.force && isBlobUrl(src);
  if (!migrating && isOurs(src, cfg)) return src;
  const useR2 = !!cfg;
  const useBlob = !useR2 && (!!opts.blobPut || blobConfigured());
  if (!useR2 && !useBlob) return src;
  if (migrating && !useR2) return src;
  const { bytes, contentType } = await withDownloadSlot(() => downloadPhoto(src, opts));
  if (useR2) return storePhoto(bytes, contentType, { client: opts.client, config: cfg });
  return storeBlob(bytes, contentType, opts.blobPut ?? blobPut);
}

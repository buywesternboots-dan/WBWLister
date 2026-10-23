// Listing photos. Swap this file to change stores; lib/wbw.js only uses storageConfigured, copyPhoto, and BLOB_HOST.
// Cloudflare R2 over the S3 API. Unset R2 env → copyPhoto keeps the source URL (import does not fail).
//
// Required: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_PUBLIC_BASE_URL
//   R2_PUBLIC_BASE_URL is the public origin images are served from (https://pub-….r2.dev or a custom domain), no trailing slash.
// Optional: R2_ENDPOINT — S3 API host. Default https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com
//   (EU / US / FedRAMP buckets need the jurisdiction host instead.)
// Uploads go to the S3 endpoint. The public URL is never used for writes.
import { createHash } from 'crypto';
import { HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

export const BLOB_HOST = 'blob.vercel-storage.com';
const REQUIRED = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET', 'R2_PUBLIC_BASE_URL'];
const EXT = { 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/pjpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif' };

const trim = v => v?.trim() || '';
const typeOf = contentType => String(contentType || '').split(';')[0].trim().toLowerCase();

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

export const storageConfigured = (env = process.env) => !!r2Config(env);

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

// photos/<sha256>.<ext> — identical bytes share one object.
export function photoKey(bytes, contentType) {
  const hash = createHash('sha256').update(bytes).digest('hex');
  return `photos/${hash}.${EXT[typeOf(contentType)] || 'jpg'}`;
}

export function isOurs(url, cfg = r2Config()) {
  if (typeof url !== 'string') return false;
  if (url.includes(BLOB_HOST)) return true;
  const base = cfg?.publicBaseUrl;
  return !!base && (url === base || url.startsWith(`${base}/`));
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
  } catch {
    return false; // missing, or Head not allowed — Put of the same bytes is safe
  }
}

// Stores bytes. Returns the public URL, or null when R2 is not configured.
export async function storePhoto(bytes, contentType, { client, config } = {}) {
  const cfg = config === undefined ? r2Config() : config;
  if (!cfg) return null;
  const key = photoKey(bytes, contentType);
  const s3 = client ?? clientFor(cfg);
  if (!(await hasObject(s3, cfg.bucket, key))) {
    await s3.send(new PutObjectCommand({
      Bucket: cfg.bucket, Key: key, Body: bytes,
      ContentType: EXT[typeOf(contentType)] ? typeOf(contentType) : 'image/jpeg',
      CacheControl: 'public, max-age=31536000, immutable',
    }));
  }
  return `${cfg.publicBaseUrl}/${key}`;
}

const photoError = (n, msg) => new Error(n ? `Photo ${n} didn't import (${msg})` : `Photo didn't import (${msg})`);

// Copies one source photo onto R2. Already-stored URLs (R2 or legacy Vercel Blob) are returned unchanged
// unless force (blob → R2 migration). Unconfigured → the source URL, and the source is not fetched.
export async function copyPhoto(src, { n, force = false, fetch: doFetch = fetch, client, config } = {}) {
  const cfg = config === undefined ? r2Config() : config;
  if (!src) throw photoError(n, 'no url');
  if (!force && isOurs(src, cfg)) return src;
  if (!cfg) return src;
  const r = await doFetch(src, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!r.ok) throw photoError(n, `HTTP ${r.status}`);
  const bytes = Buffer.from(await r.arrayBuffer());
  if (!bytes.length) throw photoError(n, 'empty file');
  return storePhoto(bytes, r.headers.get('content-type'), { client, config: cfg });
}

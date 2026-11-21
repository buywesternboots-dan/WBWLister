// Temporary Grunt2 photo store. When PHOTO_STORE_URL and PHOTO_STORE_TOKEN are set,
// puts go there instead of Vercel Blob. A put failure is left to the caller (importPhoto keeps the source URL).
import { put as blobPut } from '@vercel/blob';

const hasStore = env => !!(String(env?.PHOTO_STORE_URL ?? '').trim() && String(env?.PHOTO_STORE_TOKEN ?? ''));

async function toBytes(body) {
  if (body == null) return Buffer.alloc(0);
  if (Buffer.isBuffer(body)) return body;
  if (body instanceof Uint8Array) return Buffer.from(body);
  if (typeof body === 'string') return Buffer.from(body);
  if (body instanceof ArrayBuffer) return Buffer.from(body);
  if (typeof body.arrayBuffer === 'function') return Buffer.from(await body.arrayBuffer());
  throw new Error('Unsupported photo body');
}

function storeUrl(pathname, env) {
  const base = String(env.PHOTO_STORE_URL).trim().replace(/\/+$/, '');
  const rel = String(pathname || '').replace(/^\/+/, '');
  return `${base}/${rel.split('/').map(encodeURIComponent).join('/')}`;
}

export async function putToPhotoStore(pathname, body, opts = {}, env = process.env) {
  const token = String(env.PHOTO_STORE_TOKEN ?? '');
  const bytes = await toBytes(body);
  const res = await fetch(storeUrl(pathname, env), {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': opts.contentType || 'application/octet-stream',
    },
    body: bytes,
  });
  if (!res.ok) throw new Error(`Photo store HTTP ${res.status}`);
  const data = await res.json().catch(() => ({}));
  if (!data?.url) throw new Error('Photo store did not return a url');
  return { url: data.url };
}

export async function put(pathname, body, opts = {}, env = process.env, fallback = blobPut) {
  if (hasStore(env)) return putToPhotoStore(pathname, body, opts, env);
  return fallback(pathname, body, opts);
}

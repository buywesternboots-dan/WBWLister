// Server-only: hand a listing to asmoWBW (local Python CLI or HTTP worker) and store the result.
// Do not import this from client components. Naming and pixel work stay in the Python tool.
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { attachablePhotoUrl, inputFingerprint, listingPatch, storedRecord, withPrevious } from './asmo-wbw';
import { listingInput, withCatalog } from './asmo-wbw-input';

const DEFAULT_TIMEOUT_MS = 120_000;

export function vendorRoot() {
  return process.env.ASMO_WBW_ROOT || path.join(process.cwd(), 'vendor/asmo-wbw');
}

function pythonBin() {
  return process.env.ASMO_WBW_PYTHON || path.join(vendorRoot(), '.venv/bin/python');
}

export function workerUrl() {
  const raw = process.env.ASMO_WBW_URL;
  return raw ? String(raw).replace(/\/$/, '') : '';
}

function asBuffer(bytes) {
  if (!bytes) return null;
  if (Buffer.isBuffer(bytes)) return bytes;
  if (bytes instanceof Uint8Array) return Buffer.from(bytes);
  if (typeof bytes === 'string') return Buffer.from(bytes, 'base64');
  return Buffer.from(bytes);
}

export async function attachMedia(input, opt = {}) {
  const photos = input.photos ?? [];
  const existing = Array.isArray(input.media) ? input.media : [];
  const readPhoto = opt.readPhoto;
  const media = [];
  for (let i = 0; i < photos.length; i++) {
    const n = i + 1;
    const stored_url = photos[i];
    const sidecar = existing.find(m => Number(m?.n) === n) || {};
    let bytes = asBuffer(sidecar.bytes || sidecar.buffer);
    if (!bytes && sidecar.base64) bytes = Buffer.from(sidecar.base64, 'base64');
    if (!bytes && sidecar.path && opt.readFile) {
      try { bytes = asBuffer(await opt.readFile(sidecar.path)); } catch { /* leave unread */ }
    }
    if (!bytes && readPhoto && attachablePhotoUrl(stored_url)) {
      try {
        const got = await readPhoto(stored_url);
        bytes = asBuffer(got?.body ?? got);
      } catch { /* names can still be written without pixels */ }
    }
    const rec = { n, stored_url, content_type: sidecar.content_type ?? null };
    if (bytes) rec.base64 = bytes.toString('base64');
    media.push(rec);
  }
  return media;
}

function hasAttachedBytes(media) {
  return (media ?? []).some(m => m.base64 || m.path || m.bytes);
}

function canFetchAny(input) {
  return (input.photos ?? []).some(url => attachablePhotoUrl(url));
}

async function invokeHttp(payload, opt = {}) {
  const base = workerUrl();
  if (!base) throw new Error('ASMO_WBW_URL is not set.');
  const headers = { 'Content-Type': 'application/json' };
  if (process.env.ASMO_WBW_TOKEN) headers.Authorization = `Bearer ${process.env.ASMO_WBW_TOKEN}`;
  const body = JSON.stringify({ listing: payload, fetch: !!opt.fetch });
  const res = await fetch(`${base}/run`, { method: 'POST', headers, body, signal: AbortSignal.timeout(opt.timeoutMs ?? DEFAULT_TIMEOUT_MS) });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { throw new Error(`asmoWBW worker returned invalid JSON (${res.status}).`); }
  if (!res.ok || data.ok === false) throw new Error(data.error || data.message || `asmoWBW worker failed (${res.status}).`);
  return data;
}

function runCommand(bin, args, opt = {}) {
  const timeoutMs = opt.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      cwd: opt.cwd || vendorRoot(),
      env: { ...process.env, PYTHONPATH: vendorRoot(), ...(opt.env || {}) },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const chunks = [], err = [];
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`asmoWBW timed out after ${timeoutMs / 1000}s.`));
    }, timeoutMs);
    child.stdout.on('data', d => chunks.push(d));
    child.stderr.on('data', d => err.push(d));
    child.on('error', e => {
      clearTimeout(timer);
      if (e?.code === 'ENOENT') reject(new Error(missingPythonMessage()));
      else reject(e);
    });
    child.on('close', code => {
      clearTimeout(timer);
      const stdout = Buffer.concat(chunks).toString('utf8');
      const stderr = Buffer.concat(err).toString('utf8').trim();
      if (code !== 0) {
        reject(new Error(stderr.split('\n').pop() || `asmoWBW exited with code ${code}.`));
        return;
      }
      resolve({ stdout, stderr });
    });
    if (opt.stdin != null) child.stdin.end(opt.stdin);
    else child.stdin.end();
  });
}

export function missingPythonMessage() {
  return 'asmoWBW is not available on this host. Install Python 3.11+ and the packages in vendor/asmo-wbw/requirements.txt, or set ASMO_WBW_URL to a running asmoWBW worker. See docs/asmo-wbw-hosting.md.';
}

async function resolvePython() {
  // On Vercel the worker URL is used; do not probe the filesystem (that would trace the whole app into the serverless bundle).
  if (process.env.ASMO_WBW_URL || process.env.VERCEL) return process.env.ASMO_WBW_PYTHON || 'python3';
  const preferred = pythonBin();
  try { await stat(/*turbopackIgnore: true*/ preferred); return preferred; } catch { /* try python3 */ }
  return 'python3';
}

async function collectFiles(dir, prefix = '') {
  const files = [];
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); }
  catch { return files; }
  for (const entry of entries) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '.asmo-wbw') continue;
      files.push(...await collectFiles(full, rel));
    } else if (entry.isFile()) {
      const body = await readFile(full);
      const lower = entry.name.toLowerCase();
      const type = lower.endsWith('.webp') ? 'image/webp' : lower.endsWith('.jpg') || lower.endsWith('.jpeg') ? 'image/jpeg' : 'application/octet-stream';
      files.push({ path: rel.replace(/\\/g, '/'), content_type: type, base64: body.toString('base64') });
    }
  }
  return files;
}

async function invokeCli(payload, opt = {}) {
  const python = opt.python || await resolvePython();
  const root = vendorRoot();
  const work = await mkdtemp(path.join(tmpdir(), 'asmo-wbw-'));
  const inFile = path.join(work, 'listing.json');
  const outDir = path.join(work, 'out');
  const storeDir = path.join(work, 'store');
  await mkdir(outDir, { recursive: true });
  await mkdir(storeDir, { recursive: true });
  await writeFile(inFile, JSON.stringify(payload), 'utf8');
  try {
    const args = ['-m', 'asmo_wbw', 'run', '--in', inFile, '--out-dir', outDir, '--store', storeDir];
    if (opt.fetch) args.push('--fetch');
    const { stdout } = await runCommand(python, args, { cwd: root, timeoutMs: opt.timeoutMs });
    const result = JSON.parse(stdout);
    const files = await collectFiles(outDir);
    return { ok: result.ok !== false, result, files, store_dir: storeDir };
  } finally {
    if (!opt.keepWork) await rm(work, { recursive: true, force: true });
  }
}

export async function invokeAsmoWbw(payload, opt = {}) {
  if (typeof opt.run === 'function') return opt.run(payload, opt);
  if (workerUrl() && !opt.forceCli) return invokeHttp(payload, opt);
  return invokeCli(payload, opt);
}

async function storeFiles(files, images, listingId, storePhoto) {
  if (!storePhoto) return images;
  const byName = new Map();
  for (const f of files ?? []) {
    const base = String(f.path || '').replace(/^.*\//, '');
    if (base) byName.set(base, f);
    byName.set(String(f.path || '').replace(/\\/g, '/'), f);
  }
  const next = [];
  for (const im of images ?? []) {
    const out = { ...im };
    const jpegName = String(im.filename || im.file || im.jpeg || '').replace(/^.*\//, '');
    const webpName = String(im.webp || '').replace(/^.*\//, '') || (jpegName ? jpegName.replace(/\.jpe?g$/i, '.webp') : '');
    const jpegFile = byName.get(jpegName) || byName.get(im.jpeg) || byName.get(`${listingId}/${jpegName}`);
    const webpFile = byName.get(webpName) || byName.get(im.webp) || byName.get(`${listingId}/${webpName}`);
    if (jpegFile) {
      const url = await storePhoto(`asmowbw/${listingId}/${im.n}/${jpegName}`, Buffer.from(jpegFile.base64, 'base64'), jpegFile.content_type || 'image/jpeg');
      if (url) out.jpeg_url = url;
    }
    if (webpFile) {
      const url = await storePhoto(`asmowbw/${listingId}/${im.n}/${webpName}`, Buffer.from(webpFile.base64, 'base64'), webpFile.content_type || 'image/webp');
      if (url) out.webp_url = url;
    }
    next.push(out);
  }
  return next;
}

function oneResult(raw) {
  if (!raw) throw new Error('asmoWBW returned no result.');
  if (raw.result && raw.result.listing_id != null) return { wrapper: raw, result: raw.result, files: raw.files ?? [] };
  if (raw.listing_id != null) return { wrapper: raw, result: raw, files: raw.files ?? [] };
  if (Array.isArray(raw.results) && raw.results[0]) return { wrapper: raw, result: raw.results[0], files: raw.files ?? [] };
  throw new Error('asmoWBW returned an unexpected result.');
}

export async function runListing(input, opt = {}) {
  const media = await attachMedia(input, opt);
  const payload = { ...input, media };
  const fetch = opt.fetch ?? (!hasAttachedBytes(media) && canFetchAny(payload) && !!workerUrl());
  const raw = await invokeAsmoWbw(payload, { ...opt, fetch: !!fetch });
  const { result: rawResult, files } = oneResult(raw);
  const withUrls = {
    ...rawResult,
    images: await storeFiles(files, rawResult.images, rawResult.listing_id, opt.storePhoto),
  };
  const record = storedRecord(withUrls, {
    now: opt.now,
    input,
    input_fp: inputFingerprint(input),
    origin: opt.origin || '',
  });
  const summary = {
    id: record.result?.listing_id ?? input.id,
    photos: record.images.length,
    optimized: record.images.filter(im => im.pixels === 'optimized').length,
    unchanged: record.images.filter(im => im.pixels === 'unchanged').length,
    failed: record.images.filter(im => im.pixels === 'failed').length,
    style: record.flags?.style_status === 'matched' ? (input.style_ref?.style_number || input.id_text || '') : '',
    confirm_queue: record.confirm_queue || 0,
  };
  return {
    ok: rawResult.ok !== false,
    record,
    patch: listingPatch(record),
    summary,
  };
}

export async function prepareListingInput(item, seller, opt = {}) {
  const input = listingInput({ ...item }, seller);
  return withCatalog(input, {
    makers: opt.makers,
    styleSample: opt.styleSample,
  });
}

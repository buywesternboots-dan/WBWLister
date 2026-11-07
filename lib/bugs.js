// Bug report checks. The route calls bugReportApi; tests call it with an in-memory store.
import { marked } from 'marked';
import sanitizeHtml from 'sanitize-html';
import { actorFrom, cookieVal } from './access';
import { aiEnabled, maybeAnalyze } from './bug-ai';
import { CLOSED, siteMode } from './gate';
import { HttpError } from './http';
import { redactPageUrl } from './report-url';

export const PRIORITIES = ['High', 'Medium', 'Low', 'Question'];
export const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
export const ANON_MAX_IMAGE_BYTES = 1024 * 1024;
export const ANON_MAX = 5;
export const ANON_WINDOW_MS = 10 * 60 * 1000;
export const USER_MAX = 30;
export const MAX_TRANSCRIPT = 8000;
export const MAX_UA = 500;
export const MAX_VIEWPORT = 200;
export const MAX_BODY_BYTES = 5 * 1024 * 1024;
export const REPORT_PAGE = 12;

const BORDERS = { High: '#dc2626', Medium: '#f97316', Low: '#16a34a', Question: '#2563eb' };
export const priorityColor = p => BORDERS[p] || '#64748b';

export const clientIp = req => (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || req.headers.get('x-real-ip') || 'unknown';

// The request URL, not X-Forwarded-Host. A caller can set that header; they cannot change req.url.
export function requestOrigin(req) {
  return new URL(req.url).origin;
}

const pathOf = value => {
  try {
    const u = new URL(value);
    return { origin: u.origin, path: u.pathname.replace(/\/+$/, '') || '/', href: u.href };
  } catch { return null; }
};

export function loginPageUrl(value, origin) {
  const u = pathOf(value);
  return !!u && u.origin === origin && u.path === '/login';
}

// Signed-in reports can be any page on this site. Logged-out reports only count when the browser is on /login.
export function authorizeReport({ who, referer, pageUrl, origin }) {
  if (who?.role === 'admin' || who?.role === 'seller') return { ok: true, anonymous: false };
  if (loginPageUrl(referer, origin) && loginPageUrl(pageUrl, origin)) return { ok: true, anonymous: true };
  return { ok: false };
}

export function priorityFilter(raw) {
  return typeof raw === 'string' && PRIORITIES.includes(raw) ? raw : null;
}

export function filterReports(rows, raw) {
  const p = priorityFilter(raw);
  return (rows ?? []).filter(r => !p || r.priority === p).slice().sort((a, b) => {
    const dt = new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    if (dt) return dt;
    return Number(b.id) - Number(a.id);
  });
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function renderAnalysis(markdown) {
  if (!markdown) return '';
  const raw = marked.parse(String(markdown), { async: false });
  return sanitizeHtml(typeof raw === 'string' ? raw : '', {
    allowedTags: ['p', 'br', 'strong', 'em', 'ul', 'ol', 'li', 'code', 'pre', 'h1', 'h2', 'h3', 'h4', 'blockquote', 'a'],
    allowedAttributes: { a: ['href', 'title', 'rel', 'target'] },
    allowedSchemes: ['http', 'https', 'mailto'],
    transformTags: { a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer', target: '_blank' }) },
  });
}

export function safeHttpUrl(value) {
  return redactPageUrl(value);
}

export function reportWindow(page, size = REPORT_PAGE) {
  const n = Number(page);
  const p = Number.isInteger(n) && n >= 1 && n <= 10000 ? n : 1;
  const limit = Math.min(REPORT_PAGE, Math.max(1, Math.floor(Number(size) || REPORT_PAGE)));
  return { page: p, limit, offset: (p - 1) * limit };
}

export function safeImageSrc(value) {
  if (typeof value !== 'string' || value.length > MAX_IMAGE_BYTES * 2) return '';
  return /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/.test(value) ? value : '';
}

export function bugLimitDecision(row, now, max, windowMs) {
  const fresh = !row || now - Number(row.start) >= windowMs;
  const n = fresh ? 0 : Number(row.n);
  if (n >= max) return { allow: false, next: { n, start: fresh ? now : Number(row.start) } };
  return { allow: true, next: { n: n + 1, start: fresh ? now : Number(row.start) } };
}

function magicOk(mime, b64) {
  let head;
  try { head = Buffer.from(b64.slice(0, 48), 'base64'); } catch { return false; }
  if (mime === 'image/jpeg') return head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
  if (mime === 'image/png') return head.length >= 4 && head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47;
  if (mime === 'image/webp') return head.length >= 12 && head.toString('ascii', 0, 4) === 'RIFF' && head.toString('ascii', 8, 12) === 'WEBP';
  return false;
}

export function validateImage(image, maxBytes) {
  if (typeof image !== 'string') throw new HttpError('Invalid image.', 400);
  const overhead = Math.ceil(maxBytes / 3) * 4 + 64;
  if (image.length > overhead) throw new HttpError('Screenshot is too large.', 413);
  const comma = image.indexOf(',');
  const mime = /^data:(image\/(?:png|jpeg|webp));base64$/i.exec(comma > 0 ? image.slice(0, comma) : '')?.[1]?.toLowerCase();
  if (!mime) throw new HttpError('Invalid image. Use a PNG, JPEG, or WebP data URL.', 400);
  const b64 = image.slice(comma + 1).replace(/\s/g, '');
  if (!b64 || b64.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) throw new HttpError('Invalid image.', 400);
  const pad = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
  if ((b64.length / 4) * 3 - pad > maxBytes) throw new HttpError('Screenshot is too large.', 413);
  if (!magicOk(mime, b64)) throw new HttpError('Invalid image.', 400);
  return { mime, data: b64, dataUrl: `data:${mime};base64,${b64}` };
}

export function pageUrlFor(value, origin) {
  return redactPageUrl(value, origin);
}

function concatBytes(chunks, total) {
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { out.set(chunk, offset); offset += chunk.byteLength; }
  return out;
}

// Counts bytes as they arrive. A small Content-Length does not make a larger body acceptable.
export async function readLimitedJson(req, maxBytes = MAX_BODY_BYTES) {
  const declared = Number(req.headers.get('content-length') || 0);
  if (Number.isFinite(declared) && declared > maxBytes) throw new HttpError('Report is too large.', 413);
  const stream = req.body;
  if (!stream || typeof stream.getReader !== 'function') {
    const text = typeof req.text === 'function' ? await req.text() : '';
    if (Buffer.byteLength(text) > maxBytes) throw new HttpError('Report is too large.', 413);
    try { return text ? JSON.parse(text) : {}; } catch { throw new HttpError('Invalid JSON.', 400); }
  }
  const reader = stream.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value?.byteLength) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        throw new HttpError('Report is too large.', 413);
      }
      chunks.push(value);
    }
  } finally {
    try { reader.releaseLock(); } catch { /* already released */ }
  }
  let text = '';
  try { text = new TextDecoder().decode(concatBytes(chunks, total)); } catch { throw new HttpError('Invalid JSON.', 400); }
  try { return text ? JSON.parse(text) : {}; } catch { throw new HttpError('Invalid JSON.', 400); }
}

async function signedIn(req, env) {
  if (siteMode(env) === 'closed') throw new HttpError(CLOSED, 503);
  if (!(req.headers.get('x-auth') || cookieVal(req, 'auth'))) return null;
  try { return await actorFrom(req, env); }
  catch (e) {
    if (e?.status === 503) throw e;
    return null;
  }
}

async function requireAdmin(req, env) {
  const who = await actorFrom(req, env);
  if (who.role !== 'admin') throw new HttpError('Only an admin can do that.', 403);
  return who;
}

export async function bugReportApi(req, db, env = process.env) {
  if (siteMode(env) === 'closed') throw new HttpError(CLOSED, 503);
  if (req.method === 'GET') {
    await requireAdmin(req, env);
    const url = new URL(req.url);
    const priority = priorityFilter(url.searchParams.get('priority'));
    const win = reportWindow(url.searchParams.get('page'));
    const fetched = await db.list(priority, { limit: win.limit + 1, offset: win.offset });
    const hasMore = fetched.length > win.limit;
    return { priority, page: win.page, hasMore, reports: filterReports(fetched.slice(0, win.limit), priority) };
  }
  if (req.method === 'PATCH') {
    await requireAdmin(req, env);
    const body = await readLimitedJson(req);
    const id = Number(body.id);
    if (!Number.isInteger(id) || id < 1) throw new HttpError('Invalid report.', 400);
    if (body.status !== 'open' && body.status !== 'fixed') throw new HttpError('Invalid status.', 400);
    const row = await db.setStatus(id, body.status);
    if (!row) throw new HttpError('Report not found.', 404);
    return { id: row.id, status: row.status };
  }
  if (req.method !== 'POST') throw new HttpError('Please log in.', 401);

  const body = await readLimitedJson(req);
  const origin = requestOrigin(req);
  const who = await signedIn(req, env);
  const access = authorizeReport({ who, referer: req.headers.get('referer') || '', pageUrl: body?.page_url, origin });
  if (!access.ok) throw new HttpError('Please log in.', 401);
  if (!PRIORITIES.includes(body?.priority)) throw new HttpError('Invalid priority. Must be High, Medium, Low, or Question.', 400);

  const maxBytes = access.anonymous ? ANON_MAX_IMAGE_BYTES : MAX_IMAGE_BYTES;
  const image = validateImage(body.image, maxBytes);
  const page_url = pageUrlFor(body.page_url, origin);
  if (!page_url) throw new HttpError('Invalid page.', 400);
  const transcript = String(body.transcript ?? '').replace(/\u0000/g, '').slice(0, MAX_TRANSCRIPT);
  const user_agent = String(body.user_agent ?? '').replace(/[\r\n]+/g, ' ').trim().slice(0, MAX_UA);
  const viewport = (typeof body.viewport === 'string' ? body.viewport : '').replace(/[\r\n]+/g, ' ').trim().slice(0, MAX_VIEWPORT);

  const ip = clientIp(req);
  const key = access.anonymous ? `anon:${ip}` : who.role === 'seller' ? `user:seller:${who.seller}` : 'user:admin';
  const max = access.anonymous ? ANON_MAX : USER_MAX;
  if (typeof db.limits?.admit !== 'function') throw new HttpError('Could not save the report.', 500);
  const gate = await db.limits.admit(key, max, ANON_WINDOW_MS);
  if (!gate?.allow) throw new HttpError('Too many bug reports. Try again later.', 429);

  let reporter = 'anonymous';
  if (who?.role === 'admin') reporter = 'admin';
  else if (who?.role === 'seller') reporter = String(await db.reporter(who) || who.seller || 'anonymous').slice(0, 200);

  const ai_analysis = !aiEnabled(env, access.anonymous) ? null : await maybeAnalyze({
    priority: body.priority, transcript, mimeType: image.mime, data: image.data, generate: db.analyze, anonymous: access.anonymous,
  }, env);

  try {
    const saved = await db.insert({
      priority: body.priority, transcript, image: image.dataUrl, page_url, user_agent, viewport, reporter, ai_analysis,
    });
    return { id: saved.id };
  } catch (e) {
    if (e?.status) throw e;
    throw new HttpError('Could not save the report.', 500);
  }
}

export const bugReportResponse = (req, db, env) => bugReportApi(req, db, env).then(
  body => Response.json(body, { status: req.method === 'POST' ? 201 : 200 }),
  e => Response.json({ error: e.message || 'Something went wrong.' }, { status: e.status || 400 }),
);

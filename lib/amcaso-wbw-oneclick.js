// One-click AMCASO WBW for a pair: read its original photos, run the JS amcasoWBW engine, store the prepared
// full-size photos as items.photos (storePreparedPhotos), and keep the originals for Undo. Nothing runs on a PC.
// All I/O is injected (readPhoto, putFn) so tests never touch Blob, R2, or the network.
import { storePreparedPhotos, withPrevious } from './amcaso-wbw';
import { listingInput, withCatalog } from './amcaso-wbw-input';
import { factsFingerprint, runEngine } from './amcaso-wbw-engine';

const jsonField = v => {
  if (v == null || v === '') return null;
  if (typeof v === 'string') { try { return JSON.parse(v); } catch { return null; } }
  return v;
};
const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

// The photos amcasoWBW should read: the kept originals while a prepared set is live, else the current photos.
export function sourcePhotos(item) {
  const photos = [...(item?.photos ?? [])];
  const rec = jsonField(item?.asmowbw);
  const live = rec?.original_photos?.length && same(photos, (rec.images ?? []).map(im => im.stored_url));
  return live ? [...rec.original_photos] : photos;
}

// True when the live prepared photos were made from these originals and these listing facts.
export function upToDate(item, input) {
  const rec = jsonField(item?.asmowbw);
  if (!rec?.original_photos?.length || !rec.facts_fp) return false;
  if (!same(item.photos ?? [], (rec.images ?? []).map(im => im.stored_url))) return false;
  return same(rec.original_photos, input.photos) && rec.facts_fp === factsFingerprint(input);
}

async function readAll(urls, readPhoto, concurrency = 4) {
  const out = new Array(urls.length);
  let next = 0;
  const worker = async () => {
    while (next < urls.length) {
      const i = next++;
      try {
        const got = await readPhoto(urls[i]);
        const bytes = got?.body ?? got;
        out[i] = bytes?.length ? { n: i + 1, bytes: Buffer.from(bytes) } : { n: i + 1, error: 'could not be read' };
      } catch (e) { out[i] = { n: i + 1, error: `could not be read (${e?.message || 'error'})` }; }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, urls.length) }, worker));
  return out;
}

// Returns { status: 'applied' | 'up-to-date', photos, asmowbw, summary }. Throws (nothing written) when any photo fails.
export async function oneClickPair(item, seller, deps = {}) {
  const { readPhoto, putFn, catalog = {}, now, force = false } = deps;
  const sources = sourcePhotos(item);
  if (!sources.length) throw new Error('This pair has no photos.');
  const input = withCatalog(listingInput({ ...item, photos: sources, asmowbw: null }, seller), catalog);
  if (!force && upToDate(item, input)) {
    const rec = jsonField(item.asmowbw);
    return { status: 'up-to-date', photos: item.photos, asmowbw: rec, summary: summaryOf(item.id, rec) };
  }
  const bytes = await readAll(sources, readPhoto);
  const { result, files } = await runEngine(input, bytes);
  if (result.errors.length) throw new Error(result.errors.join('; '));
  const stored = await storePreparedPhotos({ ...item, photos: sources, asmowbw: null }, result, files, putFn, { now });
  const asmowbw = withPrevious(stored.asmowbw, jsonField(item.asmowbw));
  return { status: 'applied', photos: stored.photos, asmowbw, summary: summaryOf(item.id, asmowbw) };
}

export function summaryOf(id, rec) {
  const images = rec?.images ?? [];
  return {
    id, photos: images.length, seo_title: rec?.seo_title ?? null,
    converted: images.filter(im => im.converted).length,
    warnings: [...new Set(images.flatMap(im => (im.warnings ?? []).map(w => `photo ${im.n}: ${w}`)))],
  };
}

// Bulk: each pair is run on its own; a failure is listed and the other pairs still go through.
// save(row, out) writes photos + record for an applied pair only.
export async function oneClickMany(ids, rows, seller, deps, save) {
  const results = [];
  for (const id of ids) {
    const row = rows.find(r => Number(r.id) === Number(id));
    if (!row) { results.push({ id, ok: false, error: 'That listing was not found.' }); continue; }
    try {
      const out = await oneClickPair(row, seller, { ...deps, catalog: deps.catalogFor ? deps.catalogFor(row) : deps.catalog });
      if (out.status === 'applied') await save(row, out);
      results.push({ ok: true, status: out.status, ...out.summary });
    } catch (e) {
      results.push({ id: row.id, ok: false, error: e?.message || 'AMCASO WBW failed.' });
    }
  }
  return {
    results, processed: results.length,
    applied: results.filter(r => r.status === 'applied').length,
    up_to_date: results.filter(r => r.status === 'up-to-date').length,
    failed: results.filter(r => !r.ok).length,
  };
}

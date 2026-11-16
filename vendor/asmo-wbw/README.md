# asmoWBW

Western Boot World naming tool. A **separate** sibling of [ASMO](/workspace/asmo-agent): core ASMO stays standalone, with no boot files or Western Boot World names in that tree.

asmoWBW takes **the pictures of one boot plus a deep text description** and proposes SEO file names for each image, and a listing / pair slug, for the photo-to-video / RET draft pipeline.

- Names are built only from words that are actually in the description (plus an optional title and any photo metadata). Nothing is guessed.
- The listing slug follows the existing photo-to-video rule: brand, then material / model words that are present, then type (`cowboy-boots`, `western-boots`, `roper`…), then `size-N`, then width. Lowercase ASCII hyphens, max 80 characters, descriptors dropped first.
- Per-image suffixes are view words: `side`, `front`, `toe`, `sole`, `heel`, `back`, `detail`, `pair`. The view comes from local silhouette analysis (CPU only). Low-confidence views go on a confirm queue.
- Preview, batch, undo, and a journal with exact original-byte backups — the same safety contract as ASMO (ported, not imported, so ASMO’s denylist still passes).
- No cloud AI, no paid APIs, no uploads, no publishing, and no writes to List Perfectly or live listings. The photo-to-video sample tree is read-only; tests work on copies.

## BootLister entry (primary)

BootLister sends one listing JSON object (see `specs/bootlister-asmo-input-contract.md`). asmoWBW returns a JSON result and writes web JPEG/WebP under `--out-dir`. The output shape is in `specs/asmo-wbw-output-contract.md`. Folder mode (`preview` / `batch` with `description.txt`) remains as a secondary option.

```bash
cd /workspace/asmo-wbw
# stdin or --in FILE; files go under --out-dir/<listing_id>/
.venv/bin/python -m asmo_wbw run --in fixtures/listings/appendix-example.json --out-dir /tmp/asmo-wbw-out
cat listing.json | .venv/bin/python -m asmo_wbw run --out-dir /tmp/asmo-wbw-out
# Operator-only URL fetch (never westernbootworld.com or eBay; no scheduler)
.venv/bin/python -m asmo_wbw run --in listing.json --out-dir /tmp/asmo-wbw-out --fetch --og-base-url https://example.public/media
```

## Commands


From this folder, with the box Python (Pillow and NumPy). The photo-to-video virtualenv also works and already has OpenCV:

```bash
cd /workspace/asmo-wbw
python3 -m asmo_wbw doctor

# Preview (no renames)
python3 -m asmo_wbw preview --dir /path/to/boot-folder

# Or pass the description and images explicitly
python3 -m asmo_wbw preview --description fixtures/descriptions/lucchese-caiman.txt img1.jpg img2.jpg

# Rename high-confidence files (low-confidence stay in the confirm queue)
python3 -m asmo_wbw batch --dir /path/to/boot-folder
# journal + confirm-queue.json land in <folder>/.asmo-wbw/

# Include low-confidence names too
python3 -m asmo_wbw batch --dir /path/to/boot-folder --include-low-confidence

# Undo one file (exact original bytes and name)
python3 -m asmo_wbw undo <op-id-or-path> --store /path/to/boot-folder/.asmo-wbw
```

`--json` prints a machine-readable plan (listing slug, structured fields, per-image names, confirm queue) for a later RET / photo-to-video hookup.

## Description input

A boot folder may contain `description.txt` (or `.md` / `.json`) plus the photos.

Plain text is the usual form. A `Title:` line (or `--title`) is included in the source words, which matters when the material only appears in the title. JSON is also accepted:

```json
{
  "title": "…",
  "description": "…",
  "fields": { "brand": "Lucchese" }
}
```

Pre-supplied `fields` are treated as labeled facts, never as guesses. Structured fields extracted from the text: brand, model, material / exotic skin, color, toe shape, heel, size, width, condition, era.

## Tests

```bash
cd /workspace/asmo-wbw
.venv/bin/python -m pytest -q
# (create the venv once with: python3 -m venv .venv && .venv/bin/pip install pytest pillow numpy)
```

Tests copy the photo-to-video sample photos into a temp folder and never write back. Written (non-live) descriptions live in `fixtures/written/`.

## What this is not

- Not a replacement for core ASMO (generic media naming).
- Not wired into RET or photo-to-video yet — it can emit a plan, but it does not write drafts or videos.
- Not a licensee of any live listing catalog. Sample descriptions used in fixtures are title + public body text only.

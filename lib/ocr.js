// Free photo reading only. Gemini runs when GEMINI_API_KEY is set; otherwise local
// tesseract. No key and no tesseract means an empty string, not an error, and never a paid API.
const PROMPT = 'Read every number and code printed or stamped in this boot photo. Return only the text you can see, one item per line. If there is none, return nothing.';

async function geminiText(src, key) {
  const img = await fetch(src);
  if (!img.ok) return '';
  const mime = (img.headers.get('content-type') || 'image/jpeg').split(';')[0];
  const data = Buffer.from(await img.arrayBuffer()).toString('base64');
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${encodeURIComponent(key)}`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: [{ inline_data: { mime_type: mime, data } }, { text: PROMPT }] }] }),
  });
  if (!r.ok) return '';
  const j = await r.json();
  return j.candidates?.[0]?.content?.parts?.map(p => p.text).filter(Boolean).join('\n') ?? '';
}

async function tesseractText(src) {
  const { createWorker } = await import('tesseract.js');
  const worker = await createWorker('eng');
  try {
    const { data } = await worker.recognize(src);
    return data?.text ?? '';
  } finally { await worker.terminate(); }
}

export async function recognizePhoto(src) {
  const key = process.env.GEMINI_API_KEY;
  try {
    if (key) return await geminiText(src, key);
    return await tesseractText(src);
  } catch { return ''; }
}

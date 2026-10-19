// Photo ID check: Claude (vision) looks at an item's photos for tags/stamps/labels showing a model, style, last or date code.
const PROMPT = `These are photos of one pair of cowboy/western boots. Which photos clearly show printed or stamped identification info: a style/model number, last number, date or lot code, size/maker stamp, pull-strap label, insole stamp or box label? Reply with JSON only: [{"photo": <1-based photo number>, "kind": "<insole stamp|tag|label|box|other>", "text": "<the text exactly as printed>"}]. Use [] if none. Never guess text you cannot read.`;

export async function scanPhotos(photos) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: 'claude-haiku-5-5', max_tokens: 1000, messages: [{ role: 'user', content: [
      ...photos.slice(0, 20).map(url => ({ type: 'image', source: { type: 'url', url } })), { type: 'text', text: PROMPT }] }] }) });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error?.message ?? `Photo scan failed (HTTP ${r.status})`);
  const found = JSON.parse(j.content?.[0]?.text.match(/\[[\s\S]*\]/)?.[0] ?? '[]');
  return found.filter(f => f.text?.trim());
}

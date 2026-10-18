// Brand context from WBW's brand info pages (env WBW_BRAND_URL, e.g. https://westernbootworld.com/brands/{slug}); none set = no context.
const cache = new Map();
export async function brandInfo(brand) {
  const t = process.env.WBW_BRAND_URL;
  if (!t || !brand) return null;
  const link = t.replace('{slug}', brand.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''));
  if (!cache.has(link)) cache.set(link, fetch(link).then(async r => {
    const html = r.ok ? await r.text() : '';
    const d = html.match(/<meta[^>]+(?:property="og:description"|name="description")[^>]+content="([^"]+)"/i)?.[1];
    return d ? { link, text: d.replace(/&amp;/g, '&').replace(/&#0?39;|&apos;/g, "'").split(/(?<=[.!?])\s+/).slice(0, 2).join(' ').slice(0, 300) } : null;
  }).catch(() => null));
  return cache.get(link);
}

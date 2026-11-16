// Server-side "Re-scan source" for a seller whose primary tool is a website store or a Poshmark closet.
// Same steps as the inventory page's Sync button: re-read every listing, refresh changed ones, mark gone ones Pending sold.
// Facebook and Depop need the Chrome extension (blocked server-side). eBay is refused here: no live eBay API calls without Dan's OK.
import { productList, readProduct, slug } from './sites';

export function rescanLink(seller = {}) {
  const p = String(seller.primary_source ?? '').toLowerCase();
  const site = String(seller.website ?? '').trim();
  if (p === 'facebook' || p === 'depop') throw new Error('Facebook and Depop re-scans run through the Chrome extension (Sync on the inventory page).');
  if (p === 'ebay' || /ebay\.com/i.test(site)) throw new Error('eBay re-scan is off: it needs the eBay API and Dan\'s OK.');
  if (p === 'csv' || p === 'listperfectly') throw new Error('Spreadsheet sellers re-sync by uploading their latest CSV.');
  if (!site) throw new Error('This seller has no website or Poshmark link to re-scan.');
  return site;
}

// db: { createItem, syncSource, stampScan }. Stops at the time budget; a partial run never marks anything sold.
export async function rescanSource(seller, sellerRow, db, { budgetMs = 240000, now = Date.now, list = productList, read = readProduct } = {}) {
  const site = rescanLink(sellerRow);
  const start = now();
  const { urls, items } = await list(site);
  if (!urls.length) throw new Error('No listings for sale found at that link.');
  const source = items ? Object.values(items)[0].source : new URL(urls[0]).hostname.replace(/^www\./, '');
  const listed = new Set(urls.map(slug));
  const n = { added: 0, updated: 0, unchanged: 0, sold: 0, failed: 0, removed: 0, left: 0 };
  let i = 0;
  for (; i < urls.length; i++) {
    if (now() - start > budgetMs) break;
    try {
      const item = items?.[urls[i]] ?? await read(urls[i]);
      if (!item) { n.sold++; listed.delete(slug(urls[i])); continue; }
      const row = await db.createItem(seller, item);
      if (!row) n.unchanged++; else if (row.updated) n.updated++; else n.added++;
    } catch { n.failed++; }
  }
  n.left = urls.length - i;
  // Only a complete, mostly clean read may mark missing listings Pending sold.
  if (!n.left && n.failed <= Math.max(2, urls.length * 0.05)) n.removed = await db.syncSource(seller, source, [...listed]);
  await db.stampScan(seller);
  return { source, total: urls.length, partial: n.left > 0, ...n };
}

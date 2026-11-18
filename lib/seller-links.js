// Shop-link helpers. website and fb_profile stay the stored fields the extension and import bar read.
// shop_links holds the full channel map (and any extra URLs) so a seller can list every shop they use.

export const EXTENSION_SHOP = /facebook\.com|depop\.com/i;
export const SHOP_CHANNELS = ['depop', 'facebook', 'ebay', 'poshmark', 'website'];

export const isExtensionShop = url => EXTENSION_SHOP.test(String(url ?? ''));

export function classifyShopUrl(url) {
  const u = String(url ?? '').trim();
  if (!u) return null;
  if (/facebook\.com/i.test(u)) return 'facebook';
  if (/depop\.com/i.test(u)) return 'depop';
  if (/ebay\.com/i.test(u)) return 'ebay';
  if (/poshmark\.com/i.test(u)) return 'poshmark';
  return 'website';
}

function readLinkMap(value) {
  if (!value) return { map: {}, extras: [] };
  if (Array.isArray(value)) return { map: {}, extras: value };
  if (typeof value === 'object') return { map: value, extras: [] };
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return { map: {}, extras: parsed };
    if (parsed && typeof parsed === 'object') return { map: parsed, extras: [] };
  } catch { /* stored text that is not JSON is ignored */ }
  return { map: {}, extras: [] };
}

const assignChannel = (channels, url, overwrite) => {
  const u = String(url ?? '').trim();
  const k = classifyShopUrl(u);
  if (!k) return;
  if (overwrite || !channels[k]) channels[k] = u;
};

// Visible shop link first. When both stored links exist, website is primary (same as the import bar).
export function shopLinkState(seller = {}) {
  const website = String(seller.website ?? '').trim();
  const fb = String(seller.fb_profile ?? '').trim();
  if (website && fb) return { shop_link: website, shop_link_2: fb };
  return { shop_link: website || fb, shop_link_2: '' };
}

// Route typed URLs into website vs fb_profile. Facebook and Depop go to fb_profile; everything else to website.
// A second URL of the same type is kept in the other slot so a typed link is not dropped.
export function shopLinkFields({ shop_link, shop_link_2 } = {}) {
  let website = null, fb_profile = null;
  for (const raw of [shop_link, shop_link_2]) {
    const url = String(raw ?? '').trim();
    if (!url) continue;
    if (isExtensionShop(url)) {
      if (!fb_profile) fb_profile = url;
      else if (!website) website = url;
    } else if (!website) website = url;
    else if (!fb_profile) fb_profile = url;
  }
  return { website, fb_profile };
}

// Full set of shop URLs for the intake form. website / fb_profile win when they disagree with shop_links.
export function parseShopLinks(seller = {}) {
  const channels = Object.fromEntries(SHOP_CHANNELS.map(k => [k, '']));
  const { map, extras } = readLinkMap(seller.shop_links);
  for (const k of SHOP_CHANNELS) {
    const v = String(map[k] ?? '').trim();
    if (v) channels[k] = v;
  }
  for (const raw of extras) assignChannel(channels, raw, false);
  assignChannel(channels, seller.fb_profile, true);
  assignChannel(channels, seller.website, true);
  return channels;
}

// Derive website / fb_profile for the extension and import bar; keep every channel in shop_links.
export function packShopLinks(channels = {}) {
  const clean = {};
  for (const k of SHOP_CHANNELS) {
    const v = String(channels[k] ?? '').trim();
    if (v) clean[k] = v;
  }
  return {
    website: clean.website || clean.poshmark || clean.ebay || null,
    fb_profile: clean.facebook || clean.depop || null,
    shop_links: Object.keys(clean).length ? JSON.stringify(clean) : null,
  };
}

// Apply the one or two links from seller settings without dropping other intake channels.
export function applyPrimaryLinks(seller, { website, fb_profile } = {}) {
  const channels = parseShopLinks(seller);
  const clear = url => {
    const u = String(url ?? '').trim(), k = classifyShopUrl(u);
    if (k && channels[k] === u) channels[k] = '';
  };
  clear(seller.website);
  clear(seller.fb_profile);
  assignChannel(channels, website, true);
  assignChannel(channels, fb_profile, true);
  return packShopLinks(channels);
}

// Open the form from a seller row. Stored values the form no longer shows stay on the object so a save can send them.
export function sellerFormState(seller = {}) {
  return { ...seller, ...shopLinkState(seller) };
}

// Body for POST /api/sellers. Routes shop links and keeps every stored seller field (including contact, notes, and
// sync, which the form no longer shows) so a save cannot blank them. UI-only shop_link fields are not sent.
export function sellerSavePayload(form = {}, extra = {}) {
  const { shop_link, shop_link_2, ...rest } = form;
  const routed = shopLinkFields({ shop_link, shop_link_2 });
  return { ...rest, ...applyPrimaryLinks(rest, routed), ...extra };
}

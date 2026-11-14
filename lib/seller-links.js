// Shop-link helpers for the seller settings form. website and fb_profile stay the stored fields
// (the extension reads fb_profile). The form shows one Shop link, plus an optional second in Advanced.

export const EXTENSION_SHOP = /facebook\.com|depop\.com/i;

export const isExtensionShop = url => EXTENSION_SHOP.test(String(url ?? ''));

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

// Open the form from a seller row. Stored values the form no longer shows stay on the object so a save can send them.
export function sellerFormState(seller = {}) {
  return { ...seller, ...shopLinkState(seller) };
}

// Body for POST /api/sellers. Routes shop links and keeps every stored seller field (including contact, notes, and
// sync, which the form no longer shows) so a save cannot blank them. UI-only shop_link fields are not sent.
export function sellerSavePayload(form = {}, extra = {}) {
  const { shop_link, shop_link_2, ...rest } = form;
  return { ...rest, ...shopLinkFields({ shop_link, shop_link_2 }), ...extra };
}

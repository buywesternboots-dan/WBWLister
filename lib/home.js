// Two screens after the same sign-in. / is the admin interface. /seller is that seller's items only.
export const ADMIN_HOME = '/';
export const SELLER_HOME = '/seller';
export const homeFor = role => role === 'seller' ? SELLER_HOME : ADMIN_HOME;

// Page routes only. API calls are not redirected; the handlers reject the wrong role.
export const redirectFor = (role, pathname) => {
  if (pathname.startsWith('/api') || pathname.startsWith('/_next') || pathname.startsWith('/img') || pathname.startsWith('/feed')) return null;
  const sellerPage = pathname === SELLER_HOME || pathname.startsWith(`${SELLER_HOME}/`);
  if (role === 'seller' && !sellerPage) return SELLER_HOME;
  if (role === 'admin' && sellerPage) return ADMIN_HOME;
  return null;
};

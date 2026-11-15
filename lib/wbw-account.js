// Seller's own account area on Western Boot World. Checked read-only (GET) Nov 15, 2026: the WBW homepage links
// its account views (Watching, Saved searches, Profile & Bio, Settings) at /me; /account, /profile, /settings, /my-account are 404.
export const WBW_ACCOUNT_URL = process.env.NEXT_PUBLIC_WBW_ACCOUNT_URL || 'https://www.westernbootworld.com/me';
export const WBW_ACCOUNT_LABEL = 'My Western Boot World account';

// WBW has no separate signup URL (checked read-only Nov 15, 2026: /signup, /register, /sign-up, /join, /login, /auth are 404).
// Signup is the homepage "Sign In/Register" dialog -> "Create an account" (email, password, confirm, 18+ box).
// Display name, username, location, bio, aliases, and fun fact are set afterwards under /me -> Profile & Bio.
export const WBW_SIGNUP_URL = 'https://www.westernbootworld.com/';
export const WBW_SIGNUP_STEPS = 'On WBW: tap “Sign In/Register”, then “Create an account”. Paste email and password, tick 18+, then fill Profile & Bio under My account.';

// Fields Dan pastes into WBW himself. password value is null: it is revealed (audited) only when he clicks copy.
export function wbwCopyFields(r = {}) {
  const f = [['email', 'Email', r.email]];
  if (!r.has_wbw_account && r.has_password) f.push(['password', 'Temporary password', null]);
  for (const [k, l] of [['display_name', 'Display name'], ['username', 'Username'], ['phone', 'Phone'], ['location', 'Location'],
    ['bio', 'Bio'], ['aliases', 'Aliases'], ['fun_fact', 'Fun fact']]) if (r[k]) f.push([k, l, r[k]]);
  return f.filter(([k, , v]) => k === 'password' || v).map(([key, label, value]) => ({ key, label, value }));
}

// Western Boot World account setup, done by hand. Nothing here talks to WBW.
// Labels and limits checked read-only (GET of the WBW homepage) Nov 15, 2026.
import { EMAIL_PREFS, PAYMENT_METHODS } from './public-intake-constants';

// Seller's own account area on Western Boot World (/me). /account, /profile, /settings, /my-account are 404.
export const WBW_ACCOUNT_URL = process.env.NEXT_PUBLIC_WBW_ACCOUNT_URL || 'https://www.westernbootworld.com/me';
export const WBW_ACCOUNT_LABEL = 'My Western Boot World account';

// WBW has no separate signup URL (/signup, /register, /sign-up, /join, /login, /auth are 404).
// Signup is the homepage "Sign In/Register" dialog -> "Create an account".
export const WBW_SIGNUP_URL = 'https://www.westernbootworld.com/';
export const WBW_SIGNUP_HINT = 'Tap “Sign In/Register”, then “Create an account”.';
// WBW's own password rule shown under its signup box.
export const WBW_PASSWORD_RULE = 'At least 8 characters and a number (WBW rule).';

const payLabel = p => {
  if (!p?.methods?.length) return '';
  const names = p.methods.map(k => k === 'other' ? (p.other || 'Other') : (PAYMENT_METHODS.find(([m]) => m === k)?.[1] || k));
  return names.join(', ');
};

// WBW has one 400-character "Shipping & return policies" box. Build it from the three policy answers.
export function wbwPolicyText(r = {}) {
  const parts = [];
  if (r.shipping_policy) parts.push(`Shipping: ${r.shipping_policy}`);
  if (r.return_policy) parts.push(`Returns: ${r.return_policy}`);
  const pay = payLabel(r.payment_methods);
  if (pay) parts.push(`Preferred payment: ${pay}`);
  return parts.join(' · ');
}

const yn = v => v === true || v === 'yes' ? 'Yes' : v === false || v === 'no' ? 'No' : '';

// The "WBW account setup" panel, in the order Dan fills WBW in.
// Each field: { key, label (WBW's own label), value, copy, max?, note? }.
// copy:false means tick/untick on WBW, no paste. password: value is whatever the caller has (null = reveal on click).
export function wbwSetupSections(r = {}, { password = null } = {}) {
  const has = r.has_wbw_account === true || r.has_wbw_account === 'yes';
  const f = (key, label, value, extra = {}) => ({ key, label, value: value ?? '', copy: true, ...extra });
  const keep = list => list.filter(x => x.key === 'password' || x.key === 'confirm_password' || x.value !== '');
  const prefs = r.email_prefs || {};
  const sections = [];
  if (!has) sections.push({
    key: 'signup', title: 'Create an account (WBW sign-up pop-up)', hint: WBW_SIGNUP_HINT,
    fields: keep([
      f('email', 'Email address', r.email),
      f('password', 'Password', password, { secret: true }),
      f('confirm_password', 'Confirm password', password, { secret: true, note: 'Same as Password.' }),
      f('auth_age', 'I’m 18 or older and agree to the Terms and Privacy Policy.', 'Tick it', { copy: false, note: 'Seller confirms 18+.' }),
    ]),
  });
  sections.push({
    key: 'profile', title: 'My account › Edit profile & bio › Profile & Bio', hint: has ? 'Seller already has a WBW account: sign in as them or send these to them.' : '',
    fields: keep([
      ...(r.photo_url ? [f('photo', 'Change profile picture', r.photo_url, { copy: false, link: r.photo_url, note: 'Open, save, then upload.' })] : []),
      f('display_name', 'Display name', r.display_name, { max: 60 }),
      f('username', 'Username', r.username, { max: 20 }),
      f('aliases', 'Aliases', r.aliases, { max: 160 }),
      f('location', 'Location', r.location, { max: 80 }),
      f('bio', 'Bio', r.bio, { max: 280 }),
      f('fun_fact', 'Fun fact about you', r.fun_fact, { max: 140 }),
    ]),
  });
  sections.push({
    key: 'policies', title: 'Seller Policies & Public Contact/Payment Channels', hint: '',
    fields: keep([
      f('seller_policies', 'Shipping & return policies', wbwPolicyText(r), { max: 400 }),
      f('contact_phone', 'Phone', r.phone, { max: 30, note: 'Only if the seller wants it public.' }),
      f('contact_email', 'Email', r.email, { max: 120, note: 'Only if the seller wants it public.' }),
    ]),
  });
  sections.push({
    key: 'notifications', title: 'Notifications & Hold Alerts', hint: '',
    fields: EMAIL_PREFS.map(([k, l]) => f(`pref_${k}`, l, prefs[k] === false ? 'Off' : 'On', { copy: false })),
  });
  sections.push({
    key: 'application', title: 'My Shop & Inventory › Apply to sell', hint: 'If WBW asks for a seller application, these match its questions. Submitting that on WBW is a separate manual step.',
    fields: keep([
      f('full_name', 'Your name', r.display_name),
      f('application_email', 'Best email to reach you', r.email),
      f('sells_where', 'Where do you sell boots today?', r.sells_where),
      f('boot_focus', 'What kind of boots do you deal in?', r.boot_types),
      f('pairs_estimate', 'Roughly how many pairs would you list?', r.pairs_estimate, { note: 'Separate boots from belts if both were counted.' }),
      f('about', 'Anything else we should know?', r.notes),
    ]),
  });
  return sections.filter(s => s.fields.length);
}

// Answers that have no WBW field. Shown for reference under the panel.
export function bootListerOnly(r = {}) {
  const freq = r.price_change_frequency ? String(r.price_change_frequency).replace(/^other: /, 'Other: ') : '';
  return [
    ['Already has a WBW account', yn(r.has_wbw_account)],
    ['Import listings', r.import_mode === 'live' ? 'Live' : r.import_mode === 'draft' ? 'Drafts' : ''],
    ['Sells belts', yn(r.sells_belts)],
    ['How they measure', r.measurement_method],
    ['Change prices on import', r.pricing_change === 'yes' ? `Yes${r.pricing_notes ? `: ${r.pricing_notes}` : ''}` : r.pricing_change === 'no' ? 'No' : ''],
    ['How often they change prices', freq],
    ['Help build the encyclopedia', yn(r.encyclopedia_help)], ['Photos OK for the encyclopedia', yn(r.encyclopedia_permission)],
    ['Listing shorthand', r.terms], ['Listing defaults', r.defaults], ['WBW brand note', r.brand_context === 'off' ? 'Off' : 'On'],
  ].filter(([, v]) => v);
}

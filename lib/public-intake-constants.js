// Client-safe constants for the open intake form. Keep this file free of server imports
// (lib/auth pulls in Node crypto, which crashes the page in the browser).
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
export const HONEYPOT = 'company';
export const IMPORT_MODES = [
  ['live', 'Live — list them for sale right away'],
  ['draft', 'As drafts in my WBW account, so I can review them there first'],
];
// Duplicate rejection at submit (email or username already used). Says nothing about the other account.
export const DUPLICATE_MESSAGES = {
  seller: 'That email or username is already on BootLister. Sign in instead.',
  intake: 'We already have an intake for that email or username. Dan will be in touch.',
};
export const PAYMENT_METHODS = [
  ['cash', 'Cash'], ['card', 'Card'], ['paypal', 'PayPal'], ['venmo', 'Venmo'], ['cash_app', 'Cash App'], ['zelle', 'Zelle'], ['other', 'Other'],
];
export const PRICE_FREQUENCIES = [['rarely', 'Rarely or never'], ['monthly', 'Monthly'], ['weekly', 'Weekly'], ['daily', 'Daily'], ['other', 'Other']];
export const USERNAME_RE = /^[A-Za-z0-9_]{3,20}$/;
// Max characters per text field, checked on the server (and set as maxLength in the form).
export const INTAKE_LIMITS = {
  display_name: 80, username: 20, email: 254, phone: 30, location: 120, aliases: 300,
  depop: 500, facebook: 500, ebay: 500, poshmark: 500, website: 500,
  bio: 2000, fun_fact: 500, sells_where: 500, boot_types: 500, pairs_estimate: 60, notes: 2000,
  terms: 2000, defaults: 2000,
  measurement_method: 500, price_change_frequency_other: 100,
  pricing_notes: 1000, shipping_policy: 2000, return_policy: 2000, payment_other: 100,
};
// [key, label, helper]. All on by default. Wording from Dan's WBW notification settings screenshot.
export const EMAIL_PREFS_INTRO = 'The bell in the header shows all of these, whether or not you take the email.';
export const EMAIL_PREFS = [
  ['watching', "Email me about pairs I'm watching", 'Get price-drop and sold alerts by email. The header bell always shows them too, whether this is on or off.'],
  ['holds', 'Email me about buy-button holds', 'Get a note when a buyer holds your pair, either side releases it, or the 48-hour hold expires.'],
  ['community_tags', 'Email me when somebody tags me in Community', 'Someone writing @your-handle in a thread or a reply sends you an email with a link straight to it.'],
  ['shootout', 'Email me when somebody beats my Shootout high score', 'Dusty lets you know who took the top spot, with a link back into the game.'],
  ['messages', 'Email me about new messages', 'Sent the moment a buyer or seller writes to you, with a link back to the conversation. Your inbox and the bell show them either way.'],
];

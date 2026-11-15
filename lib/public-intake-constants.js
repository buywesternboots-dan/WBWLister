// Client-safe constants for the public intake form. Keep this file free of server imports
// (lib/auth pulls in Node crypto, which crashes the page in the browser).
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
export const HONEYPOT = 'company';
export const USERNAME_RE = /^[A-Za-z0-9_]{3,20}$/;
// Max characters per text field, checked on the server (and set as maxLength in the form).
export const INTAKE_LIMITS = {
  display_name: 80, username: 20, email: 254, phone: 30, location: 120, aliases: 300,
  depop: 500, facebook: 500, ebay: 500, poshmark: 500, website: 500,
  bio: 2000, fun_fact: 500, sells_where: 500, boot_types: 500, pairs_estimate: 60, notes: 2000,
  terms: 2000, defaults: 2000,
};
// [key, label, helper]. All on by default.
export const EMAIL_PREFS = [
  ['watching', 'Pairs I’m watching', 'Price drops and status changes on pairs you watch.'],
  ['holds', 'Buy-button holds', 'When a buyer places a hold on one of your pairs.'],
  ['community_tags', 'Community tags', 'When someone tags you in the Community.'],
  ['shootout', 'Shootout high score', 'When your Shootout high score is beaten.'],
  ['messages', 'New messages', 'When a buyer or seller sends you a message.'],
];

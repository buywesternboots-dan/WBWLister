// Client-safe constants for the public intake form. Keep this file free of server imports
// (lib/auth pulls in Node crypto, which crashes the page in the browser).
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
export const HONEYPOT = 'company';

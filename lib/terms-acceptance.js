// Server-only helpers for the terms-acceptance portal (Node crypto; never import from a client component).
import { randomBytes } from 'node:crypto';

export const newTermsToken = () => randomBytes(32).toString('base64url');
export const isTermsToken = t => /^[A-Za-z0-9_-]{43}$/.test(String(t ?? ''));
export const termsPath = t => `/terms/accept/${t}`;

export function validateAcceptance(input = {}) {
  if (!(input.accepted === true || input.accepted === 'on' || input.accepted === 'yes')) throw new Error('Please tick "I accept these terms".');
  const full_name = String(input.full_name ?? '').trim();
  if (!full_name) throw new Error('Please type your full name.');
  if (full_name.length > 200) throw new Error('That name is too long.');
  return { full_name };
}

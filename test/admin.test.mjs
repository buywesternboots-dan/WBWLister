import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ADMIN_ACTIONS, guardAction } from '../lib/http.js';

test('photo migration is an admin action checked on the route', () => {
  assert.equal(ADMIN_ACTIONS.includes('migrate'), true);
  const seller = { role: 'seller', seller: 'ada' }, admin = { role: 'admin' };
  assert.throws(() => guardAction(seller, 'migrate'), /Only an admin can do that/);
  assert.equal(guardAction(admin, 'migrate'), undefined);
  const src = readFileSync(new URL('../app/api/migrate-photos/route.js', import.meta.url), 'utf8');
  assert.match(src, /actorFrom/);
  assert.match(src, /guardAction\(who, 'migrate'\)/);
  assert.equal(src.includes('x-app-password'), false);
  assert.equal(src.includes('APP_PASSWORD'), false);
  assert.equal(src.includes('requireAdmin'), false);
});

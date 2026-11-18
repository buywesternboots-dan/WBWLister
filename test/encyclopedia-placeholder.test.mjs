import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = p => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('admin header renders a disabled, unwired send to boot encyclopedia placeholder', () => {
  const comp = read('components/encyclopedia-placeholder.js');
  assert.match(comp, />\s*send to boot encyclopedia\s*</);
  assert.match(comp, /<small>coming soon<\/small>/);
  assert.match(comp, /<input type="checkbox" disabled aria-disabled="true" \/>/);
  assert.doesNotMatch(comp, /onClick|onChange|onInput|fetch\(|useState|useEffect/);

  const screen = read('app/screen.js');
  assert.match(screen, /\{admin && <EncyclopediaPlaceholder \/>\}/);
  assert.equal(screen.includes('{!admin && <EncyclopediaPlaceholder'), false);
  assert.equal(read('app/seller/page.js').includes('EncyclopediaPlaceholder'), false);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { exportReady, missingFields, unverifiedFields, toggleVisibleSelection } from '../lib/review.js';
const item = { id:1, price:100, title:'Boot', brand:'Ariat', sized_for:'Men', condition:'New', guessed:[] };
test('complete unapproved fields never show ready to export',()=>{
  assert.equal(exportReady(item),false);
  assert.equal(exportReady({...item,approved_at:'2026-11-03'}),true);
  assert.equal(exportReady({...item,approved_at:'2026-11-03',guessed:['brand']}),false);
  assert.deepEqual(missingFields({...item,brand:'  '}),['brand']);
  assert.deepEqual(unverifiedFields({...item,guessed:['brand','width'],width:''}),['brand']);
});
test('select rejected or filtered items without selecting hidden or other-group items',()=>{
  const selected=new Set([1,9]);
  const visible=[{id:2},{id:3}];
  const next=toggleVisibleSelection(selected,visible);
  assert.deepEqual([...next],[1,9,2,3]);assert.deepEqual([...selected],[1,9]);
  assert.deepEqual([...toggleVisibleSelection(next,visible)],[1,9]);
  assert.deepEqual([...toggleVisibleSelection(new Set([1,2,9]),visible)],[1,2,9,3]);
  assert.deepEqual([...toggleVisibleSelection(selected,[])],[1,9]);
});

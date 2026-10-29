import assert from 'node:assert/strict';
import test from 'node:test';
import { compareCodeLines } from '../lib/code-diff.ts';

test('separate edits leave unchanged middle lines unmarked',()=>{
  const diff = compareCodeLines(['start','old one','same middle','old two','end'],['start','new one','same middle','new two','end']);
  assert.deepEqual([...diff.removed],[1,3]);
  assert.deepEqual([...diff.added],[1,3]);
  assert.equal(diff.precise,true);
});
test('insertions, deletions, repeated lines and empty files use a consistent sequence alignment',()=>{
  assert.deepEqual([...compareCodeLines(['a','b'],['a','new','b']).added],[1]);
  assert.deepEqual([...compareCodeLines(['a','old','b'],['a','b']).removed],[1]);
  assert.deepEqual([...compareCodeLines(['x','x','x'],['x','x']).removed],[2]);
  assert.deepEqual([...compareCodeLines([],['new']).added],[0]);
  assert.deepEqual([...compareCodeLines(['old'],[]).removed],[0]);
  assert.equal(compareCodeLines(['same'],['same']).removed.size,0);
});
test('large changes stay within the fixed budget and never invent highlighted edits',()=>{
  const diff = compareCodeLines(Array(1100).fill('before'),Array(1100).fill('after'));
  assert.equal(diff.precise,false);
  assert.equal(diff.removed.size,0);
  assert.equal(diff.added.size,0);
});

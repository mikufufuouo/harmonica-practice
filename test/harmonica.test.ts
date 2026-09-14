import assert from 'node:assert/strict';
import test from 'node:test';
import { isConsecutiveHoles, noteFor } from '../src/lib/harmonica.ts';

test('maps C Richter layout and transposes selected keys', () => {
  assert.equal(noteFor('C', 4, 'B'), 'C5');
  assert.equal(noteFor('C', 5, 'D'), 'F5');
  assert.equal(noteFor('G', 1, 'B'), 'G3');
  assert.equal(noteFor('A', 1, 'B'), 'A3');
  assert.equal(noteFor('Bb', 1, 'B'), 'Bb3');
});

test('validates labels as unique continuous holes in range', () => {
  assert.equal(isConsecutiveHoles([4]), true);
  assert.equal(isConsecutiveHoles([4, 5, 6]), true);
  assert.equal(isConsecutiveHoles([4, 6]), false);
  assert.equal(isConsecutiveHoles([4, 4]), false);
  assert.equal(isConsecutiveHoles([]), false);
  assert.equal(isConsecutiveHoles([11]), false);
});

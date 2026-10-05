import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { Puzzle, generateLevel } from './puzzle';

test('the authored solution remains available with no runtime search budget', () => {
  const level = generateLevel(600);
  const puzzle = new Puzzle(level);
  for (const move of level.witness.slice(0, 4)) assert.ok(puzzle.move(move.from, move.to));
  const snapshot = puzzle.snapshot();
  const suffix = puzzle.findSolution(30_000, 0);
  assert.deepEqual(suffix, level.witness.slice(4));
  assert.deepEqual(puzzle.snapshot(), snapshot, 'asking for a hint cannot change the board');
  assert.ok(suffix?.[0] && puzzle.canMove(suffix[0].from, suffix[0].to));
});

test('deviating from the authored path cannot trigger an unbounded hint search', () => {
  const level = generateLevel(21);
  const puzzle = new Puzzle(level);
  const authored = level.witness[0];
  const choices = puzzle.holes.flatMap(from => puzzle.holes
    .filter(to => puzzle.isAttached(from.id) && puzzle.canMove(from.id, to.id) &&
      !(from.id === authored.from && to.id === authored.to))
    .map(to => ({ from: from.id, to: to.id })));
  assert.ok(choices.length);
  const move = choices[(21 * 17) % choices.length];
  assert.ok(puzzle.move(move.from, move.to));
  const snapshot = puzzle.snapshot();
  assert.equal(puzzle.findSolution(30_000, 0), null, 'an exhausted deadline stops the fallback search immediately');
  const started = performance.now();
  const hint = puzzle.hint();
  assert.ok(performance.now() - started < 500, 'the previous multi-second synchronous search is bounded');
  if (hint) assert.ok(puzzle.canMove(hint.from, hint.to));
  assert.deepEqual(puzzle.snapshot(), snapshot, 'even a timed-out search cannot consume a move');
});

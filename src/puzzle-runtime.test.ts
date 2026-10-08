import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { BOARD_ASPECT, Puzzle, dailyPuzzleSeed, generateDailyLevel, generateLevel, plankContains, type Level, type PhysicalPuzzleSnapshot } from './puzzle';

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

const drilledBeam = (): Level => ({
  id: 1, seed: 123, name: 'Drilled beam', difficulty: 1, motif: 'test', par: 2, witness: [],
  holes: [
    { id: 0, x: .3, y: .5, initialScrew: true },
    { id: 1, x: .7, y: .5, initialScrew: true },
    { id: 2, x: .5, y: .08, initialScrew: false },
    { id: 3, x: .9, y: .08, initialScrew: false },
    { id: 4, x: .5, y: .5, initialScrew: false },
    { id: 5, x: .7, y: .5 + .4 / BOARD_ASPECT, initialScrew: false },
  ],
  planks: [{ id: 0, x: .5, y: .5, angle: 0, length: .5, width: .055, layer: 0, skin: 0, pinHoles: [0, 1] }],
});
const physicalBeam = () => new Puzzle(drilledBeam(), undefined, { physical: true });

test('a bolt can return into the same material drill, but not through solid wood', () => {
  const puzzle = physicalBeam();
  assert.equal(puzzle.canMove(0, 4), false, 'the board hole is hidden behind undrilled wood');
  assert.ok(puzzle.move(0, 2));
  assert.deepEqual(puzzle.remainingPins(0), [1]);
  assert.equal(puzzle.canMove(2, 0), true, 'the vacated drill is still aligned with the board hole');
  assert.ok(puzzle.move(2, 0));
  assert.deepEqual(puzzle.remainingPins(0), [0, 1]);
  assert.equal(puzzle.getSupportBindings(0)[0].material, 0);
  assert.equal(puzzle.getPose(0).width, .055 * 1.1);
});

test('parking requires clearance for the entire metal shaft beside a material edge', () => {
  const level = drilledBeam();
  const halfWidth = level.planks[0].width * 1.1 / 2;
  level.holes.push({ id: 6, x: .5, y: .5 + (halfWidth + .01) / BOARD_ASPECT, initialScrew: false },
    { id: 7, x: .5, y: .5 + (halfWidth + .015) / BOARD_ASPECT, initialScrew: false });
  const puzzle = new Puzzle(level, undefined, { physical: true });
  assert.equal(puzzle.canMove(0, 6), false, 'a visible hole centre cannot insert a metal shaft into the wooden edge');
  assert.equal(puzzle.canMove(0, 7), true, 'clear space beyond the shaft radius remains a usable parking hole');
});

test('material drills follow actual rotation and bind a different aligned board hole', () => {
  const puzzle = physicalBeam();
  assert.ok(puzzle.move(0, 2));
  puzzle.syncPhysics([{ id: 0, x: .7, y: .5 + .2 / BOARD_ASPECT,
    angle: -Math.PI / 2, vx: .02, vy: .03, angularVelocity: -.04 }]);
  const freeDrill = puzzle.getDrillWorldPoints(0)[0];
  assert.ok(Math.abs(freeDrill.x - .7) < 1e-8);
  assert.ok(Math.abs(freeDrill.y - puzzle.holes[5].y) < 1e-8);
  assert.equal(puzzle.canMove(2, 5), true);
  assert.ok(puzzle.move(2, 5));
  assert.deepEqual(puzzle.remainingPins(0), [5, 1]);
  assert.equal(puzzle.getSupportBindings(0)[0].hole, 5);
  assert.equal(puzzle.getPose(0).pivotHole, null, 'the returned bolt is a real second support');
});

test('a displaced original board hole no longer reattaches the beam', () => {
  const puzzle = physicalBeam();
  assert.ok(puzzle.move(0, 2));
  puzzle.syncPhysics([{ id: 0, x: .7, y: .5 + .2 / BOARD_ASPECT,
    angle: -Math.PI / 2, vx: 0, vy: 0, angularVelocity: 0 }]);
  assert.ok(puzzle.move(2, 0), 'the original board hole is now exposed');
  assert.deepEqual(puzzle.remainingPins(0), [1], 'a nearby parked bolt does not catch a displaced material hole');
  assert.equal(puzzle.isAttached(0), false);
});

test('free beams remain until physics reports falling and undo restores supports and velocities', () => {
  const puzzle = physicalBeam();
  assert.ok(puzzle.move(0, 2));
  puzzle.syncPhysics([{ id: 0, x: .7, y: .5 + .2 / BOARD_ASPECT,
    angle: -Math.PI / 2, vx: .025, vy: .015, angularVelocity: .125 }]);
  const before = puzzle.snapshot();
  assert.ok(puzzle.removeScrew(1));
  assert.equal(puzzle.removed[0], false);
  assert.equal(puzzle.solved, false);
  puzzle.syncPhysics([{ id: 0, x: .7, y: 2, angle: -Math.PI / 2,
    vx: .025, vy: 2, angularVelocity: .125 }], [0]);
  assert.equal(puzzle.solved, true);
  assert.ok(puzzle.undo());
  assert.deepEqual(puzzle.snapshot(), before);
  assert.deepEqual(puzzle.remainingPins(0), [1]);
  assert.equal(puzzle.getPose(0).angularVelocity, .125);
});

test('physical saves round-trip actual bindings and reject corrupt supports', () => {
  const puzzle = physicalBeam();
  assert.ok(puzzle.move(0, 2));
  puzzle.syncPhysics([{ id: 0, x: .7, y: .5 + .2 / BOARD_ASPECT,
    angle: -Math.PI / 2, vx: .02, vy: .03, angularVelocity: -.04 }]);
  assert.ok(puzzle.move(2, 5));
  const saved = puzzle.snapshot() as PhysicalPuzzleSnapshot;
  const resumed = new Puzzle(drilledBeam(), saved, { physical: true });
  assert.deepEqual(resumed.snapshot(), saved);
  const corrupt = structuredClone(saved);
  corrupt.bindings[0][0] = 2;
  assert.equal(resumed.restore(corrupt), false, 'an unoccupied board hole cannot be a support');
  corrupt.bindings[0][0] = 1;
  assert.equal(resumed.restore(corrupt), false, 'two material drills cannot share the same board hole');
  assert.deepEqual(resumed.snapshot(), saved, 'failed restore does not mutate live play');
});

test('legacy settled saves convert to continuous bodies without losing progress', () => {
  const level = drilledBeam(), logical = new Puzzle(level);
  assert.ok(logical.move(0, 2));
  const physical = new Puzzle(level, logical.snapshot(), { physical: true });
  assert.equal(physical.snapshot().version, 2);
  assert.deepEqual(physical.remainingPins(0), [1]);
  const oldPose = logical.getPose(0), pose = physical.getPose(0);
  assert.equal(pose.x, oldPose.x);
  assert.equal(pose.y, oldPose.y);
  assert.equal(pose.angle, oldPose.angle);
  assert.equal(physical.moves, 1);
});

test('a hint removes the real resting contact instead of swapping unrelated parked bolts', () => {
  const puzzle = physicalBeam();
  assert.ok(puzzle.move(0, 2));
  assert.ok(puzzle.move(1, 3));
  const beamTop = puzzle.holes[3].y;
  const pose = { id: 0, x: .9, y: beamTop + (.055 * 1.1 / 2) / BOARD_ASPECT,
    angle: 0, vx: 0, vy: 0, angularVelocity: 0 };
  puzzle.syncPhysics([pose]);
  assert.equal(puzzle.hint(), null, 'with no supports/contact, gravity is allowed to finish');
  assert.equal(puzzle.canSelect(3), false, 'solid-wood overlap alone cannot expose a covered bolt');
  puzzle.syncPhysics([pose], [], [{ plank: 0, hole: 3 }]);
  assert.equal(puzzle.remainingScrews, 0);
  assert.equal(puzzle.canSelect(3), true, 'the shaft resting on the material edge remains accessible');
  const hint = puzzle.hint();
  assert.ok(hint);
  assert.equal(hint.from, 3, 'select the real contact, not the unrelated screw in hole 2');
  assert.ok(puzzle.canMove(hint.from, hint.to));
  assert.ok(puzzle.move(hint.from, hint.to));
});

test('ordinary recovery parking and drill boosts keep mobile screw heads apart', () => {
  for (const id of [10, 30, 65, 79, 153, 259, 600]) {
    const level = generateLevel(id), puzzle = new Puzzle(level, undefined, { physical: true });
    for (let drill = 0; drill < 3; drill++) {
      const added = puzzle.addExtraHole();
      assert.ok(added, `Level ${id} keeps three available drill positions`);
      assert.ok(added.y >= .065, 'new screw heads stay inside the board frame');
      assert.ok(puzzle.livePlanks.every(p => !plankContains(p, added, .025)), 'a drill opens currently clear space');
    }
    for (const a of puzzle.holes) for (const b of puzzle.holes) if (a.id < b.id) {
      assert.ok(Math.hypot(a.x - b.x, (a.y - b.y) * BOARD_ASPECT) >= 26 / 300,
        `Level ${id} keeps bolt heads ${a.id}/${b.id} apart`);
    }
  }
});

test('repeated physical undo restores the initial hint order without stale cycle penalties', () => {
  const level = generateLevel(30), puzzle = new Puzzle(level, undefined, { physical: true });
  const initial = puzzle.hint();
  assert.ok(initial);
  assert.equal(initial.from, level.witness[0].from);
  for (let repetition = 0; repetition < 4; repetition++) {
    assert.ok(puzzle.move(initial.from, initial.to));
    assert.ok(puzzle.undo());
    assert.deepEqual(puzzle.hint(), initial, 'the undone move cannot suppress a valid authored source or destination');
    assert.ok(puzzle.canMove(initial.from, initial.to));
  }
});

test('daily geometry has a shared dated catalogue seed and rejects old raw-date saves', () => {
  const date = '2026-10-08', seed = dailyPuzzleSeed(date);
  assert.equal(seed, dailyPuzzleSeed(date));
  assert.notEqual(seed, dailyPuzzleSeed('2026-10-09'));
  assert.notEqual(seed, Number(date.replaceAll('-', '')));
  const level = generateDailyLevel(date);
  assert.equal(level.seed, seed);
  const puzzle = new Puzzle(level, undefined, { physical: true }), save = puzzle.snapshot();
  assert.ok(puzzle.restore(save));
  save.seed = Number(date.replaceAll('-', ''));
  assert.equal(puzzle.restore(save), false);
});

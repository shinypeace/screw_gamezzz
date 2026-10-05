import test from 'node:test';
import assert from 'node:assert/strict';
import { Puzzle, generateLevel, type Level } from './puzzle';
import { BoardPhysics, BOLT_RADIUS, PLANK_WIDTH_SCALE, PHYSICS_ASPECT } from './board-physics';

function advance(board: BoardPhysics, puzzle: Puzzle, seconds: number) {
  for (let i = 0; i < Math.round(seconds * 120); i++) {
    board.step(1 / 120); puzzle.syncPhysics(board.getPoses(), board.getFallenIds());
  }
}

test('a released strip accelerates under gravity, swings past vertical and preserves its drilled hinge', () => {
  const puzzle = new Puzzle(generateLevel(1), undefined, { physical: true });
  const board = new BoardPhysics(puzzle.level, puzzle);
  assert.equal(board.getPoses()[0].width, puzzle.level.planks[0].width * PLANK_WIDTH_SCALE);
  assert.ok(puzzle.move(3, 0)); board.syncPuzzle(puzzle);
  board.step(1 / 120); puzzle.syncPhysics(board.getPoses());
  assert.ok(Math.abs(board.getPoses()[0].angle) < .005);
  let minimumAngle = 0;
  for (let i = 0; i < 600; i++) {
    board.step(1 / 120); puzzle.syncPhysics(board.getPoses());
    minimumAngle = Math.min(minimumAngle, board.getPoses()[0].angle);
    const hinge = board.getDrilledHoles(0)[1], anchor = puzzle.holes[4];
    assert.ok(Math.hypot(hinge.x - anchor.x, (hinge.y - anchor.y) * PHYSICS_ASPECT) < .0015);
  }
  assert.ok(minimumAngle < -1.8, 'gravity must produce a real pendulum overshoot');
  assert.ok(Math.abs(board.getPoses()[0].angle + Math.PI / 2) < .2, 'air friction should gradually settle the swing');
});

test('removing the top screw of an upright beam tips the unstable beam around its lower screw', () => {
  const level: Level = { id: 1, seed: 1, name: 'upright', difficulty: 1, motif: 'beam', witness: [], par: 2,
    holes: [{ id: 0, x: .5, y: .3, initialScrew: true }, { id: 1, x: .5, y: .7, initialScrew: true }],
    planks: [{ id: 0, x: .5, y: .5, length: .6, width: .055, angle: Math.PI / 2, layer: 0, skin: 0, pinHoles: [0, 1] }] };
  const puzzle = new Puzzle(level, undefined, { physical: true }), board = new BoardPhysics(level, puzzle);
  assert.ok(puzzle.removeScrew(0)); board.syncPuzzle(puzzle);
  assert.ok(Math.abs(board.getPoses()[0].angle - Math.PI / 2) < .015, 'only a tiny physical asymmetry is applied');
  advance(board, puzzle, 4);
  assert.ok(board.getPoses()[0].y > .83, 'the center of mass must fall below the remaining screw');
  assert.ok(Math.abs(board.getPoses()[0].angularVelocity) > .15, 'the strip is still naturally swinging');
  const support = board.getDrilledHoles(0)[1];
  assert.ok(Math.hypot(support.x - .5, (support.y - .7) * PHYSICS_ASPECT) < .0015);
});

test('an unattached strip collides with a parked metal screw instead of passing through it', () => {
  const level: Level = { id: 1, seed: 1, name: 'collision', difficulty: 1, motif: 'beam', witness: [], par: 2,
    holes: [{ id: 0, x: .34, y: .22, initialScrew: true }, { id: 1, x: .66, y: .22, initialScrew: true },
      { id: 2, x: .5, y: .65, initialScrew: true }],
    planks: [{ id: 0, x: .5, y: .22, length: .42, width: .055, angle: 0, layer: 0, skin: 0, pinHoles: [0, 1] }] };
  const puzzle = new Puzzle(level, undefined, { physical: true }), board = new BoardPhysics(level, puzzle);
  assert.ok(puzzle.removeScrew(0)); board.syncPuzzle(puzzle);
  assert.ok(puzzle.removeScrew(1)); board.syncPuzzle(puzzle);
  let contactFrames = 0, maximumPenetration = 0;
  let reportedContact = false;
  for (let i = 0; i < 480; i++) {
    board.step(1 / 120); puzzle.syncPhysics(board.getPoses(), board.getFallenIds());
    reportedContact ||= board.getContacts().some(contact => contact.plank === 0 && contact.hole === 2);
    const pose = board.getPoses()[0]; if (!pose) continue;
    const dx = .5 - pose.x, dy = (.65 - pose.y) * PHYSICS_ASPECT;
    const along = dx * Math.cos(pose.angle) + dy * Math.sin(pose.angle);
    const normal = -dx * Math.sin(pose.angle) + dy * Math.cos(pose.angle);
    // The endpoint drills are real voids, so a shaft may pass through them.
    if (Math.abs(along) < pose.length / 2 - .025 && Math.abs(Math.abs(along) - .16) > .025) {
      const penetration = pose.width / 2 + BOLT_RADIUS - Math.abs(normal);
      maximumPenetration = Math.max(maximumPenetration, penetration);
      if (penetration > -.001) contactFrames++;
    }
  }
  assert.ok(contactFrames > 15, 'the beam should rest or slide against the screw for several frames');
  assert.equal(reportedContact, true, 'hints must know which actual screw is holding the beam');
  assert.ok(maximumPenetration < .0025, `solid metal penetration ${maximumPenetration}`);
});

test('pause preserves physics and undo restores material poses and support constraints', () => {
  const puzzle = new Puzzle(generateLevel(1), undefined, { physical: true });
  const board = new BoardPhysics(puzzle.level, puzzle);
  const initial = board.snapshot();
  assert.ok(puzzle.move(3, 0)); board.syncPuzzle(puzzle); advance(board, puzzle, .6);
  const moving = board.snapshot();
  for (let i = 0; i < 20; i++) board.step(0);
  assert.deepEqual(board.snapshot(), moving);
  assert.ok(puzzle.undo()); board.syncPuzzle(puzzle);
  assert.deepEqual(board.snapshot().poses, initial.poses);
  advance(board, puzzle, .5);
  assert.deepEqual(board.snapshot().poses, initial.poses);
});

test('restarting after a fallen strip does not apply stale fallen ids to the restored beam', () => {
  const puzzle = new Puzzle(generateLevel(1), undefined, { physical: true });
  const board = new BoardPhysics(puzzle.level, puzzle);
  assert.ok(puzzle.removeScrew(3)); board.syncPuzzle(puzzle);
  assert.ok(puzzle.removeScrew(4)); board.syncPuzzle(puzzle); advance(board, puzzle, 2);
  assert.equal(puzzle.solved, true); assert.deepEqual(board.getFallenIds(), [0]);
  assert.ok(puzzle.undo()); board.syncPuzzle(puzzle); puzzle.syncPhysics(board.getPoses(), board.getFallenIds());
  assert.equal(puzzle.solved, false); assert.deepEqual(board.getFallenIds(), []);
  assert.equal(board.getPoses().length, 1);
});

test('a dense layered board releases occluded screws without injecting explosive collision energy', () => {
  const puzzle = new Puzzle(generateLevel(281), undefined, { physical: true });
  const board = new BoardPhysics(puzzle.level, puzzle);
  for (let frame = 0; frame < 180; frame++) {
    if (frame % 6 === 0) {
      const screw = puzzle.holes.find(hole => puzzle.screws[hole.id] && puzzle.canSelect(hole.id));
      if (screw) { assert.ok(puzzle.removeScrew(screw.id)); board.syncPuzzle(puzzle); }
    }
    board.step(1 / 60); puzzle.syncPhysics(board.getPoses(), board.getFallenIds(), board.getContacts());
    for (const pose of board.getPoses()) {
      assert.ok(Math.hypot(pose.vx, pose.vy) < 8, 'initial overlap must not launch a beam across the board');
      assert.ok(Math.abs(pose.angularVelocity) < 20, 'a compound strip must retain its real rotational inertia');
    }
  }
});

test('physical snapshots round-trip a moving beam position and velocity', () => {
  const puzzle = new Puzzle(generateLevel(1), undefined, { physical: true });
  const board = new BoardPhysics(puzzle.level, puzzle);
  assert.ok(puzzle.removeScrew(3)); board.syncPuzzle(puzzle); advance(board, puzzle, .4);
  const snapshot = board.snapshot(); advance(board, puzzle, .8);
  assert.equal(board.restore(snapshot), true);
  const restored = board.snapshot();
  for (const key of ['x', 'y', 'angle', 'vx', 'vy', 'angularVelocity'] as const)
    assert.ok(Math.abs(snapshot.poses[0][key] - restored.poses[0][key]) < 1e-9, `${key} should survive save/restore`);
});

test('resuming a loose strip on a parked screw preserves the solid support', () => {
  const level: Level = { id: 1, seed: 1, name: 'resume contact', difficulty: 1, motif: 'beam', witness: [], par: 2,
    holes: [{ id: 0, x: .34, y: .22, initialScrew: true }, { id: 1, x: .66, y: .22, initialScrew: true },
      { id: 2, x: .5, y: .65, initialScrew: true }],
    planks: [{ id: 0, x: .5, y: .22, length: .42, width: .055, angle: 0, layer: 0, skin: 0, pinHoles: [0, 1] }] };
  const puzzle = new Puzzle(level, undefined, { physical: true }), board = new BoardPhysics(level, puzzle);
  assert.ok(puzzle.removeScrew(0)); board.syncPuzzle(puzzle);
  assert.ok(puzzle.removeScrew(1)); board.syncPuzzle(puzzle);
  advance(board, puzzle, 1);
  assert.ok(board.getContacts().some(contact => contact.hole === 2));
  const resumed = new Puzzle(level, puzzle.snapshot(), { physical: true });
  const resumedBoard = new BoardPhysics(level, resumed);
  advance(board, puzzle, .1); advance(resumedBoard, resumed, .1);
  assert.ok(resumedBoard.getContacts().some(contact => contact.hole === 2));
  assert.ok(Math.abs(board.getPoses()[0].y - resumedBoard.getPoses()[0].y) < .003);
});

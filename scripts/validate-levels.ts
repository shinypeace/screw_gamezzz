import { strict as assert } from 'node:assert';
import { BOARD_ASPECT, LEVEL_COUNT, Puzzle, generateDailyLevel, generateLevel, plankContains } from '../src/puzzle.ts';
import { structuralSignature } from './level-structure.ts';

const started = Date.now();
let moves = 0, planks = 0, maxMoves = 0, minMoves = Infinity;
const motifs = new Map<string, number>();
const unique = new Set<string>();
const silhouettes = new Set<string>();
let initiallyBlocked = 0;
const first30: { level: number; motif: string; strips: number; pins: number; blocked: number; par: number }[] = [];
const recentlySeenMotifs: string[] = [];

for (let n = 1; n <= LEVEL_COUNT; n++) {
  const level = generateLevel(n);
  assert.equal(level.id, n);
  assert.ok(level.planks.length >= 1 && level.planks.length <= 25);
  assert.ok(level.holes.every((h, i) => h.id === i && h.x >= 0 && h.x <= 1 && h.y >= 0 && h.y <= 1));
  assert.ok(level.planks.every((p, i) => p.id === i && p.pinHoles.length >= 2));
  assert.ok(level.witness.length > 0);
  // At the smallest reference board (300 logical px), 26px screw-head art
  // must not overlap another screw or an empty destination hole.
  for (const a of level.holes) for (const b of level.holes) if (a.id < b.id) {
    assert.ok(Math.hypot(a.x - b.x, (a.y - b.y) * BOARD_ASPECT) * 300 >= 26,
      `Level ${n}: screw heads ${a.id}/${b.id} overlap on the compact mobile board`);
  }
  // Position jitter, a new skin, or another angle must never masquerade as a
  // new puzzle. Reject repeat mechanical graphs AND identical beam drawings.
  const signature = structuralSignature(level);
  assert.ok(!unique.has(signature), `Level ${n}: repeated support/contact/dependency graph`);
  unique.add(signature);
  const silhouette = JSON.stringify(level.planks.map(p => [Math.round(p.x * 1000), Math.round(p.y * 1000),
    Math.round(p.length * 1000), Math.round(((p.angle % Math.PI) + Math.PI) % Math.PI * 1000)])
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))));
  assert.ok(!silhouettes.has(silhouette), `Level ${n}: identical beam silhouette`);
  silhouettes.add(silhouette);
  motifs.set(level.motif, (motifs.get(level.motif) ?? 0) + 1);
  if (n > 30) {
    assert.ok(level.planks.length >= 17, `Level ${n}: a late board must not regress to a small tutorial construction`);
    assert.ok(!recentlySeenMotifs.slice(-5).includes(level.motif), `Level ${n}: architecture repeated within five preceding boards`);
  }
  recentlySeenMotifs.push(level.motif);
  const puzzle = new Puzzle(level);
  const blocked = level.holes.filter(h => h.initialScrew && !puzzle.canSelect(h.id)).length;
  const minimumBlocked = n >= 300 ? 3 : n >= 150 ? 2 : n >= 10 ? 1 : 0;
  assert.ok(blocked >= minimumBlocked, `Level ${n}: release-order constraints must rise with campaign progress`);
  initiallyBlocked += blocked;
  if (n <= 30) first30.push({ level: n, motif: level.motif, strips: level.planks.length,
    pins: level.holes.filter(h => h.initialScrew).length, blocked, par: level.par });
  for (let i = 0; i < level.witness.length; i++) {
    const step = level.witness[i];
    assert.ok(puzzle.screws[step.from], `Level ${n}, move ${i}: source is occupied`);
    assert.ok(!puzzle.screws[step.to], `Level ${n}, move ${i}: destination is empty`);
    assert.ok(puzzle.canSelect(step.from), `Level ${n}, move ${i}: source is reachable`);
    assert.ok(puzzle.canMove(step.from, step.to), `Level ${n}, move ${i}: move is legal`);
    const before = puzzle.snapshot();
    const result = puzzle.move(step.from, step.to);
    assert.ok(result);
    const after = puzzle.snapshot();
    assert.equal(after.screws.filter(Boolean).length, before.screws.filter(Boolean).length, 'Relocation conserves screws');
    assert.ok(puzzle.undo());
    assert.deepEqual(puzzle.snapshot(), before, `Level ${n}: undo restores the whole logical board`);
    assert.ok(puzzle.move(step.from, step.to));
    const resumed = new Puzzle(level, puzzle.snapshot());
    assert.deepEqual(resumed.snapshot(), puzzle.snapshot(), `Level ${n}: saved checkpoint round trip`);
    for (const p of puzzle.livePlanks) {
      assert.ok(Number.isFinite(p.x + p.y + p.angle));
      if (p.pivotHole !== null) assert.ok(plankContains(p, puzzle.holes[p.pivotHole], .001), 'A hinge stays on the supporting screw');
    }
  }
  assert.ok(puzzle.solved, `Level ${n}: replay actually clears all planks`);
  assert.equal(puzzle.moves, level.par);
  assert.equal(puzzle.hint(), null);
  const won = puzzle.snapshot();
  assert.equal(puzzle.addExtraHole(), null, 'Completed puzzles reject additional gameplay mutations');
  const occupied = puzzle.holes.find(h => puzzle.screws[h.id]);
  if (occupied) assert.equal(puzzle.removeScrew(occupied.id), null, 'A parked screw cannot trigger another win');
  assert.deepEqual(puzzle.snapshot(), won);
  moves += level.par; planks += level.planks.length;
  maxMoves = Math.max(maxMoves, level.par); minMoves = Math.min(minMoves, level.par);
  if (n % 100 === 0) process.stdout.write(`Validated ${n}/${LEVEL_COUNT} levels in ${((Date.now() - started) / 1000).toFixed(1)}s\n`);
}

// Daily challenges are deterministic per day, vary across dates, and are solved
// using the exact same rules as campaign levels.
for (const date of ['2026-10-05', '2026-10-06', '2026-11-01', '2027-01-01', '2028-02-29']) {
  const a = generateDailyLevel(date), b = generateDailyLevel(date);
  assert.deepEqual(a, b, 'Daily generation is deterministic');
  const puzzle = new Puzzle(a);
  a.witness.forEach(m => assert.ok(puzzle.move(m.from, m.to)));
  assert.ok(puzzle.solved);
}

// Booster and checkpoint contract checks matter for purchases and cloud save.
const boosted = new Puzzle(generateLevel(1));
const source = boosted.holes.find(h => boosted.screws[h.id] && boosted.canSelect(h.id));
assert.ok(source);
const original = boosted.snapshot();
assert.ok(boosted.removeScrew(source.id));
assert.equal(boosted.screws.filter(Boolean).length, original.screws.filter(Boolean).length - 1);
assert.ok(boosted.undo()); assert.deepEqual(boosted.snapshot(), original);
const extra = boosted.addExtraHole(); assert.ok(extra && !boosted.screws[extra.id]);
assert.ok(boosted.isHoleExposed(extra.id));
assert.ok(boosted.undo()); assert.deepEqual(boosted.snapshot(), original);
const corrupted = boosted.snapshot(); corrupted.removed[0] = true;
assert.equal(boosted.restore(corrupted), false, 'Corrupt saved support states are rejected');
assert.equal(BOARD_ASPECT, 1.2);
assert.equal(unique.size, LEVEL_COUNT, 'Every campaign graph is mechanically distinct');
assert.equal(silhouettes.size, LEVEL_COUNT, 'Every campaign has a distinct arrangement of beams');
assert.equal(new Set(first30.map(l => l.motif)).size, 30, 'All first thirty teaching architectures differ');
assert.ok(first30[0].strips <= 2, 'The tutorial is short');
assert.ok(first30[4].strips >= 6 && first30[9].strips >= 10 && first30[19].strips >= 16,
  'Complexity rises within the first twenty levels, not after hundreds of boards');
const earlyAverage = first30.slice(0, 5).reduce((n, l) => n + l.par, 0) / 5;
const twentiethAverage = first30.slice(15, 20).reduce((n, l) => n + l.par, 0) / 5;
assert.ok(twentiethAverage >= earlyAverage * 3, 'Mid-tutorial release decisions are at least three times deeper');
assert.ok(initiallyBlocked > 600, 'Covered lower supports create genuine release-order constraints');
assert.ok(first30.slice(10, 20).some(l => l.blocked > 0), 'Early progression introduces covered pins');

// The old validator included skin and unrounded angles in its uniqueness
// check. This regression fixture changes those values while preserving the
// puzzle, and proves that the replacement check rejects such a duplicate.
const originalGeometry = generateLevel(20), rotated = structuredClone(originalGeometry);
const angle = .31, c = Math.cos(angle), s = Math.sin(angle);
const rotate = (x: number, y: number) => {
  const dx = x - .5, dy = (y - .55) * BOARD_ASPECT;
  return { x: .5 + dx * c - dy * s, y: .55 + (dx * s + dy * c) / BOARD_ASPECT };
};
rotated.holes.forEach(h => Object.assign(h, rotate(h.x, h.y)));
rotated.planks.forEach(p => { Object.assign(p, rotate(p.x, p.y)); p.angle += angle; p.skin = (p.skin + 2) % 4; });
rotated.seed ^= 1234;
assert.equal(structuralSignature(rotated), structuralSignature(originalGeometry),
  'A rigidly rotated, reskinned copy cannot pass as a unique level');
assert.deepEqual(generateLevel(originalGeometry.id, originalGeometry.seed), originalGeometry, 'Checkpoint seeds reconstruct campaign geometry');
const custom = generateLevel(1, 123456);
assert.deepEqual(generateLevel(custom.id, custom.seed), custom, 'Checkpoint seeds reconstruct daily/custom geometry');

process.stdout.write(JSON.stringify({ levels: LEVEL_COUNT, uniqueMechanicalGraphs: unique.size, uniqueSilhouettes: silhouettes.size,
  initiallyBlockedPins: initiallyBlocked, earlyAverageMoves: earlyAverage, level16to20AverageMoves: twentiethAverage,
  first30, totalPlanks: planks,
  legalSolutionMoves: moves, minMoves, maxMoves, motifs: Object.fromEntries(motifs),
  elapsedSeconds: +(Date.now() - started).toFixed(0) / 1000 }, null, 2) + '\n');

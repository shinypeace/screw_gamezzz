import { strict as assert } from 'node:assert';
import { BOARD_ASPECT, LEVEL_COUNT, Puzzle, generateDailyLevel, generateLevel, plankContains } from '../src/puzzle.ts';

const started = Date.now();
let moves = 0, planks = 0, maxMoves = 0, minMoves = Infinity;
const motifs = new Map<string, number>();
const unique = new Set<string>();

for (let n = 1; n <= LEVEL_COUNT; n++) {
  const level = generateLevel(n);
  assert.equal(level.id, n);
  assert.ok(level.planks.length >= 4 && level.planks.length <= 16);
  assert.ok(level.holes.every((h, i) => h.id === i && h.x >= 0 && h.x <= 1 && h.y >= 0 && h.y <= 1));
  assert.ok(level.planks.every((p, i) => p.id === i && p.pinHoles.length >= 2));
  assert.ok(level.witness.length > 0);
  // At the smallest reference board (300 logical px), 26px screw-head art
  // must not overlap another screw or an empty destination hole.
  for (const a of level.holes) for (const b of level.holes) if (a.id < b.id) {
    assert.ok(Math.hypot(a.x - b.x, (a.y - b.y) * BOARD_ASPECT) * 300 >= 26,
      `Level ${n}: screw heads ${a.id}/${b.id} overlap on the compact mobile board`);
  }
  unique.add(JSON.stringify(level.planks.map(p => [p.x, p.y, p.length, p.angle, p.skin])));
  motifs.set(level.motif, (motifs.get(level.motif) ?? 0) + 1);
  const puzzle = new Puzzle(level);
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
assert.ok(unique.size >= 590, `Campaign should vary visually: only ${unique.size} unique boards`);

process.stdout.write(JSON.stringify({ levels: LEVEL_COUNT, uniqueBoards: unique.size, totalPlanks: planks,
  legalSolutionMoves: moves, minMoves, maxMoves, motifs: Object.fromEntries(motifs),
  elapsedSeconds: +(Date.now() - started).toFixed(0) / 1000 }, null, 2) + '\n');

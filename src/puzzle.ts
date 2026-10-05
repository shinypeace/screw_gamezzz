/** Pure, deterministic rules for the wooden screw puzzle. Coordinates are in
 * board units: x/y are normalized, lengths use board width, angles use radians.
 * The reference board is 1 × 1.2. Rendering can tween getPose() between moves. */
export const LEVEL_COUNT = 600;
export const BOARD_ASPECT = 1.2;

export interface Hole { id: number; x: number; y: number; initialScrew: boolean; extra?: boolean }
export interface Plank {
  id: number; x: number; y: number; length: number; width: number;
  angle: number; layer: number; skin: number; pinHoles: number[];
}
export interface PlankPose extends Plank { remainingPins: number[]; pivotHole: number | null }
export interface Move { from: number; to: number }
export interface Level {
  id: number; seed: number; name: string; difficulty: number; holes: Hole[];
  planks: Plank[]; witness: Move[]; par: number; motif: string;
}
export interface PuzzleSnapshot {
  version: 1; levelId: number; seed: number; screws: boolean[];
  released: boolean[]; removed: boolean[]; moves: number; holes: Hole[];
}
export interface MoveResult extends Move {
  dropped: number[];
  pivots: { id: number; before: PlankPose; after: PlankPose }[];
  before: PlankPose[];
}

function seeded(seed: number) {
  let s = seed >>> 0;
  return () => {
    s += 0x6d2b79f5;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const sq = (v: number) => v * v;
const round = (v: number) => Math.round(v * 100000) / 100000;
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

/** Rectangle intersection in the same metric as the canvas renderer. */
export function plankContains(p: Pick<Plank, 'x' | 'y' | 'angle' | 'length' | 'width'>, h: Pick<Hole, 'x' | 'y'>, margin = 0): boolean {
  const dx = h.x - p.x, dy = (h.y - p.y) * BOARD_ASPECT;
  const c = Math.cos(p.angle), s = Math.sin(p.angle);
  return Math.abs(dx * c + dy * s) <= p.length / 2 + margin &&
    Math.abs(-dx * s + dy * c) <= p.width / 2 + margin;
}

/** A moved screw is attached only to the board. It never magically reattaches
 * a strip when placed in a hole that the strip has already swung away from. */
export class Puzzle {
  readonly level: Level;
  holes: Hole[];
  planks: Plank[];
  screws: boolean[];
  released: boolean[];
  removed: boolean[];
  selected: number | null = null;
  moves = 0;
  private history: PuzzleSnapshot[] = [];

  constructor(level: Level, snapshot?: PuzzleSnapshot) {
    this.level = level;
    this.holes = clone(level.holes);
    this.planks = clone(level.planks);
    this.screws = this.holes.map(h => h.initialScrew);
    this.released = this.holes.map(h => !h.initialScrew);
    this.removed = this.planks.map(() => false);
    if (snapshot) this.restore(snapshot);
  }

  get solved(): boolean { return this.removed.every(Boolean); }
  get canUndo(): boolean { return this.history.length > 0; }
  get livePlanks(): PlankPose[] {
    return this.planks.filter(p => !this.removed[p.id]).map(p => this.getPose(p.id));
  }
  get remainingScrews(): number {
    return this.holes.reduce((n, h) => n + (this.screws[h.id] && this.isAttached(h.id) ? 1 : 0), 0);
  }
  remainingPins(id: number): number[] {
    return this.planks[id].pinHoles.filter(h => !this.released[h] && this.screws[h]);
  }
  isAttached(hole: number): boolean {
    return !this.released[hole] && this.planks.some(p => !this.removed[p.id] && p.pinHoles.includes(hole));
  }

  getPose(id: number): PlankPose {
    const p = this.planks[id], pins = this.remainingPins(id);
    if (pins.length !== 1 || p.pinHoles.length === 1) return { ...p, pinHoles: [...p.pinHoles], remainingPins: pins, pivotHole: null };
    const pivot = this.holes[pins[0]];
    // The position of the support inside the strip determines how far its
    // center falls below it. A center support hangs only by a short offset.
    const dx = pivot.x - p.x, dy = (pivot.y - p.y) * BOARD_ASPECT;
    const localX = dx * Math.cos(p.angle) + dy * Math.sin(p.angle);
    const localY = -dx * Math.sin(p.angle) + dy * Math.cos(p.angle);
    const radius = Math.hypot(localX, localY);
    // The material coordinate of the pin stays fixed while gravity moves the
    // center below it. Both endpoints therefore hang in the right direction.
    const rawAngle = radius < .001 ? p.angle : Math.atan2(-radius, 0) - Math.atan2(localY, localX);
    // Use the nearest equivalent angle, so the renderer follows gravity's
    // short swing instead of spinning a strip through an unnecessary 360°.
    const angle = p.angle + Math.atan2(Math.sin(rawAngle - p.angle), Math.cos(rawAngle - p.angle));
    return { ...p, x: pivot.x, y: pivot.y + radius / BOARD_ASPECT,
      angle, pinHoles: [...p.pinHoles], remainingPins: pins, pivotHole: pins[0] };
  }

  /** Topmost wood must have the screw as a live support. A swung strip can
   * temporarily cover a lower screw, just like in the reference game. */
  canSelect(hole: number): boolean {
    if (this.solved || !this.holes[hole] || !this.screws[hole]) return false;
    const h = this.holes[hole];
    const covering = this.livePlanks.filter(p => plankContains(p, h, -.006)).sort((a, b) => b.layer - a.layer);
    return covering.length === 0 || covering[0].remainingPins.includes(hole);
  }
  isHoleExposed(hole: number): boolean {
    const h = this.holes[hole];
    return Boolean(h) && !this.livePlanks.some(p => plankContains(p, h, .007));
  }
  canMove(from: number, to: number): boolean {
    if (from === to || !this.holes[to] || this.screws[to] || !this.canSelect(from)) return false;
    // Taking a last support out happens before reinsertion. This permits a
    // destination uncovered by the very strip that falls during this move.
    return !this.livePlanks.some(p => {
      if (p.remainingPins.length === 1 && p.remainingPins[0] === from) return false;
      return plankContains(p, this.holes[to], .007);
    });
  }
  select(hole: number): boolean {
    if (!this.canSelect(hole)) return false;
    this.selected = this.selected === hole ? null : hole;
    return true;
  }
  move(from: number, to: number): MoveResult | null {
    if (!this.canMove(from, to)) return null;
    this.history.push(this.snapshot());
    const before = this.livePlanks;
    this.screws[from] = false;
    this.screws[to] = true;
    this.released[from] = true;
    this.moves++;
    this.selected = null;
    return this.finishMutation(from, to, before);
  }
  private finishMutation(from: number, to: number, before: PlankPose[]): MoveResult {
    const dropped: number[] = [];
    for (const p of this.planks) {
      if (!this.removed[p.id] && this.remainingPins(p.id).length === 0) {
        this.removed[p.id] = true; dropped.push(p.id);
      }
    }
    const pivots = before.filter(p => !this.removed[p.id]).map(p => ({ id: p.id, before: p, after: this.getPose(p.id) }))
      .filter(p => Math.abs(p.before.angle - p.after.angle) > .0001 || Math.abs(p.before.x - p.after.x) > .0001 || Math.abs(p.before.y - p.after.y) > .0001);
    return { from, to, dropped, pivots, before };
  }
  /** Hammer booster: removes one accessible screw instead of parking it. */
  removeScrew(hole: number): MoveResult | null {
    if (!this.canSelect(hole)) return null;
    this.history.push(this.snapshot());
    const before = this.livePlanks;
    this.screws[hole] = false; this.released[hole] = true;
    this.moves++; this.selected = null;
    return this.finishMutation(hole, -1, before);
  }
  /** Drill booster: adds a real, saved, always reachable hole above the strips. */
  addExtraHole(): Hole | null {
    if (this.solved || this.holes.filter(h => h.extra).length >= 3) return null;
    const positions = [.12, .31, .5, .69, .88];
    const x = positions.find(x => !this.holes.some(h => Math.abs(h.x - x) < .06 && Math.abs(h.y - .065) < .025));
    if (x === undefined) return null;
    this.history.push(this.snapshot());
    const hole: Hole = { id: this.holes.length, x, y: .065, initialScrew: false, extra: true };
    this.holes.push(hole); this.screws.push(false); this.released.push(true); this.selected = null;
    return hole;
  }
  undo(): boolean {
    const state = this.history.pop();
    if (!state) return false;
    this.restore(state, true);
    return true;
  }
  reset(): void {
    this.holes = clone(this.level.holes); this.screws = this.holes.map(h => h.initialScrew);
    this.released = this.holes.map(h => !h.initialScrew); this.removed = this.planks.map(() => false);
    this.history = []; this.selected = null; this.moves = 0;
  }
  snapshot(): PuzzleSnapshot {
    return { version: 1, levelId: this.level.id, seed: this.level.seed, screws: [...this.screws],
      released: [...this.released], removed: [...this.removed], moves: this.moves, holes: clone(this.holes) };
  }
  restore(s: PuzzleSnapshot, retainHistory = false): boolean {
    if (s?.version !== 1 || s.levelId !== this.level.id || s.seed !== this.level.seed ||
      s.removed.length !== this.planks.length || s.holes.length !== s.screws.length ||
      s.released.length !== s.screws.length || s.holes.length < this.level.holes.length) return false;
    if (!s.holes.every((h, i) => h.id === i && Number.isFinite(h.x) && Number.isFinite(h.y)) ||
      !s.screws.every(v => typeof v === 'boolean') || !s.released.every(v => typeof v === 'boolean') ||
      !s.removed.every(v => typeof v === 'boolean') || !Number.isInteger(s.moves) || s.moves < 0) return false;
    // Plank removal is determined by supports; reject corrupt cloud checkpoints.
    if (this.planks.some(p => s.removed[p.id] !== p.pinHoles.every(h => s.released[h] || !s.screws[h]))) return false;
    this.holes = clone(s.holes); this.screws = [...s.screws]; this.released = [...s.released];
    this.removed = [...s.removed]; this.moves = s.moves; this.selected = null;
    if (!retainHistory) this.history = [];
    return true;
  }

  /** Search only moves that permanently release supports first. Board-only
   * screws can then be relocated if a parking hole is obstructed. Monotonic
   * support release bounds normal solution depth by initial screw count. */
  findSolution(budget = 24000): Move[] | null {
    const search = new Puzzle(this.level);
    search.restore(this.snapshot());
    const visited = new Set<string>();
    let nodes = 0;
    const key = () => search.screws.map(v => +v).join('') + '/' + search.released.map(v => +v).join('');
    const visit = (depth: number): Move[] | null => {
      if (search.solved) return [];
      if (++nodes > budget || depth > search.holes.length * 2 + 6) return null;
      const k = key(); if (visited.has(k)) return null; visited.add(k);
      const live = search.livePlanks;
      const src = search.holes.filter(h => search.screws[h.id] && search.canSelect(h.id) && search.isAttached(h.id));
      src.sort((a, b) => {
        const score = (h: Hole) => live.reduce((n, p) => n + (p.remainingPins.includes(h.id) ? (p.remainingPins.length === 1 ? 1000 : 20) + p.layer : 0), 0);
        return score(b) - score(a) || a.id - b.id;
      });
      const destinations = search.holes.filter(h => !search.screws[h.id]);
      // The top parking row cannot be hit by a downward hanging strip.
      destinations.sort((a, b) => a.y - b.y || a.id - b.id);
      const choices: Move[] = [];
      for (const from of src) for (const to of destinations) if (search.canMove(from.id, to.id)) choices.push({ from: from.id, to: to.id });
      // If there is no progress move, reposition a parked screw to free a
      // reliable parking hole. A visited set prevents harmless swap cycles.
      if (choices.length === 0) {
        const parked = search.holes.filter(h => search.screws[h.id] && !search.isAttached(h.id) && search.canSelect(h.id));
        for (const from of parked) for (const to of destinations) if (search.canMove(from.id, to.id)) choices.push({ from: from.id, to: to.id });
      }
      const checkpoint = search.snapshot();
      for (const choice of choices) {
        search.move(choice.from, choice.to);
        const suffix = visit(depth + 1);
        search.restore(checkpoint);
        if (suffix) return [choice, ...suffix];
      }
      return null;
    };
    return visit(0);
  }
  hint(): Move | null {
    if (this.solved) return null;
    // All hints include both the source and destination and are legal now.
    const solution = this.findSolution(30000);
    return solution?.[0] ?? null;
  }
  shuffle(): MoveResult | null {
    const h = this.hint();
    return h ? this.move(h.from, h.to) : null;
  }
}

interface Point { x: number; y: number }
interface Segment { a: Point; b: Point }
function makeLayout(count: number, motif: number, rand: () => number): Segment[] {
  const lines: Segment[] = [];
  const add = (ax: number, ay: number, bx: number, by: number) => lines.push({ a: { x: ax, y: ay }, b: { x: bx, y: by } });
  if (motif === 0) {
    // Ladder with shared corner screws; removing one screw releases every
    // strip drilled through it. Longer ladders introduce real dependencies.
    const rows = Math.max(2, Math.ceil((count + 2) / 3));
    const ys = Array.from({ length: rows }, (_, i) => .3 + i * .49 / (rows - 1));
    for (const y of ys) add(.19, y, .81, y);
    for (let i = 0; lines.length < count && i < rows - 1; i++) {
      add(.19, ys[i], .19, ys[i + 1]);
      if (lines.length < count) add(.81, ys[i], .81, ys[i + 1]);
    }
    if (lines.length < count) add(.19, ys[0], .81, ys[rows - 1]);
  } else if (motif === 1) {
    // Dense stars share the ring's supports instead of cramming 32 screw
    // heads onto a phone-sized circle. Each pin remains at least ~38 logical
    // pixels from its neighbour on the reference mobile board.
    const offset = rand() * .12;
    const vertices = count < 8 ? count * 2 : count + count % 2;
    const step = count < 8 ? count : vertices / 2 - 1;
    const points = Array.from({ length: vertices }, (_, i) => {
      const t = offset + Math.PI * 2 * i / vertices;
      return { x: .5 + Math.cos(t) * .345, y: .56 + Math.sin(t) * .288 };
    });
    for (let i = 0; i < count; i++) {
      const a = points[i], b = points[(i + step) % vertices];
      add(a.x, a.y, b.x, b.y);
    }
  } else if (motif === 2) {
    // Nested diamonds use two exposed endpoints per bar and look like an
    // intricate wooden lock instead of a random pile.
    const rings = Math.ceil(count / 4);
    for (let ring = 0; ring < rings && lines.length < count; ring++) {
      const inset = ring * .092;
      const pts = [{ x: .5, y: .235 + inset }, { x: .85 - inset, y: .56 },
        { x: .5, y: .885 - inset }, { x: .15 + inset, y: .56 }];
      for (let j = 0; j < 4 && lines.length < count; j++) add(pts[j].x, pts[j].y, pts[(j + 1) % 4].x, pts[(j + 1) % 4].y);
    }
  } else {
    // Workshop weave: broad horizontal strips, tall supports and diagonals.
    const horizontal = Math.min(7, Math.max(2, count - 4));
    for (let i = 0; i < horizontal; i++) {
      const y = .30 + i * .49 / Math.max(1, horizontal - 1);
      add(.17, y, .83, y);
    }
    const vertical = Math.min(3, count - lines.length);
    for (let i = 0; i < vertical; i++) {
      const x = .3 + i * .4 / Math.max(1, vertical - 1);
      add(x, .245, x, .87);
    }
    while (lines.length < count) {
      const i = lines.length - horizontal - vertical;
      const y = .23;
      if (i % 2 === 0) add(.115, y, .885, .90);
      else add(.885, y, .115, .90);
    }
  }
  return lines.slice(0, count);
}

function buildLevel(index: number, seed: number, attempt: number): Level {
  const rand = seeded(seed + attempt * 15485863);
  const count = Math.min(16, 4 + Math.floor((index - 1) / 35));
  let motif = index <= 3 ? 3 : (index + Math.floor(rand() * 4) + attempt) % 4;
  // Extra parallel diagonals would drill several unintended shared supports.
  // Dense late-game boards use the ring, ladder, and diamond architectures.
  if (count > 12 && motif === 3) motif = (index + attempt) % 3;
  const segments = makeLayout(count, motif, rand);
  // Small coherent transformations preserve the readable architecture while
  // giving every seeded board its own silhouette and support positions.
  const scaleX = .95 + rand() * .075, scaleY = .95 + rand() * .075;
  const tilt = index <= 3 ? 0 : (rand() - .5) * .09;
  for (const segment of segments) for (const point of [segment.a, segment.b]) {
    const dx = (point.x - .5) * scaleX, dy = (point.y - .56) * BOARD_ASPECT * scaleY;
    point.x = .5 + dx * Math.cos(tilt) - dy * Math.sin(tilt);
    point.y = .56 + (dx * Math.sin(tilt) + dy * Math.cos(tilt)) / BOARD_ASPECT;
  }
  const holes: Hole[] = [];
  const addHole = (p: Point, initialScrew: boolean): number => {
    const found = holes.find(h => sq(h.x - p.x) + sq((h.y - p.y) * BOARD_ASPECT) < .00016);
    if (found) return found.id;
    const id = holes.length;
    holes.push({ id, x: round(p.x), y: round(p.y), initialScrew });
    return id;
  };
  // Three parking holes on first levels; two thereafter to create choices.
  const parking = index <= 8 || attempt > 1 ? 3 : 2;
  for (let i = 0; i < parking; i++) addHole({ x: parking === 2 ? .35 + i * .3 : .23 + i * .27, y: .145 }, false);
  for (const segment of segments) { addHole(segment.a, true); addHole(segment.b, true); }
  const planks: Plank[] = segments.map((s, i) => {
    const dx = s.b.x - s.a.x, dy = (s.b.y - s.a.y) * BOARD_ASPECT;
    return { id: i, x: round((s.a.x + s.b.x) / 2), y: round((s.a.y + s.b.y) / 2),
      length: round(Math.hypot(dx, dy) + .085), width: motif === 1 ? .063 : .069,
      angle: Math.atan2(dy, dx), layer: i, skin: (i + Math.floor(rand() * 3)) % 4, pinHoles: [] };
  });
  // Every screw passing through a strip is an actual drilled support, not a
  // visually hidden screw. Shared supports faithfully model layered wood.
  for (const p of planks) p.pinHoles = holes.filter(h => h.initialScrew && plankContains(p, h, -.008)).map(h => h.id);
  const names = ['Лестница мастера', 'Деревянная звезда', 'Секретный замок', 'Переплетение'];
  return { id: index, seed, name: names[motif], difficulty: Math.min(5, 1 + Math.floor((count - 4) / 3)),
    motif: ['ladder', 'star', 'diamond', 'weave'][motif], holes, planks, witness: [], par: 0 };
}

/** A level is returned only after its full legal solution has been found and
 * replayed. Level IDs beyond 600 can be used for dated daily challenges. */
const generatedCache = new Map<string, Level>();
export function generateLevel(index: number, seedOverride?: number): Level {
  index = Math.max(1, Math.floor(index));
  const seed = (seedOverride ?? Math.imul(index, 2654435761)) >>> 0;
  const cacheKey = `${index}/${seed}`;
  const cached = generatedCache.get(cacheKey);
  if (cached) return cached;
  for (let attempt = 0; attempt < 6; attempt++) {
    const level = buildLevel(index, seed, attempt);
    const witness = new Puzzle(level).findSolution(attempt < 2 ? 6000 : 18000);
    if (!witness) continue;
    const replay = new Puzzle(level);
    if (!witness.every(m => Boolean(replay.move(m.from, m.to))) || !replay.solved) continue;
    level.witness = witness; level.par = witness.length;
    generatedCache.set(cacheKey, level);
    return level;
  }
  // A safe fallback keeps unusual user supplied daily seeds playable. It is
  // still a real multi-strip puzzle, with shared hinges and legal relocation.
  const safe = buildLevel(index, seed, 2);
  const count = Math.min(16, 4 + Math.floor((index - 1) / 35));
  // Fallback uses independent, well separated diameters. Its narrower strips
  // preserve screw access even for pathological custom seeds.
  const rand = seeded(seed), offset = rand() * .12;
  const segments: Segment[] = Array.from({ length: count }, (_, i) => {
    const t = offset + Math.PI * i / count;
    return { a: { x: .5 + Math.cos(t) * .335, y: .56 + Math.sin(t) * .29 },
      b: { x: .5 - Math.cos(t) * .335, y: .56 - Math.sin(t) * .29 } };
  });
  safe.motif = 'star'; safe.name = 'Деревянная звезда';
  safe.holes = [{ id: 0, x: .23, y: .145, initialScrew: false }, { id: 1, x: .5, y: .145, initialScrew: false }, { id: 2, x: .77, y: .145, initialScrew: false }];
  safe.planks = segments.map((s, i) => {
    const a = safe.holes.length;
    safe.holes.push({ id: a, ...s.a, initialScrew: true }, { id: a + 1, ...s.b, initialScrew: true });
    return { id: i, x: (s.a.x + s.b.x) / 2, y: (s.a.y + s.b.y) / 2,
      length: Math.hypot(s.b.x - s.a.x, (s.b.y - s.a.y) * BOARD_ASPECT) + .065, width: .031,
      angle: Math.atan2((s.b.y - s.a.y) * BOARD_ASPECT, s.b.x - s.a.x), layer: i, skin: i % 4, pinHoles: [a, a + 1] };
  });
  const witness = new Puzzle(safe).findSolution(80000);
  if (!witness) throw new Error(`Unable to construct a playable puzzle for level ${index}, seed ${seed}`);
  safe.witness = witness; safe.par = witness.length;
  generatedCache.set(cacheKey, safe);
  return safe;
}

export function generateDailyLevel(date: string): Level {
  let seed = 2166136261;
  for (const char of date) seed = Math.imul(seed ^ char.charCodeAt(0), 16777619);
  return generateLevel(180 + ((seed >>> 0) % 421), seed >>> 0);
}

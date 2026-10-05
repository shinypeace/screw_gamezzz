/** Pure, deterministic rules for the wooden screw puzzle. Coordinates are in
 * board units: x/y are normalized, lengths use board width, angles use radians.
 * The reference board is 1 × 1.2. Rendering can tween getPose() between moves. */
import { LEVEL_CATALOG } from './level-catalog';
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
  findSolution(budget = 24000, timeBudgetMs = Infinity): Move[] | null {
    // Runtime hints get a wall-clock limit; the offline catalogue builder keeps
    // its node budget without a deadline. A large search must not freeze a VK
    // WebView after the player leaves the authored solution path.
    const deadline = Number.isFinite(timeBudgetMs)
      ? performance.now() + Math.max(0, timeBudgetMs) : Infinity;
    const expired = () => deadline !== Infinity && performance.now() >= deadline;
    // The catalogue already contains a complete legal solution. Reuse it when
    // the player is on that path, so the first hint never searches thousands
    // of states on a phone. Extra unused drill holes preserve this fast path.
    const authored = new Puzzle(this.level);
    for (let i = 0; this.level.witness.length > 0 && i <= this.level.witness.length; i++) {
      if (authored.screws.every((v, h) => v === this.screws[h]) &&
        authored.released.every((v, h) => v === this.released[h]) &&
        authored.removed.every((v, p) => v === this.removed[p]) &&
        this.screws.slice(authored.screws.length).every(v => !v)) return this.level.witness.slice(i);
      const step = this.level.witness[i];
      if (!step || !authored.move(step.from, step.to)) break;
    }
    const search = new Puzzle(this.level);
    search.restore(this.snapshot());
    const visited = new Set<string>();
    let nodes = 0;
    const key = () => search.screws.map(v => +v).join('') + '/' + search.released.map(v => +v).join('');
    const visit = (depth: number): Move[] | null => {
      if (search.solved) return [];
      if (++nodes > budget || depth > search.holes.length * 2 + 6 || expired()) return null;
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
      for (const from of src) {
        if (expired()) return null;
        for (const to of destinations) if (search.canMove(from.id, to.id)) choices.push({ from: from.id, to: to.id });
      }
      // If there is no progress move, reposition a parked screw to free a
      // reliable parking hole. A visited set prevents harmless swap cycles.
      if (choices.length === 0) {
        const parked = search.holes.filter(h => search.screws[h.id] && !search.isAttached(h.id) && search.canSelect(h.id));
        for (const from of parked) {
          if (expired()) return null;
          for (const to of destinations) if (search.canMove(from.id, to.id)) choices.push({ from: from.id, to: to.id });
        }
      }
      const checkpoint = search.snapshot();
      for (const choice of choices) {
        if (expired()) return null;
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
    const solution = this.findSolution(30000, 70);
    return solution?.[0] ?? null;
  }
  shuffle(): MoveResult | null {
    const h = this.hint();
    return h ? this.move(h.from, h.to) : null;
  }
}

/** Campaign boards are authored and solved offline. Choosing a board is O(1)
 * and keeps the first thirty distinct teaching architectures intact. The new
 * catalogue seed also rejects checkpoints from the obsolete four-template
 * generator instead of applying their screw arrays to a different drawing. */
export function generateLevel(index: number, seedOverride?: number): Level {
  index = Math.max(1, Math.floor(index));
  const campaign = LEVEL_CATALOG[(index - 1) % LEVEL_COUNT];
  if (seedOverride === undefined || (seedOverride >>> 0) === campaign.seed) return campaign;
  // Dated challenges draw from the tougher catalogue, preserving a verified
  // mechanical puzzle and full witness rather than running DFS on a phone.
  const seed = seedOverride >>> 0;
  const selected = LEVEL_CATALOG[80 + ((Math.imul(seed ^ (seed >>> 16), 2246822519) >>> 0) % 520)];
  return { ...selected, id: index, seed };
}

export function generateDailyLevel(date: string): Level {
  let seed = 2166136261;
  for (const char of date) seed = Math.imul(seed ^ char.charCodeAt(0), 16777619);
  return generateLevel(180 + ((seed >>> 0) % 421), seed >>> 0);
}

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
export interface PlankPose extends Plank {
  remainingPins: number[]; pivotHole: number | null;
  vx?: number; vy?: number; angularVelocity?: number;
}
/** Material holes never move within a beam; their board coordinates do. */
export interface DrillPoint { x: number; y: number; sourceHole: number }
export interface SupportBinding { material: number; hole: number; x: number; y: number }
export interface PhysicalPlankState { id: number; x: number; y: number; angle: number; vx: number; vy: number; angularVelocity: number }
export interface PhysicalBoltContact { plank: number; hole: number }
export const PHYSICAL_PLANK_WIDTH_SCALE = 1.1;
export const DRILL_ALIGNMENT = .0055;
// Match the real metal shaft, including a small solver clearance. An empty
// board-hole centre outside wood is insufficient if its shaft overlaps an edge.
const SHAFT_INSERTION_CLEARANCE = .013;
export interface Move { from: number; to: number }
export interface Level {
  id: number; seed: number; name: string; difficulty: number; holes: Hole[];
  planks: Plank[]; witness: Move[]; par: number; motif: string;
}
interface SnapshotBase {
  levelId: number; seed: number; screws: boolean[];
  released: boolean[]; removed: boolean[]; moves: number; holes: Hole[];
}
export interface LogicalPuzzleSnapshot extends SnapshotBase { version: 1 }
export interface PhysicalPuzzleSnapshot extends SnapshotBase {
  version: 2;
  /** One board-hole index per original material drill, or -1 when unbound. */
  bindings: number[][];
  /** Per-plank [x,y,angle,vx,vy,angularVelocity], rounded for VK storage. */
  bodies: number[][];
}
export type PuzzleSnapshot = LogicalPuzzleSnapshot | PhysicalPuzzleSnapshot;
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

/** Offline catalogue rules are deterministic; live play uses actual material
 * holes and continuous rigid-body poses supplied by BoardPhysics. */
export class Puzzle {
  readonly level: Level;
  holes: Hole[];
  planks: Plank[];
  screws: boolean[];
  released: boolean[];
  removed: boolean[];
  selected: number | null = null;
  moves = 0;
  readonly physical: boolean;
  physicsRevision = 0;
  private history: PuzzleSnapshot[] = [];
  private drills: DrillPoint[][];
  private supportHoles: number[][];
  private bodies: PhysicalPlankState[];
  private contacts: PhysicalBoltContact[] = [];
  private hintVisits = new Map<string, number>();
  private previousMove: Move | null = null;
  private originalReleased = new Set<number>();

  constructor(level: Level, snapshot?: PuzzleSnapshot, options: { physical?: boolean } = {}) {
    this.level = level;
    this.physical = options.physical === true;
    this.holes = clone(level.holes);
    this.planks = clone(level.planks);
    if (this.physical) this.planks.forEach(p => p.width *= PHYSICAL_PLANK_WIDTH_SCALE);
    this.screws = this.holes.map(h => h.initialScrew);
    this.released = this.holes.map(h => !h.initialScrew);
    this.removed = this.planks.map(() => false);
    this.drills = level.planks.map(p => p.pinHoles.map(hole => {
      const h = level.holes[hole], dx = h.x - p.x, dy = (h.y - p.y) * BOARD_ASPECT;
      return { x: dx * Math.cos(p.angle) + dy * Math.sin(p.angle),
        y: -dx * Math.sin(p.angle) + dy * Math.cos(p.angle), sourceHole: hole };
    }));
    this.supportHoles = level.planks.map(p => [...p.pinHoles]);
    this.bodies = level.planks.map(p => ({ id: p.id, x: p.x, y: p.y, angle: p.angle, vx: 0, vy: 0, angularVelocity: 0 }));
    if (snapshot) this.restore(snapshot);
    if (this.physical) this.hintVisits.set(this.physicalKey(), 1);
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
    if (this.physical) return this.removed[id] ? [] : this.supportHoles[id].filter(h => h >= 0 && this.screws[h]);
    return this.planks[id].pinHoles.filter(h => !this.released[h] && this.screws[h]);
  }
  isAttached(hole: number): boolean {
    if (this.physical) return this.planks.some(p => !this.removed[p.id] && this.supportHoles[p.id].includes(hole));
    return !this.released[hole] && this.planks.some(p => !this.removed[p.id] && p.pinHoles.includes(hole));
  }

  getDrillPoints(id: number): DrillPoint[] { return this.drills[id].map(drill => ({ ...drill })); }
  getSupportBindings(id: number): SupportBinding[] {
    return this.supportHoles[id].flatMap((hole, material) => hole < 0 || this.removed[id] ? [] :
      [{ material, hole, x: this.drills[id][material].x, y: this.drills[id][material].y }]);
  }
  getDrillWorldPoints(id: number): { x: number; y: number; material: number; sourceHole: number }[] {
    const p = this.getPose(id), c = Math.cos(p.angle), s = Math.sin(p.angle);
    return this.drills[id].map((drill, material) => ({ material, sourceHole: drill.sourceHole,
      x: p.x + drill.x * c - drill.y * s,
      y: p.y + (drill.x * s + drill.y * c) / BOARD_ASPECT }));
  }
  /** Called after every physics step. A free strip remains interactive and can
   * be caught by another bolt until it actually leaves the board. */
  syncPhysics(states: PhysicalPlankState[], fallenIds: number[] = [], contacts: PhysicalBoltContact[] = []): void {
    if (!this.physical) return;
    for (const state of states) {
      if (this.bodies[state.id] && !this.removed[state.id] &&
        [state.x, state.y, state.angle, state.vx, state.vy, state.angularVelocity].every(Number.isFinite)) {
        this.bodies[state.id] = { ...state };
      }
    }
    for (const id of fallenIds) if (this.planks[id] && this.remainingPins(id).length === 0) {
      this.removed[id] = true;
      this.supportHoles[id].fill(-1);
    }
    this.contacts = contacts.filter(contact => this.planks[contact.plank] && !this.removed[contact.plank] && this.screws[contact.hole])
      .map(contact => ({ ...contact }));
  }
  private alignedMaterial(id: number, hole: number, tolerance = DRILL_ALIGNMENT): number | null {
    const h = this.holes[hole];
    if (!h) return null;
    const nearest = this.getDrillWorldPoints(id).map(point => ({ ...point,
      distance: Math.hypot(point.x - h.x, (point.y - h.y) * BOARD_ASPECT) }))
      .sort((a, b) => a.distance - b.distance)[0];
    return nearest && nearest.distance <= tolerance ? nearest.material : null;
  }
  private physicalHoleOpen(hole: number): boolean {
    return Boolean(this.holes[hole]) && this.livePlanks.every(p => !plankContains(p, this.holes[hole], SHAFT_INSERTION_CLEARANCE) ||
      this.alignedMaterial(p.id, hole) !== null);
  }
  private refreshReleased(): void { this.released = this.holes.map(h => !this.isAttached(h.id)); }
  private physicalKey(from?: number, to?: number): string {
    const screws = this.screws.map((bit, hole) => hole === from ? '0' : hole === to ? '1' : bit ? '1' : '0').join('');
    const bindings = this.supportHoles.map((holes, plank) => {
      const caught = to === undefined || to < 0 || this.removed[plank] ? null : this.alignedMaterial(plank, to);
      return holes.map((hole, material) => caught === material ? to : hole === from ? -1 : hole).join(',');
    }).join(';');
    return `${screws}/${bindings}/${this.removed.map(bit => bit ? '1' : '0').join('')}`;
  }
  private rememberPhysicalMove(from: number, to: number): void {
    this.originalReleased.add(from);
    this.previousMove = { from, to };
    const key = this.physicalKey(); this.hintVisits.set(key, (this.hintVisits.get(key) ?? 0) + 1);
  }

  getPose(id: number): PlankPose {
    const p = this.planks[id], pins = this.remainingPins(id);
    if (this.physical) return { ...p, ...this.bodies[id], pinHoles: [...p.pinHoles],
      remainingPins: pins, pivotHole: pins.length === 1 ? pins[0] : null };
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
    if (this.physical) {
      const h = this.holes[hole];
      const top = this.livePlanks.filter(p => plankContains(p, h, .006)).sort((a, b) => b.layer - a.layer)[0];
      return !top || this.alignedMaterial(top.id, hole, .018) !== null ||
        // A loose strip resting on a shaft does not cover its metal head.
        // Removing that real contact is how the player lets the strip fall.
        (this.contacts.some(contact => contact.plank === top.id && contact.hole === hole) && !plankContains(top, h, -.005));
    }
    const h = this.holes[hole];
    const covering = this.livePlanks.filter(p => plankContains(p, h, -.006)).sort((a, b) => b.layer - a.layer);
    return covering.length === 0 || covering[0].remainingPins.includes(hole);
  }
  isHoleExposed(hole: number): boolean {
    if (this.physical) return this.physicalHoleOpen(hole);
    const h = this.holes[hole];
    return Boolean(h) && !this.livePlanks.some(p => plankContains(p, h, .007));
  }
  canMove(from: number, to: number): boolean {
    if (from === to || !this.holes[to] || this.screws[to] || !this.canSelect(from)) return false;
    if (this.physical) return this.physicalHoleOpen(to);
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
    if (this.physical) {
      this.supportHoles.forEach(bindings => bindings.forEach((hole, material) => {
        if (hole === from) bindings[material] = -1;
      }));
      for (const p of this.livePlanks) {
        const material = this.alignedMaterial(p.id, to);
        if (material !== null) this.supportHoles[p.id][material] = to;
      }
      this.refreshReleased();
      this.rememberPhysicalMove(from, to);
      this.physicsRevision++;
    }
    this.moves++;
    this.selected = null;
    return this.finishMutation(from, to, before);
  }
  private finishMutation(from: number, to: number, before: PlankPose[]): MoveResult {
    if (this.physical) return { from, to, dropped: [], pivots: [], before };
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
    if (this.physical) {
      this.supportHoles.forEach(bindings => bindings.forEach((bound, material) => {
        if (bound === hole) bindings[material] = -1;
      }));
      this.refreshReleased(); this.physicsRevision++;
      this.rememberPhysicalMove(hole, -1);
    }
    this.moves++; this.selected = null;
    return this.finishMutation(hole, -1, before);
  }
  /** Drill booster: adds a real, saved hole in clear board space. */
  addExtraHole(): Hole | null {
    if (this.solved || this.holes.filter(h => h.extra).length >= 3) return null;
    const positions = [.12, .31, .5, .69, .88, .23, .77, .41, .59, .14, .86]
      .flatMap(x => [{ x, y: .065 }, { x, y: .14 }, { x, y: .195 }]);
    const position = positions.find(point => this.holes.every(h => Math.hypot(h.x - point.x, (h.y - point.y) * BOARD_ASPECT) >= 26 / 300) &&
      this.livePlanks.every(p => !plankContains(p, point, .025)));
    if (!position) return null;
    this.history.push(this.snapshot());
    const hole: Hole = { id: this.holes.length, ...position, initialScrew: false, extra: true };
    this.holes.push(hole); this.screws.push(false); this.released.push(true); this.selected = null;
    if (this.physical) this.physicsRevision++;
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
    this.supportHoles = this.level.planks.map(p => [...p.pinHoles]);
    this.bodies = this.level.planks.map(p => ({ id: p.id, x: p.x, y: p.y, angle: p.angle, vx: 0, vy: 0, angularVelocity: 0 }));
    this.physicsRevision++;
    this.contacts = []; this.previousMove = null; this.hintVisits.clear(); this.originalReleased.clear();
    if (this.physical) this.hintVisits.set(this.physicalKey(), 1);
    this.history = []; this.selected = null; this.moves = 0;
  }
  snapshot(): PuzzleSnapshot {
    if (this.physical) {
      const round = (n: number) => Math.round(n * 10_000) / 10_000;
      return { version: 2, levelId: this.level.id, seed: this.level.seed, screws: [...this.screws],
        released: [...this.released], removed: [...this.removed], moves: this.moves, holes: clone(this.holes),
        bindings: this.supportHoles.map(bindings => [...bindings]),
        bodies: this.bodies.map(body => [body.x, body.y, body.angle, body.vx, body.vy, body.angularVelocity].map(round)) };
    }
    return { version: 1, levelId: this.level.id, seed: this.level.seed, screws: [...this.screws],
      released: [...this.released], removed: [...this.removed], moves: this.moves, holes: clone(this.holes) };
  }
  restore(s: PuzzleSnapshot, retainHistory = false): boolean {
    if ((s?.version !== 1 && s?.version !== 2) || (s.version === 2 && !this.physical) || s.levelId !== this.level.id || s.seed !== this.level.seed ||
      !Array.isArray(s.removed) || !Array.isArray(s.holes) || !Array.isArray(s.screws) || !Array.isArray(s.released) ||
      s.removed.length !== this.planks.length || s.holes.length !== s.screws.length ||
      s.released.length !== s.screws.length || s.holes.length < this.level.holes.length) return false;
    if (!s.holes.every((h, i) => h.id === i && Number.isFinite(h.x) && Number.isFinite(h.y)) ||
      !s.screws.every(v => typeof v === 'boolean') || !s.released.every(v => typeof v === 'boolean') ||
      !s.removed.every(v => typeof v === 'boolean') || !Number.isInteger(s.moves) || s.moves < 0) return false;
    // In legacy/offline saves removal follows support release immediately.
    if (s.version === 1 && this.planks.some(p => s.removed[p.id] !== p.pinHoles.every(h => s.released[h] || !s.screws[h]))) return false;
    if (s.version === 2) {
      if (!Array.isArray(s.bindings) || !Array.isArray(s.bodies) || s.bindings.length !== this.planks.length || s.bodies.length !== this.planks.length) return false;
      for (const p of this.planks) {
        const bindings = s.bindings[p.id], body = s.bodies[p.id];
        if (!Array.isArray(bindings) || bindings.length !== p.pinHoles.length ||
          !bindings.every(h => Number.isInteger(h) && h >= -1 && h < s.holes.length && (h < 0 || s.screws[h])) ||
          new Set(bindings.filter(h => h >= 0)).size !== bindings.filter(h => h >= 0).length ||
          (s.removed[p.id] && bindings.some(h => h >= 0)) || !Array.isArray(body) || body.length !== 6 || !body.every(Number.isFinite) ||
          body[0] < -3 || body[0] > 4 || body[1] < -3 || body[1] > 4 || Math.abs(body[2]) > 10_000 ||
          body.slice(3).some(v => Math.abs(v) > 100)) return false;
        for (let material = 0; material < bindings.length; material++) if (bindings[material] >= 0) {
          const local = this.drills[p.id][material], h = s.holes[bindings[material]];
          const x = body[0] + local.x * Math.cos(body[2]) - local.y * Math.sin(body[2]);
          const y = body[1] + (local.x * Math.sin(body[2]) + local.y * Math.cos(body[2])) / BOARD_ASPECT;
          if (Math.hypot(x - h.x, (y - h.y) * BOARD_ASPECT) > .025) return false;
        }
      }
    }
    this.holes = clone(s.holes); this.screws = [...s.screws]; this.released = [...s.released];
    this.removed = [...s.removed]; this.moves = s.moves; this.selected = null;
    if (this.physical) {
      if (s.version === 2) {
        this.supportHoles = s.bindings.map(bindings => [...bindings]);
        this.bodies = s.bodies.map((body, id) => ({ id, x: body[0], y: body[1], angle: body[2], vx: body[3], vy: body[4], angularVelocity: body[5] }));
      } else {
        this.supportHoles = this.level.planks.map(p => p.pinHoles.map(h => s.released[h] || !s.screws[h] ? -1 : h));
        // Convert old settled logical poses once, then resume real simulation.
        const logical = new Puzzle(this.level, s);
        this.bodies = this.level.planks.map(p => {
          const pose = logical.getPose(p.id);
          return { id: p.id, x: pose.x, y: pose.y, angle: pose.angle, vx: 0, vy: 0, angularVelocity: 0 };
        });
      }
      this.physicsRevision++;
      this.contacts = [];
      // Undo keeps only the undo stack. Speculative hint visits and the last
      // move belong to the abandoned future, so rebuild them from this board.
      this.previousMove = null; this.hintVisits.clear(); this.hintVisits.set(this.physicalKey(), 1);
      this.originalReleased = new Set(this.level.holes.filter(h => h.initialScrew && !this.isAttached(h.id)).map(h => h.id));
    }
    if (!retainHistory) this.history = [];
    return true;
  }

  /** Search only moves that permanently release supports first. Board-only
   * screws can then be relocated if a parking hole is obstructed. Monotonic
   * support release bounds normal solution depth by initial screw count. */
  findSolution(budget = 24000, timeBudgetMs = Infinity): Move[] | null {
    if (this.physical) {
      // Continuous contacts have no deterministic offline suffix. Rank legal
      // moves against the actual bodies, preferring complete support release
      // into an uncovered parking hole over catching a beam again.
      const choices: (Move & { score: number })[] = [];
      const unbound = this.remainingScrews === 0;
      const releaseOrder = this.level.witness.map(move => move.from);
      const nextAuthored = releaseOrder.findIndex(hole => this.isAttached(hole) && !this.originalReleased.has(hole));
      // Once every material support is out, let gravity finish. Only a shaft
      // in an actual contact can still be holding a free strip on the board.
      if (unbound && this.contacts.length === 0) return null;
      for (const from of this.holes) if (this.canSelect(from.id) &&
        (!unbound || this.contacts.some(contact => contact.hole === from.id))) for (const to of this.holes) if (this.canMove(from.id, to.id)) {
        let score = 0;
        const nextKey = this.physicalKey(from.id, to.id);
        const visited = this.hintVisits.get(nextKey) ?? 0;
        if (visited >= 2) continue;
        const authoredRank = releaseOrder.indexOf(from.id);
        // The authored source order respects the catalogue's blocking graph.
        // Reuse that dependency plan while checking destinations and material
        // alignment against the real physics, rather than blindly replaying it.
        if (this.isAttached(from.id) && !this.originalReleased.has(from.id) && authoredRank >= nextAuthored && nextAuthored >= 0)
          score += 8000 / (authoredRank - nextAuthored + 1);
        for (const p of this.livePlanks) {
          const pins = p.remainingPins;
          if (pins.includes(from.id)) score += pins.length === 1 ? 1000 : 30 + p.layer;
          if (this.alignedMaterial(p.id, to.id) !== null) score -= 12000;
          if (this.contacts.some(contact => contact.plank === p.id && contact.hole === from.id))
            score += pins.length === 0 ? 2400 : 150;
        }
        if (!this.isAttached(from.id)) score -= 100;
        // High uncovered parking slots stay above the falling strips. A bolt
        // parked below the current wood can catch it again a moment later.
        score -= to.y * 30;
        score -= visited * 2000;
        if (this.previousMove?.from === to.id && this.previousMove.to === from.id) score -= 900;
        choices.push({ from: from.id, to: to.id, score });
      }
      const best = choices.sort((a, b) => b.score - a.score || a.from - b.from || a.to - b.to)[0];
      return best ? [{ from: best.from, to: best.to }] : null;
    }
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
const adaptedCampaign = new Map<number, Level>();
// Verified with the live rigid-body simulation. These dense crossing boards
// need extra ordinary parking space after real shaft contacts replace the old
// instantaneous strip removal. Other boards retain their original challenge.
const RECOVERY_PARKING: Record<number, number> = {
  9: 1, 10: 1, 15: 1, 18: 2, 19: 1, 24: 2, 25: 1, 27: 1,
  30: 2, 32: 1, 33: 3, 40: 1, 41: 2, 43: 3, 44: 1, 45: 1,
  46: 2, 47: 3, 48: 1, 51: 4, 55: 3, 59: 2, 60: 3, 61: 1,
  65: 3, 66: 1, 67: 1, 68: 2, 69: 1, 70: 2, 71: 1, 73: 1,
  75: 1, 79: 3, 84: 1, 86: 3, 87: 2, 92: 1, 93: 1, 95: 1,
  97: 1, 98: 4, 100: 1, 101: 1, 102: 1, 106: 2, 108: 1, 109: 2,
  120: 1, 126: 1, 130: 1, 132: 1, 133: 1, 134: 1, 135: 1, 136: 1,
  139: 1, 140: 1, 142: 2, 145: 2, 147: 1, 148: 1, 149: 1, 150: 2,
  152: 2, 153: 2, 158: 1, 165: 3, 166: 1, 167: 1, 171: 1, 173: 1,
  177: 1, 178: 2, 180: 1, 181: 1, 182: 1, 184: 2, 188: 1, 189: 3,
  190: 1, 191: 2, 193: 2, 196: 2, 197: 2, 201: 1, 202: 1, 205: 3,
  206: 3, 207: 2, 208: 2, 212: 1, 213: 1, 214: 1, 215: 1, 225: 5,
  227: 1, 232: 1, 233: 1, 235: 1, 237: 2, 239: 1, 240: 2, 243: 2,
  244: 2, 245: 2, 246: 1, 247: 2, 248: 2, 249: 2, 250: 1, 252: 3,
  253: 1, 255: 3, 256: 1, 257: 2, 259: 2, 260: 2, 264: 1, 266: 1,
  267: 2, 270: 1, 271: 4, 273: 1, 275: 1, 279: 2, 280: 2, 281: 2,
  282: 1, 283: 2, 286: 1, 292: 1, 293: 2, 296: 1, 297: 2, 298: 2,
  300: 3, 302: 1, 303: 3, 307: 1, 314: 1, 317: 2, 318: 1, 322: 2,
  324: 4, 327: 1, 330: 1, 336: 2, 339: 2, 340: 2, 342: 1, 343: 1,
  344: 1, 345: 1, 346: 1, 347: 1, 352: 3, 353: 1, 354: 4, 356: 1,
  357: 1, 358: 1, 359: 2, 366: 1, 367: 3, 371: 1, 373: 1, 374: 1,
  376: 2, 378: 2, 381: 2, 386: 2, 388: 2, 390: 3, 391: 3, 392: 2,
  394: 1, 395: 1, 396: 1, 397: 2, 399: 2, 401: 4, 402: 3, 403: 1,
  405: 2, 406: 2, 409: 1, 411: 2, 413: 2, 414: 1, 415: 2, 420: 2,
  421: 1, 424: 3, 427: 3, 430: 3, 434: 1, 435: 4, 436: 2, 437: 2,
  439: 3, 440: 2, 441: 1, 442: 3, 443: 3, 449: 2, 451: 2, 452: 1,
  453: 2, 455: 1, 456: 2, 459: 2, 461: 2, 462: 1, 463: 3, 464: 1,
  466: 1, 467: 1, 468: 1, 469: 1, 471: 1, 472: 1, 474: 3, 475: 1,
  479: 2, 481: 1, 482: 1, 483: 2, 484: 2, 485: 1, 486: 1, 488: 2,
  490: 3, 491: 2, 492: 3, 493: 2, 494: 2, 495: 2, 496: 1, 497: 2,
  498: 1, 500: 1, 502: 1, 503: 1, 505: 1, 506: 1, 508: 1, 509: 3,
  510: 1, 512: 2, 513: 1, 515: 1, 516: 1, 520: 1, 521: 2, 522: 1,
  526: 1, 527: 2, 528: 1, 529: 2, 530: 2, 531: 2, 532: 2, 533: 1,
  534: 1, 535: 1, 536: 1, 537: 2, 538: 2, 539: 1, 542: 1, 543: 2,
  544: 1, 545: 2, 548: 1, 549: 1, 550: 2, 552: 2, 554: 1, 556: 1,
  557: 1, 558: 2, 559: 1, 563: 1, 565: 1, 566: 2, 568: 1, 569: 2,
  570: 1, 571: 1, 572: 3, 575: 1, 576: 1, 577: 1, 578: 1, 579: 3,
  581: 1, 582: 3, 583: 1, 584: 1, 585: 1, 587: 1, 588: 2, 589: 1,
  590: 2, 591: 1, 592: 1, 593: 2, 594: 2, 595: 2, 596: 2, 597: 1,
  598: 2,
};
/** Dense multi-pin strips need a third board parking position now that a bolt
 * returned through real wood holes catches the strip again. The added hole is
 * ordinary board geometry, not a paid drill or a removed collision obstacle. */
function adaptPhysicalParking(level: Level, reviseSeed: boolean, catalogId = level.id): Level {
  const count = (Math.max(...level.planks.map(p => p.pinHoles.length)) >= 4 ? 1 : 0) + (RECOVERY_PARKING[catalogId] ?? 0);
  if (count === 0) return level;
  const holes = [...level.holes];
  const candidates = [.5, .14, .86, .23, .77, .41, .59, .12, .88].flatMap(x => [{ x, y: .065 }, { x, y: .095 }]);
  for (let n = 0; n < count; n++) {
    const position = candidates.find(point => holes.every(h => Math.hypot(h.x - point.x, (h.y - point.y) * BOARD_ASPECT) >= 26 / 300) &&
      level.planks.every(p => !plankContains(p, point, .03)));
    if (!position) throw Error(`Level ${catalogId} has no safe physical parking position`);
    holes.push({ id: holes.length, ...position, initialScrew: false });
  }
  return { ...level, seed: reviseSeed ? (level.seed ^ 0x41f217a9) >>> 0 : level.seed,
    holes };
}

export function generateLevel(index: number, seedOverride?: number): Level {
  index = Math.max(1, Math.floor(index));
  const campaignIndex = (index - 1) % LEVEL_COUNT;
  let campaign = adaptedCampaign.get(campaignIndex);
  if (!campaign) { campaign = adaptPhysicalParking(LEVEL_CATALOG[campaignIndex], true); adaptedCampaign.set(campaignIndex, campaign); }
  if (seedOverride === undefined || (seedOverride >>> 0) === campaign.seed) return campaign;
  // Dated challenges draw from the tougher catalogue, preserving a verified
  // mechanical puzzle and full witness rather than running DFS on a phone.
  const seed = seedOverride >>> 0;
  const selected = LEVEL_CATALOG[80 + ((Math.imul(seed ^ (seed >>> 16), 2246822519) >>> 0) % 520)];
  return adaptPhysicalParking({ ...selected, id: index, seed }, false, selected.id);
}

/** Version daily physical geometry as well as its date. Old dated snapshots
 * must not apply bindings from the previous catalogue to a new architecture. */
export function dailyPuzzleSeed(date: string): number {
  let seed = 2166136261;
  for (const char of `${date}:catalogue-v3`) seed = Math.imul(seed ^ char.charCodeAt(0), 16777619);
  return seed >>> 0;
}

export function generateDailyLevel(date: string): Level {
  const seed = dailyPuzzleSeed(date);
  return generateLevel(180 + ((seed >>> 0) % 421), seed >>> 0);
}

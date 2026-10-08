import Matter from 'matter-js';
import type { Hole, Level, Plank } from './puzzle';

/** Fixed simulation coordinates keep gravity and collisions identical on every
 * phone. Rendering scales these board-width units to the visible board. */
export const PHYSICS_WIDTH = 340;
export const PHYSICS_ASPECT = 1.2;
export const PLANK_WIDTH_SCALE = 1.1;
export const DRILL_RADIUS = .018;
export const BOLT_RADIUS = .0125;
const STEP = 1 / 120;
const SHAFT_CATEGORY = 1;
// A moving material edge travels less than a shaft radius in one collision
// solve. Matter's velocity units are pixels per nominal 60 Hz frame.
const MAX_EDGE_TRAVEL = BOLT_RADIUS * PHYSICS_WIDTH * .38;

export interface DrillPoint { x: number; y: number; sourceHole?: number }
export interface SupportBinding { material: number; hole: number; x: number; y: number }
export interface PhysicalPose {
  id: number; x: number; y: number; angle: number;
  vx: number; vy: number; angularVelocity: number;
}
export interface PhysicsPose extends Plank, PhysicalPose { remainingPins: number[]; pivotHole: number | null }
export interface DrilledHole { index: number; x: number; y: number; radius: number; sourceHole?: number }
export interface BoltContact { plank: number; hole: number }
/** Deliberately structural: the pure Puzzle can run catalogue checks without
 * importing Matter, while the playable puzzle supplies moving material holes. */
export interface PhysicalPuzzleAdapter {
  holes: Hole[]; screws: boolean[]; removed: boolean[]; physicsRevision: number;
  getDrillPoints(id: number): DrillPoint[];
  getSupportBindings(id: number): SupportBinding[];
  getPose(id: number): Plank & Partial<PhysicalPose>;
}
export interface PhysicsSnapshot { version: 1; poses: PhysicalPose[]; fallen: number[] }

type WoodBody = {
  plank: Plank; body: Matter.Body; center: Matter.Vector;
  drills: DrillPoint[]; bindings: SupportBinding[];
  constraints: Matter.Constraint[]; signature: string; category: number;
  occludedShafts: Set<number>;
};

const rotate = (p: Matter.Vector, angle: number): Matter.Vector => ({
  x: p.x * Math.cos(angle) - p.y * Math.sin(angle),
  y: p.x * Math.sin(angle) + p.y * Math.cos(angle),
});
const metric = (p: { x: number; y: number }): Matter.Vector => ({
  x: p.x * PHYSICS_WIDTH, y: p.y * PHYSICS_WIDTH * PHYSICS_ASPECT,
});
const polygonArea = (v: Matter.Vector[]) => Math.abs(v.reduce((area, p, i) => {
  const next = v[(i + 1) % v.length]; return area + p.x * next.y - next.x * p.y;
}, 0)) / 2;

/** A compound strip has actual voids. The full rectangle is only the compound's
 * broad-phase hull: Matter tests its convex material parts against screw shafts.
 * Eight small convex slices approximate each circular drill, including off-axis
 * holes. The rest of the strip remains large inexpensive rectangular parts. */
function perforatedBody(plank: Plank, drills: DrillPoint[], category: number): { body: Matter.Body; center: Matter.Vector } {
  const length = plank.length * PHYSICS_WIDTH;
  const halfWidth = plank.width * PLANK_WIDTH_SCALE * PHYSICS_WIDTH / 2;
  const radius = DRILL_RADIUS * PHYSICS_WIDTH;
  const parts: Matter.Body[] = [];
  const options: Matter.IChamferableBodyDefinition = { friction: .48, frictionStatic: .8,
    restitution: .12, frictionAir: .012, density: .0018,
    collisionFilter: { category, mask: SHAFT_CATEGORY, group: 0 } };
  const addPolygon = (vertices: Matter.Vector[]) => {
    if (polygonArea(vertices) < .3) return;
    const center = Matter.Vertices.centre(vertices as Matter.Vertex[]);
    parts.push(Matter.Bodies.fromVertices(center.x, center.y, [vertices], options, false, .001, .1));
  };
  const addRect = (left: number, right: number) => {
    if (right - left > .05) parts.push(Matter.Bodies.rectangle((left + right) / 2, 0,
      right - left, halfWidth * 2, options));
  };
  const holes = drills.map(d => ({ x: d.x * PHYSICS_WIDTH, y: d.y * PHYSICS_WIDTH }))
    .filter(d => Math.abs(d.x) < length / 2 + radius && Math.abs(d.y) < halfWidth + radius)
    .sort((a, b) => a.x - b.x);
  let cursor = -length / 2;
  for (const hole of holes) {
    const left = Math.max(cursor, hole.x - radius, -length / 2);
    const right = Math.min(hole.x + radius, length / 2);
    if (right <= left) continue;
    addRect(cursor, left);
    // Equal-angle arc segments keep the circular opening accurate at its
    // steep outer rim. Equal-x slices narrowed the opening near those rims,
    // making a correctly aligned returning screw catch on invisible wood.
    const startArc = Math.acos(Math.max(-1, Math.min(1, (hole.x - left) / radius)));
    const endArc = Math.acos(Math.max(-1, Math.min(1, (hole.x - right) / radius)));
    for (let slice = 0; slice < 8; slice++) {
      const a = hole.x - radius * Math.cos(startArc + (endArc - startArc) * slice / 8);
      const b = hole.x - radius * Math.cos(startArc + (endArc - startArc) * (slice + 1) / 8);
      // A small clearance absorbs the polygon approximation and constraint
      // tolerances; the visible hole is still larger than the metal shaft.
      const cap = (x: number) => Math.sqrt(Math.max(0, radius * radius - (x - hole.x) ** 2));
      const topA = Math.max(-halfWidth, Math.min(halfWidth, hole.y - cap(a) - .12));
      const topB = Math.max(-halfWidth, Math.min(halfWidth, hole.y - cap(b) - .12));
      const bottomA = Math.max(-halfWidth, Math.min(halfWidth, hole.y + cap(a) + .12));
      const bottomB = Math.max(-halfWidth, Math.min(halfWidth, hole.y + cap(b) + .12));
      addPolygon([{ x: a, y: -halfWidth }, { x: b, y: -halfWidth },
        { x: b, y: topB }, { x: a, y: topA }]);
      addPolygon([{ x: a, y: bottomA }, { x: b, y: bottomB },
        { x: b, y: halfWidth }, { x: a, y: halfWidth }]);
    }
    cursor = right;
  }
  addRect(cursor, length / 2);
  if (!parts.length) addRect(-length / 2, length / 2);
  const body = Matter.Body.create({ ...options, parts, label: `wood-${plank.id}` });
  // Matter's default part inertia includes an artificial factor of four and
  // its compound sum omits the parallel-axis terms. Use the actual material
  // moment so gravity produces a responsive pendulum instead of a slow rotor.
  const inertia = body.parts.slice(1).reduce((sum, part) => sum + part.inertia / 4 +
    part.mass * ((part.position.x - body.position.x) ** 2 + (part.position.y - body.position.y) ** 2), 0);
  Matter.Body.setInertia(body, inertia);
  // Wood grain is not perfectly balanced. A small deterministic density
  // eccentricity starts an upright unstable beam immediately under gravity.
  // Material vertices never move here, so extraction has no angle/position
  // jump, and recreating the same beam on resume preserves the same balance.
  const balance = halfWidth * .18 * (plank.id % 2 ? -1 : 1);
  Matter.Body.setCentre(body, { x: body.position.x, y: body.position.y + balance });
  // Subtracting asymmetric drill holes moves the center of mass. Preserve that
  // real eccentricity while rendering the original material rectangle center.
  const center = { ...body.position };
  Matter.Body.setAngle(body, plank.angle);
  const offset = rotate(center, plank.angle), origin = metric(plank);
  Matter.Body.setPosition(body, { x: origin.x + offset.x, y: origin.y + offset.y });
  return { body, center };
}

export class BoardPhysics {
  readonly engine = Matter.Engine.create({ positionIterations: 8, velocityIterations: 8,
    constraintIterations: 6, enableSleeping: false });
  private level: Level;
  private wood = new Map<number, WoodBody>();
  private shafts = new Map<number, Matter.Body>();
  private fallen = new Set<number>();
  private accumulator = 0;
  private revision = -1;
  private holes: Hole[] = [];
  private screws: boolean[] = [];

  constructor(level: Level, puzzle?: PhysicalPuzzleAdapter) {
    this.level = level;
    this.engine.gravity.x = 0; this.engine.gravity.y = 1.5; this.engine.gravity.scale = .001;
    if (puzzle) this.syncPuzzle(puzzle);
  }

  reset(level: Level, puzzle?: PhysicalPuzzleAdapter): void {
    Matter.Composite.clear(this.engine.world, false);
    Matter.Engine.clear(this.engine);
    this.level = level; this.wood.clear(); this.shafts.clear(); this.fallen.clear();
    this.holes = []; this.screws = [];
    this.accumulator = 0; this.revision = -1;
    if (puzzle) this.syncPuzzle(puzzle);
  }

  /** A move changes constraints and shafts, never replaces a moving strip with
   * a precomputed target angle. Undo/restored poses explicitly reposition it. */
  syncPuzzle(puzzle: PhysicalPuzzleAdapter): void {
    if (this.revision === puzzle.physicsRevision && this.wood.size) return;
    this.holes = puzzle.holes; this.screws = puzzle.screws;
    const activeIds = new Set<number>();
    for (const plank of this.level.planks) {
      if (puzzle.removed[plank.id]) continue;
      activeIds.add(plank.id);
      this.fallen.delete(plank.id);
      const pose = puzzle.getPose(plank.id);
      let entry = this.wood.get(plank.id);
      if (!entry) {
        const category = 1 << (Math.min(plank.id, 29) + 1);
        const drills = puzzle.getDrillPoints(plank.id).map(d => ({ ...d }));
        const made = perforatedBody(plank, drills, category);
        entry = { plank, ...made, drills, bindings: [], constraints: [], signature: '', category, occludedShafts: new Set() };
        this.wood.set(plank.id, entry); Matter.Composite.add(this.engine.world, entry.body);
        this.setPose(entry, pose);
        this.seedOccludedShafts(entry);
      } else {
        const visible = this.pose(entry);
        if (Math.abs(visible.x - pose.x) + Math.abs(visible.y - pose.y) + Math.abs(visible.angle - pose.angle) > .00001) {
          this.setPose(entry, pose); this.seedOccludedShafts(entry);
        }
      }
      this.setBindings(entry, puzzle.getSupportBindings(plank.id), puzzle.holes);
    }
    for (const [id, entry] of this.wood) if (!activeIds.has(id)) {
      this.removeWood(entry); this.wood.delete(id);
    }
    this.syncShafts(puzzle.holes, puzzle.screws);
    this.revision = puzzle.physicsRevision;
  }

  private setPose(entry: WoodBody, pose: Plank & Partial<PhysicalPose>): void {
    const body = entry.body;
    Matter.Body.setAngle(body, pose.angle);
    const offset = rotate(entry.center, pose.angle), origin = metric(pose);
    Matter.Body.setPosition(body, { x: origin.x + offset.x, y: origin.y + offset.y });
    const angularVelocity = pose.angularVelocity ?? 0;
    Matter.Body.setVelocity(body, { x: ((pose.vx ?? 0) * PHYSICS_WIDTH - angularVelocity * offset.y) / 60,
      y: ((pose.vy ?? 0) * PHYSICS_WIDTH + angularVelocity * offset.x) / 60 });
    Matter.Body.setAngularVelocity(body, angularVelocity / 60);
  }

  private setBindings(entry: WoodBody, bindings: SupportBinding[], holes: Hole[]): void {
    const signature = bindings.map(b => `${b.material}:${b.hole}`).sort().join('|');
    if (signature === entry.signature && entry.bindings.length === bindings.length) return;
    for (const constraint of entry.constraints) Matter.Composite.remove(this.engine.world, constraint);
    entry.constraints = []; entry.bindings = bindings.map(b => ({ ...b })); entry.signature = signature;
    Matter.Body.setStatic(entry.body, bindings.length >= 2);
    if (bindings.length === 1) {
      const binding = bindings[0], hole = holes[binding.hole];
      if (!hole) return;
      const point = rotate({ x: binding.x * PHYSICS_WIDTH - entry.center.x,
        y: binding.y * PHYSICS_WIDTH - entry.center.y }, entry.body.angle);
      const anchor = metric(hole);
      const constraint = Matter.Constraint.create({ bodyA: entry.body, pointA: point,
        pointB: anchor, length: 0, stiffness: .98, damping: .018,
        label: `hinge-${entry.plank.id}-${binding.hole}` });
      entry.constraints.push(constraint); Matter.Composite.add(this.engine.world, constraint);
    }
  }

  private syncShafts(holes: Hole[], screws: boolean[]): void {
    for (const [id, shaft] of this.shafts) if (!screws[id] || !holes[id]) {
      Matter.Composite.remove(this.engine.world, shaft); this.shafts.delete(id);
    }
    for (const hole of holes) {
      if (!screws[hole.id]) continue;
      // Initial buried shafts belong beneath their authored covering wood.
      // Once a strip clears one, the exposed metal remains solid for *every*
      // layer. A support on a lower layer cannot make an exposed shaft ghost
      // through a higher swinging strip later in the same puzzle.
      let mask = 0;
      for (const entry of this.wood.values())
        if (!entry.occludedShafts.has(hole.id)) mask |= entry.category;
      let shaft = this.shafts.get(hole.id);
      if (!shaft) {
        const point = metric(hole);
        shaft = Matter.Bodies.circle(point.x, point.y, BOLT_RADIUS * PHYSICS_WIDTH,
          { isStatic: true, friction: .48, frictionStatic: .85, restitution: .12,
            collisionFilter: { category: SHAFT_CATEGORY, mask, group: 0 }, label: `shaft-${hole.id}` }, 14);
        this.shafts.set(hole.id, shaft); Matter.Composite.add(this.engine.world, shaft);
      } else shaft.collisionFilter.mask = mask;
    }
  }

  private localShaft(entry: WoodBody, hole: Hole): Matter.Vector {
    const pose = this.pose(entry);
    return rotate({ x: (hole.x - pose.x) * PHYSICS_WIDTH,
      y: (hole.y - pose.y) * PHYSICS_WIDTH * PHYSICS_ASPECT }, -pose.angle);
  }
  private seedOccludedShafts(entry: WoodBody): void {
    entry.occludedShafts.clear();
    for (const hole of this.holes) {
      if (!this.screws[hole.id]) continue;
      const original = this.level.holes[hole.id];
      // A newly parked shaft or an added drill was inserted into clear space.
      // It must never acquire a transient pass-through exemption on restore.
      if (!original?.initialScrew || !this.authoredOcclusion(entry, original)) continue;
      const local = this.localShaft(entry, hole);
      // Only a screw center buried inside solid wood is an authored occlusion.
      // A shaft just outside the edge is a real support contact and must stay
      // solid when resuming a saved loose strip resting on it.
      const inside = Math.abs(local.x) < entry.plank.length * PHYSICS_WIDTH / 2 - .2 &&
        Math.abs(local.y) < entry.plank.width * PLANK_WIDTH_SCALE * PHYSICS_WIDTH / 2 - .2;
      const drilled = entry.drills.some(d => Math.hypot(d.x * PHYSICS_WIDTH - local.x,
        d.y * PHYSICS_WIDTH - local.y) < (DRILL_RADIUS - BOLT_RADIUS) * PHYSICS_WIDTH + .8);
      if (inside && !drilled) entry.occludedShafts.add(hole.id);
    }
  }
  private authoredOcclusion(entry: WoodBody, hole: Hole): boolean {
    const plank = entry.plank;
    const dx = (hole.x - plank.x) * PHYSICS_WIDTH;
    const dy = (hole.y - plank.y) * PHYSICS_WIDTH * PHYSICS_ASPECT;
    const local = rotate({ x: dx, y: dy }, -plank.angle);
    const inside = Math.abs(local.x) < plank.length * PHYSICS_WIDTH / 2 - .2 &&
      Math.abs(local.y) < plank.width * PLANK_WIDTH_SCALE * PHYSICS_WIDTH / 2 - .2;
    const drilled = entry.drills.some(d => Math.hypot(d.x * PHYSICS_WIDTH - local.x,
      d.y * PHYSICS_WIDTH - local.y) < (DRILL_RADIUS - BOLT_RADIUS) * PHYSICS_WIDTH + .8);
    return inside && !drilled;
  }
  private exposeClearedShafts(): void {
    let changed = false;
    for (const entry of this.wood.values()) for (const id of entry.occludedShafts) {
      const hole = this.holes[id];
      if (!hole || !this.screws[id]) { entry.occludedShafts.delete(id); changed = true; continue; }
      const local = this.localShaft(entry, hole), radius = BOLT_RADIUS * PHYSICS_WIDTH + .5;
      const clearDrill = entry.drills.some(drill => Math.hypot(drill.x * PHYSICS_WIDTH - local.x,
        drill.y * PHYSICS_WIDTH - local.y) < (DRILL_RADIUS - BOLT_RADIUS) * PHYSICS_WIDTH - .3);
      if (Math.abs(local.x) > entry.plank.length * PHYSICS_WIDTH / 2 + radius ||
        Math.abs(local.y) > entry.plank.width * PLANK_WIDTH_SCALE * PHYSICS_WIDTH / 2 + radius || clearDrill) {
        entry.occludedShafts.delete(id); changed = true;
      }
    }
    if (changed) this.syncShafts(this.holes, this.screws);
  }

  /** Fixed 120 Hz stepping and a speed-dependent subdivision keep tiny metal
   * shafts solid even when a long strip drops quickly. dt=0 pauses exactly. */
  step(dt: number): void {
    if (!(dt > 0) || !Number.isFinite(dt)) return;
    this.accumulator += Math.min(dt, .1);
    let iterations = 0;
    while (this.accumulator + 1e-10 >= STEP && iterations++ < 16) {
      let maxSpeed = 0;
      for (const entry of this.wood.values()) if (!entry.body.isStatic) {
        const body = entry.body;
        const materialRadius = Math.hypot(entry.plank.length * PHYSICS_WIDTH / 2,
          entry.plank.width * PLANK_WIDTH_SCALE * PHYSICS_WIDTH / 2) + Math.hypot(entry.center.x, entry.center.y);
        maxSpeed = Math.max(maxSpeed, Matter.Body.getSpeed(body) + Math.abs(Matter.Body.getAngularVelocity(body)) * materialRadius);
      }
      // Rotation is included at the farthest material point, rather than at
      // the centre alone: a long hinged strip can have a fast moving tip even
      // when its centre barely moves. Check newly exposed shafts after *each*
      // subdivision, before the strip can swing back into them.
      const subdivisions = Math.min(32, Math.max(1, Math.ceil(maxSpeed * STEP * 60 / MAX_EDGE_TRAVEL)));
      for (let i = 0; i < subdivisions; i++) {
        Matter.Engine.update(this.engine, STEP * 1000 / subdivisions);
        this.exposeClearedShafts();
      }
      this.accumulator -= STEP;
    }
    for (const [id, entry] of this.wood) {
      if (!entry.bindings.length && entry.body.bounds.min.y > PHYSICS_WIDTH * PHYSICS_ASPECT + 38) {
        this.fallen.add(id); this.removeWood(entry); this.wood.delete(id);
      }
    }
  }

  private removeWood(entry: WoodBody): void {
    for (const constraint of entry.constraints) Matter.Composite.remove(this.engine.world, constraint);
    Matter.Composite.remove(this.engine.world, entry.body);
  }
  private pose(entry: WoodBody): PhysicsPose {
    const body = entry.body, center = rotate(entry.center, body.angle);
    const velocity = Matter.Body.getVelocity(body), angularVelocity = Matter.Body.getAngularVelocity(body) * 60;
    // A material center away from the center of mass also has tangential speed.
    return { ...entry.plank, width: entry.plank.width * PLANK_WIDTH_SCALE,
      x: (body.position.x - center.x) / PHYSICS_WIDTH,
      y: (body.position.y - center.y) / (PHYSICS_WIDTH * PHYSICS_ASPECT), angle: body.angle,
      vx: (velocity.x * 60 + angularVelocity * center.y) / PHYSICS_WIDTH,
      vy: (velocity.y * 60 - angularVelocity * center.x) / PHYSICS_WIDTH,
      angularVelocity, remainingPins: entry.bindings.map(b => b.hole),
      pivotHole: entry.bindings.length === 1 ? entry.bindings[0].hole : null };
  }
  getPoses(): PhysicsPose[] { return [...this.wood.values()].map(entry => this.pose(entry)); }
  getDrilledHoles(id: number): DrilledHole[] {
    const entry = this.wood.get(id); if (!entry) return [];
    const pose = this.pose(entry);
    return entry.drills.map((drill, index) => {
      const local = rotate(drill, pose.angle);
      return { index, x: pose.x + local.x, y: pose.y + local.y / PHYSICS_ASPECT,
        radius: DRILL_RADIUS, sourceHole: drill.sourceHole };
    });
  }
  getFallenIds(): number[] { return [...this.fallen]; }
  /** Current material contacts identify the parked screw supporting a loose
   * strip. Gameplay hints can clear that actual obstruction rather than moving
   * an unrelated screw between the same two parking holes. */
  getContacts(): BoltContact[] {
    const result = new Map<string, BoltContact>();
    const woodIds = new Map([...this.wood.values()].map(entry => [entry.body.id, entry.plank.id]));
    const shaftIds = new Map([...this.shafts].map(([hole, body]) => [body.id, hole]));
    for (const pair of this.engine.pairs.list) {
      if (!pair.isActive) continue;
      const a = pair.bodyA.parent.id, b = pair.bodyB.parent.id;
      const plank = woodIds.get(a) ?? woodIds.get(b);
      const hole = shaftIds.get(a) ?? shaftIds.get(b);
      if (plank !== undefined && hole !== undefined) result.set(`${plank}:${hole}`, { plank, hole });
    }
    return [...result.values()];
  }
  snapshot(): PhysicsSnapshot {
    return { version: 1, poses: this.getPoses().map(({ id, x, y, angle, vx, vy, angularVelocity }) =>
      ({ id, x, y, angle, vx, vy, angularVelocity })), fallen: this.getFallenIds() };
  }
  restore(snapshot: PhysicsSnapshot): boolean {
    if (snapshot?.version !== 1 || !Array.isArray(snapshot.poses) || !Array.isArray(snapshot.fallen) ||
      !snapshot.poses.every(p => Number.isInteger(p.id) && [p.x, p.y, p.angle, p.vx, p.vy, p.angularVelocity].every(Number.isFinite))) return false;
    for (const pose of snapshot.poses) {
      const entry = this.wood.get(pose.id); if (entry) this.setPose(entry, { ...entry.plank, ...pose });
    }
    this.fallen = new Set(snapshot.fallen.filter(id => Number.isInteger(id)));
    return true;
  }
}

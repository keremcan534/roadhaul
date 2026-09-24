import { SeededRandom } from '../../core/random/SeededRandom';
import type { TrafficVehicleDefinition } from '../../data/definitions/TrafficVehicleDefinition';
import type { VehicleFootprint } from '../vehicles/VehicleFootprint';
import type { MovingObstacles } from '../world/DrivingWorld';
import { COMFORTABLE_DECELERATION, type LaneGraph } from './LaneGraph';

/** What a vehicle is doing (spec §19's traffic behaviours). */
export const TRAFFIC_BEHAVIOURS = ['cruise', 'follow', 'stop', 'avoid', 'changeLane', 'turn', 'emergencyStop'] as const;
export type TrafficBehaviour = (typeof TRAFFIC_BEHAVIOURS)[number];
const CRUISE = 0;
const FOLLOW = 1;
const STOP = 2;
const AVOID = 3;
const CHANGE_LANE = 4;
const TURN = 5;
const EMERGENCY_STOP = 6;

export interface TrafficSettings {
  /** Vehicles alive at once (0: no traffic). */
  readonly maxVehicles: number;
  /** Vehicles live within this distance of the truck. */
  readonly radiusMeters: number;
  /** New vehicles appear at least this far from the truck. */
  readonly minSpawnDistanceMeters: number;
  /** False: no vehicles appear by themselves, only those added with addVehicle(). */
  readonly autoSpawn?: boolean;
}

/** The player's truck, as traffic sees it: its rear axle, heading (radians) and speed (m/s). */
export interface TrafficTruck {
  readonly x: number;
  readonly z: number;
  readonly heading: number;
  readonly speed: number;
}

/** Car following (the Intelligent Driver Model): gap kept at a standstill, m… */
const MIN_GAP_METERS = 2.5;
/** …and time gap kept while moving, s. */
const HEADWAY_SECONDS = 1.3;
/** Hardest braking, m/s²: an emergency stop. Braking harder than the threshold counts as one. */
const EMERGENCY_DECELERATION = 8;
const EMERGENCY_THRESHOLD = 4;
/** Vehicles look this far ahead, plus their braking distance. */
const LOOK_AHEAD_METERS = 40;
const STOPPED_SPEED = 0.4;
/** Vehicles are recycled this far beyond the traffic radius (so fresh ones do not vanish at once). */
const RECYCLE_MARGIN_METERS = 80;
/** Closer than this, new vehicles only appear behind the truck, where the camera does not look. */
const HIDDEN_DISTANCE_METERS = 350;
const SPAWN_SPACING_METERS = 30;
const SPAWN_ATTEMPTS_PER_STEP = 6;
/** When traffic starts (or the truck is moved), the roads fill at once, from this close. */
const FILL_ATTEMPTS = 400;
const FILL_MIN_DISTANCE_METERS = 60;
/** The truck moved further than this in one step: it was placed somewhere, not driven. */
const TELEPORT_METERS = 25;
const CLEAR_AROUND_TELEPORT_METERS = 45;
/** A vehicle the truck hits stops for this long (after it has come to a halt). */
const CRASH_WAIT_SECONDS = 6;
/** Stuck behind a standing truck this long, a vehicle drives round it through the other lane… */
const AVOID_WAIT_SECONDS = 3;
const AVOID_SPEED = 6;
const AVOID_MARGIN_METERS = 0.5;
/** …if the other lane is clear this far beyond the truck. */
const AVOID_ONCOMING_CLEARANCE_METERS = 90;
/** How often a vehicle on a two-lane road considers changing lanes, s. */
const LANE_CHANGE_INTERVAL_SECONDS = 0.5;
/** Sideways speed limit of a lane change, m/s, and how quickly it settles (1/s). */
const LANE_CHANGE_MAX_SPEED = 1.4;
const LANE_CHANGE_RATE = 1.8;
/** No overtaking this close to the end of a lane. */
const LANE_CHANGE_END_CLEARANCE_METERS = 220;
/** Turns from the same lane overlap this far from their start. */
const SIBLING_OVERLAP_METERS = 15;
/** A vehicle stuck this long, this far from the truck, is recycled. */
const STUCK_RECYCLE_SECONDS = 90;
const STUCK_RECYCLE_DISTANCE_METERS = 120;
/** Vehicles keep this much sideways room from the truck. */
const LATERAL_MARGIN_METERS = 0.35;
const MAX_CIRCLES_PER_VEHICLE = 5;
const MAX_TRUCK_CIRCLES = 16;
/** Heading follows the path over this distance either side of the vehicle's centre. */
const HEADING_SPAN_METERS = 2;
/**
 * Traffic gives way to the truck at junctions: it takes a turn only if it
 * will be through the junction this many seconds before the truck gets
 * there, so it never cuts in front of the player (spec §24: the game must
 * not punish the player unfairly). It looks this far ahead in time.
 */
const GIVE_WAY_MARGIN_SECONDS = 1.5;
const GIVE_WAY_HORIZON_SECONDS = 15;

const NO_LEADER = 0;
const VEHICLE_LEADER = 1;
const TRUCK_LEADER = 2;
const STOP_LINE_LEADER = 3;

/**
 * Waypoint-based NPC traffic around the truck (roadmap step 22, spec §19).
 * Vehicles follow the LaneGraph's links: they cruise at their share of the
 * speed limit, slow for bends, follow the vehicle ahead (the Intelligent
 * Driver Model), stop behind the truck and where a turn would cross another
 * vehicle's, overtake on the highway, go round a truck standing in their
 * lane, turn at junctions, U-turn at dead ends, and brake hard when
 * something appears close ahead. A vehicle the truck hits stops.
 *
 * Kinematic: vehicles move along their paths and are never pushed. Only
 * `maxVehicles` exist, all within `radiusMeters` of the truck: new ones
 * appear out of sight, far ones are recycled. State lives in flat arrays and
 * update() allocates nothing. Randomness is seeded, so a run is repeatable.
 *
 * It is the truck's MovingObstacles: DrivingWorld pushes the truck out of
 * the vehicles' circles and reports hits back.
 */
export class TrafficSimulation implements MovingObstacles {
  readonly capacity: number;
  /** Per vehicle slot. Poses are the vehicle's centre; `previous*` hold the pose before the last step. */
  readonly active: Uint8Array;
  /** Changes whenever a new vehicle takes the slot (so views know to restyle it). */
  readonly serial: Int32Array;
  readonly type: Uint8Array;
  readonly color: Int32Array;
  readonly x: Float64Array;
  readonly z: Float64Array;
  readonly heading: Float64Array;
  readonly previousX: Float64Array;
  readonly previousZ: Float64Array;
  readonly previousHeading: Float64Array;
  readonly speed: Float64Array;
  readonly link: Int32Array;
  readonly s: Float64Array;
  readonly behaviour: Uint8Array;

  readonly circleX: Float64Array;
  readonly circleZ: Float64Array;
  readonly circleRadius: Float64Array;
  readonly circleVelocityX: Float64Array;
  readonly circleVelocityZ: Float64Array;
  /** The vehicle slot each circle belongs to. */
  readonly circleOwner: Int32Array;
  private circles = 0;
  private serials = 0;

  private readonly random: SeededRandom;
  private readonly halfLength: Float64Array;
  private readonly halfWidth: Float64Array;
  private readonly acceleration: Float64Array;
  private readonly cruiseFactor: Float64Array;
  private readonly next: Int32Array;
  private readonly after: Int32Array;
  private readonly segment: Int32Array;
  private readonly centre: Float64Array;
  private readonly lateral: Float64Array;
  private readonly lateralTarget: Float64Array;
  private readonly changeFrom: Int32Array;
  private readonly holding: Int32Array;
  private readonly waitSeconds: Float64Array;
  private readonly stuckSeconds: Float64Array;
  private readonly crashSeconds: Float64Array;
  private readonly bumped: Float64Array;
  private readonly avoidUntil: Float64Array;
  private readonly laneTimer: Float64Array;
  private readonly leaderGap: Float64Array;
  private readonly leaderSpeed: Float64Array;
  private readonly leaderKind: Uint8Array;
  private activeCount = 0;
  /** Everyone drives at this share of their usual speed (the weather). */
  private speedFactor = 1;
  /** Vehicles holding each turn (they may drive it; conflicting turns wait). */
  private readonly holders: Int32Array;
  /**
   * How long the longest-waiting vehicle has waited at the stop line of each
   * turn: last step's (read) and this step's (written). A vehicle yields to
   * any that has waited longer for a conflicting turn: first come, first served.
   */
  private claims: Float64Array;
  private nextClaims: Float64Array;
  private readonly lineWait: Float64Array;
  /**
   * Junctions the truck stands in (no turns through them) or is driving
   * towards (turns wait unless the truck is behind the vehicle), and nodes
   * whose turns can conflict at all.
   */
  private readonly nodeBlocked: Uint8Array;
  /** Seconds until the truck reaches each junction; Infinity when it is not heading there. */
  private readonly truckEta: Float64Array;
  private readonly nodeHasConflicts: Uint8Array;
  private readonly spawnCumulative: Float64Array;
  private readonly typeCumulative: Float64Array;

  private readonly truckCircleX = new Float64Array(MAX_TRUCK_CIRCLES);
  private readonly truckCircleZ = new Float64Array(MAX_TRUCK_CIRCLES);
  private truckCircleCount = 0;
  private truckRadius = 0;
  private truckX = 0;
  private truckZ = 0;
  private truckHeading = 0;
  private truckSpeed = 0;
  private truckReach = 0;
  private truckKnown = false;
  private filling = true;
  /** Scratch results of pointAt() and scanTruck(). */
  private pointXOut = 0;
  private pointZOut = 0;
  private truckGap = Infinity;
  private truckFar = -Infinity;
  private truckMinLeft = Infinity;

  constructor(
    readonly graph: LaneGraph,
    readonly types: readonly TrafficVehicleDefinition[],
    private readonly settings: TrafficSettings,
    seed: number,
  ) {
    const capacity = types.length === 0 || graph.spawnLanes.length === 0 ? 0 : Math.max(0, settings.maxVehicles);
    this.capacity = capacity;
    this.random = new SeededRandom(seed);
    this.active = new Uint8Array(capacity);
    this.serial = new Int32Array(capacity);
    this.type = new Uint8Array(capacity);
    this.color = new Int32Array(capacity);
    this.x = new Float64Array(capacity);
    this.z = new Float64Array(capacity);
    this.heading = new Float64Array(capacity);
    this.previousX = new Float64Array(capacity);
    this.previousZ = new Float64Array(capacity);
    this.previousHeading = new Float64Array(capacity);
    this.speed = new Float64Array(capacity);
    this.link = new Int32Array(capacity);
    this.s = new Float64Array(capacity);
    this.behaviour = new Uint8Array(capacity);
    this.halfLength = new Float64Array(capacity);
    this.halfWidth = new Float64Array(capacity);
    this.acceleration = new Float64Array(capacity);
    this.cruiseFactor = new Float64Array(capacity);
    this.next = new Int32Array(capacity);
    this.after = new Int32Array(capacity);
    this.segment = new Int32Array(capacity);
    this.centre = new Float64Array(capacity);
    this.lateral = new Float64Array(capacity);
    this.lateralTarget = new Float64Array(capacity);
    this.changeFrom = new Int32Array(capacity).fill(-1);
    this.holding = new Int32Array(capacity).fill(-1);
    this.waitSeconds = new Float64Array(capacity);
    this.stuckSeconds = new Float64Array(capacity);
    this.crashSeconds = new Float64Array(capacity);
    this.bumped = new Float64Array(capacity).fill(-1);
    this.avoidUntil = new Float64Array(capacity).fill(-1);
    this.laneTimer = new Float64Array(capacity);
    this.leaderGap = new Float64Array(capacity);
    this.leaderSpeed = new Float64Array(capacity);
    this.leaderKind = new Uint8Array(capacity);
    const circles = capacity * MAX_CIRCLES_PER_VEHICLE;
    this.circleX = new Float64Array(circles);
    this.circleZ = new Float64Array(circles);
    this.circleRadius = new Float64Array(circles);
    this.circleVelocityX = new Float64Array(circles);
    this.circleVelocityZ = new Float64Array(circles);
    this.circleOwner = new Int32Array(circles);
    this.holders = new Int32Array(graph.linkCount);
    this.claims = new Float64Array(graph.linkCount);
    this.nextClaims = new Float64Array(graph.linkCount);
    this.lineWait = new Float64Array(capacity);
    this.nodeBlocked = new Uint8Array(graph.nodeCount);
    this.truckEta = new Float64Array(graph.nodeCount);
    this.nodeHasConflicts = new Uint8Array(graph.nodeCount);
    for (let link = 0; link < graph.linkCount; link++) {
      if (graph.isTurn(link) && graph.conflictStart[link + 1]! > graph.conflictStart[link]!) {
        this.nodeHasConflicts[graph.node[link]!] = 1;
      }
    }
    this.spawnCumulative = new Float64Array(graph.spawnLanes.length);
    let total = 0;
    graph.spawnLanes.forEach((lane, index) => {
      total += graph.length[lane]!;
      this.spawnCumulative[index] = total;
    });
    this.typeCumulative = new Float64Array(types.length);
    let weights = 0;
    types.forEach((type, index) => {
      weights += type.spawnWeight;
      this.typeCumulative[index] = weights;
    });
  }

  /** Vehicles on the road now. */
  get vehicleCount(): number {
    return this.activeCount;
  }

  get circleCount(): number {
    return this.circles;
  }

  behaviourOf(index: number): TrafficBehaviour {
    return TRAFFIC_BEHAVIOURS[this.behaviour[index]!]!;
  }

  /** Slows all traffic to `factor` of its usual cruising speed (rain, night). */
  setSpeedFactor(factor: number): void {
    this.speedFactor = Math.max(0.1, Math.min(1, factor));
  }

  /** Removes every vehicle; the roads fill again on the next update. */
  reset(): void {
    for (let i = 0; i < this.capacity; i++) {
      if (this.active[i] === 1) {
        this.despawn(i);
      }
    }
    this.circles = 0;
    this.filling = true;
    this.truckKnown = false;
  }

  /** MovingObstacles: the truck touched circle `index`. The vehicle stops (see CRASH_WAIT_SECONDS). */
  hit(index: number, impactSpeed: number): void {
    const owner = this.circleOwner[index]!;
    this.bumped[owner] = Math.max(this.bumped[owner]!, impactSpeed);
  }

  /**
   * Advances every vehicle by `dt` seconds, with the truck where it is now
   * (`footprint` is its collision shape). Call once per fixed step, before
   * the truck moves. Allocation-free.
   */
  update(dt: number, truck: TrafficTruck, footprint: VehicleFootprint): void {
    this.readTruck(truck, footprint);
    if (this.capacity === 0) {
      return;
    }
    this.recycle();
    this.spawn();
    this.markBlockedNodes();
    this.nextClaims.fill(0);
    for (let i = 0; i < this.capacity; i++) {
      if (this.active[i] === 1) {
        this.stepVehicle(i, dt);
      }
    }
    const claims = this.claims;
    this.claims = this.nextClaims;
    this.nextClaims = claims;
    this.writeCircles();
  }

  private readTruck(truck: TrafficTruck, footprint: VehicleFootprint): void {
    const sin = Math.sin(truck.heading);
    const cos = Math.cos(truck.heading);
    const count = Math.min(MAX_TRUCK_CIRCLES, footprint.offsets.length);
    let reach = 0;
    for (let k = 0; k < count; k++) {
      const offset = footprint.offsets[k]!;
      this.truckCircleX[k] = truck.x + sin * offset;
      this.truckCircleZ[k] = truck.z + cos * offset;
      reach = Math.max(reach, Math.abs(offset));
    }
    this.truckCircleCount = count;
    this.truckRadius = footprint.radius;
    this.truckReach = reach + footprint.radius;
    const moved = Math.hypot(truck.x - this.truckX, truck.z - this.truckZ);
    this.truckX = truck.x;
    this.truckZ = truck.z;
    this.truckHeading = truck.heading;
    this.truckSpeed = truck.speed;
    if (this.truckKnown && moved > TELEPORT_METERS) {
      // Placed somewhere new: clear the spot and fill the roads around it.
      const clear = CLEAR_AROUND_TELEPORT_METERS + this.truckReach;
      for (let i = 0; i < this.capacity; i++) {
        if (this.active[i] === 1 && Math.hypot(this.x[i]! - truck.x, this.z[i]! - truck.z) < clear) {
          this.despawn(i);
        }
      }
      this.filling = true;
    }
    this.truckKnown = true;
  }

  private recycle(): void {
    const limit = this.settings.radiusMeters + RECYCLE_MARGIN_METERS;
    for (let i = 0; i < this.capacity; i++) {
      if (this.active[i] !== 1) {
        continue;
      }
      const distance = Math.hypot(this.x[i]! - this.truckX, this.z[i]! - this.truckZ);
      const stuck = this.stuckSeconds[i]! > STUCK_RECYCLE_SECONDS && distance > STUCK_RECYCLE_DISTANCE_METERS;
      if (distance > limit || stuck) {
        this.despawn(i);
      }
    }
  }

  /**
   * Puts a vehicle of kind `types[typeIndex]` on `link`, `s` meters along it,
   * moving at `speed`; it cruises at `cruiseFactor` times its kind's share of
   * the limit. For scripted scenes (road events) and tests. Returns its slot,
   * or -1 when every slot is taken.
   */
  addVehicle(typeIndex: number, link: number, s: number, speed: number, cruiseFactor = 1): number {
    if (this.activeCount >= this.capacity) {
      return -1;
    }
    const type = this.types[typeIndex]!;
    return this.initVehicle(typeIndex, 0, type.cruiseSpeedFactor * cruiseFactor, link, s, speed);
  }

  private spawn(): void {
    const filling = this.filling;
    this.filling = false;
    if (this.settings.autoSpawn === false) {
      return;
    }
    const attempts = filling ? FILL_ATTEMPTS : SPAWN_ATTEMPTS_PER_STEP;
    for (let attempt = 0; attempt < attempts && this.activeCount < this.capacity; attempt++) {
      if (this.trySpawn(filling) && !filling) {
        return; // One new vehicle per step while driving.
      }
    }
  }

  private trySpawn(filling: boolean): boolean {
    const graph = this.graph;
    const lanes = graph.spawnLanes;
    const pick = this.random.next() * this.spawnCumulative[lanes.length - 1]!;
    let index = 0;
    while (index < lanes.length - 1 && this.spawnCumulative[index]! < pick) index++;
    const lane = lanes[index]!;
    const length = graph.length[lane]!;
    const s = this.random.range(10, Math.max(10, length - 10));
    const typeIndex = this.pickType();
    const colorPick = this.random.next();
    const cruisePick = this.random.next();
    if (length < 20) {
      return false;
    }
    this.pointAt(lane, s);
    const dx = this.pointXOut - this.truckX;
    const dz = this.pointZOut - this.truckZ;
    const distance = Math.hypot(dx, dz);
    const minDistance = filling ? FILL_MIN_DISTANCE_METERS : this.settings.minSpawnDistanceMeters;
    if (distance < minDistance || distance > this.settings.radiusMeters) {
      return false;
    }
    const ahead = dx * Math.sin(this.truckHeading) + dz * Math.cos(this.truckHeading);
    if (!filling && distance < HIDDEN_DISTANCE_METERS && ahead > -20) {
      return false; // In front of the camera: it would pop up in view.
    }
    const type = this.types[typeIndex]!;
    for (let j = 0; j < this.capacity; j++) {
      if (this.active[j] === 1 && this.link[j] === lane && Math.abs(this.s[j]! - s) < SPAWN_SPACING_METERS + type.lengthMeters) {
        return false;
      }
    }
    const colorIndex = Math.min(type.colors.length - 1, Math.floor(colorPick * type.colors.length));
    this.initVehicle(typeIndex, colorIndex, type.cruiseSpeedFactor * (0.92 + 0.14 * cruisePick), lane, s, null);
    return true;
  }

  /** Fills a free slot with a new vehicle; `speed` null starts it a little below its cruising speed. */
  private initVehicle(
    typeIndex: number,
    colorIndex: number,
    cruiseFactor: number,
    lane: number,
    s: number,
    speed: number | null,
  ): number {
    const graph = this.graph;
    const type = this.types[typeIndex]!;
    let i = 0;
    while (this.active[i] === 1) i++;
    this.active[i] = 1;
    this.activeCount++;
    this.serial[i] = ++this.serials;
    this.type[i] = typeIndex;
    this.color[i] = type.colors[colorIndex]!;
    this.halfLength[i] = type.lengthMeters / 2;
    this.halfWidth[i] = type.widthMeters / 2;
    this.acceleration[i] = type.accelerationMetersPerSecondSquared;
    this.cruiseFactor[i] = cruiseFactor;
    this.link[i] = lane;
    this.s[i] = s;
    this.next[i] = this.choose(lane);
    this.after[i] = this.next[i]! >= 0 ? this.choose(this.next[i]!) : -1;
    this.segment[i] = graph.segmentAt(lane, s);
    this.lateral[i] = 0;
    this.lateralTarget[i] = 0;
    this.changeFrom[i] = -1;
    this.holding[i] = -1;
    this.waitSeconds[i] = 0;
    this.stuckSeconds[i] = 0;
    this.lineWait[i] = 0;
    this.crashSeconds[i] = 0;
    this.bumped[i] = -1;
    this.avoidUntil[i] = -1;
    this.laneTimer[i] = (i % 8) * (LANE_CHANGE_INTERVAL_SECONDS / 8);
    this.behaviour[i] = CRUISE;
    this.leaderGap[i] = Infinity;
    this.leaderSpeed[i] = 0;
    this.leaderKind[i] = NO_LEADER;
    this.speed[i] =
      speed ?? 0.8 * Math.min(this.cruiseSpeed(i), graph.advisorySpeed[graph.pointStart[lane]! + this.segment[i]! + 1]!);
    this.updatePose(i, 0);
    this.previousX[i] = this.x[i]!;
    this.previousZ[i] = this.z[i]!;
    this.previousHeading[i] = this.heading[i]!;
    return i;
  }

  private pickType(): number {
    const pick = this.random.next() * this.typeCumulative[this.typeCumulative.length - 1]!;
    let index = 0;
    while (index < this.typeCumulative.length - 1 && this.typeCumulative[index]! < pick) index++;
    return index;
  }

  /** Picks where a vehicle goes after `link`, weighted; -1 where the road ends. */
  private choose(link: number): number {
    const graph = this.graph;
    const first = graph.successorStart[link]!;
    const last = graph.successorStart[link + 1]!;
    if (last === first) {
      return -1;
    }
    let total = 0;
    for (let k = first; k < last; k++) total += graph.successorWeights[k]!;
    let pick = this.random.next() * total;
    for (let k = first; k < last - 1; k++) {
      pick -= graph.successorWeights[k]!;
      if (pick < 0) {
        return graph.successors[k]!;
      }
    }
    return graph.successors[last - 1]!;
  }

  private despawn(i: number): void {
    this.release(i);
    this.active[i] = 0;
    this.activeCount--;
  }

  private release(i: number): void {
    const held = this.holding[i]!;
    if (held >= 0) {
      this.holders[held]!--;
      this.holding[i] = -1;
    }
  }

  private markBlockedNodes(): void {
    const graph = this.graph;
    const velocityX = Math.sin(this.truckHeading) * this.truckSpeed;
    const velocityZ = Math.cos(this.truckHeading) * this.truckSpeed;
    const speed = Math.abs(this.truckSpeed);
    for (let node = 0; node < graph.nodeCount; node++) {
      let blocked = 0;
      let eta = Infinity;
      if (this.nodeHasConflicts[node] === 1) {
        const reach = graph.nodeRadius[node]! + this.truckRadius + 1;
        for (let k = 0; k < this.truckCircleCount; k++) {
          const dx = this.truckCircleX[k]! - graph.nodeX[node]!;
          const dz = this.truckCircleZ[k]! - graph.nodeZ[node]!;
          if (dx * dx + dz * dz < reach * reach) {
            blocked = 1;
            break;
          }
        }
        const dx = graph.nodeX[node]! - this.truckX;
        const dz = graph.nodeZ[node]! - this.truckZ;
        const distance = Math.hypot(dx, dz);
        const towards = distance > 0 ? (dx * velocityX + dz * velocityZ) / distance : 0;
        if (speed > 1 && towards > 0.5 * speed) {
          eta = Math.max(0, distance - reach - this.truckReach) / towards;
          if (eta > GIVE_WAY_HORIZON_SECONDS) eta = Infinity;
        }
      }
      this.nodeBlocked[node] = blocked;
      this.truckEta[node] = eta;
    }
  }

  private stepVehicle(i: number, dt: number): void {
    this.previousX[i] = this.x[i]!;
    this.previousZ[i] = this.z[i]!;
    this.previousHeading[i] = this.heading[i]!;
    if (this.bumped[i]! >= 0) {
      this.crashSeconds[i] = CRASH_WAIT_SECONDS;
      this.bumped[i] = -1;
      this.endAvoid(i);
    }
    let speed = this.speed[i]!;
    let acceleration: number;
    let behaviour: number;
    if (this.crashSeconds[i]! > 0) {
      acceleration = -EMERGENCY_DECELERATION;
      behaviour = EMERGENCY_STOP;
      if (speed < 0.01) {
        this.crashSeconds[i]! -= dt;
      }
      this.leaderKind[i] = NO_LEADER;
    } else {
      this.considerLaneChange(i, dt);
      const lookAhead = LOOK_AHEAD_METERS + (speed * speed) / (2 * COMFORTABLE_DECELERATION) + speed * HEADWAY_SECONDS;
      this.findLeader(i, lookAhead, dt);
      this.considerAvoid(i);
      const desired = this.desiredSpeed(i);
      acceleration = idmAcceleration(speed, desired, this.leaderGap[i]!, this.leaderSpeed[i]!, this.acceleration[i]!);
      behaviour = this.classify(i, speed, acceleration);
    }
    speed = Math.max(0, speed + acceleration * dt);
    this.speed[i] = speed;
    this.advance(i, speed * dt);
    if (this.active[i] !== 1) {
      return;
    }
    this.updatePose(i, dt);
    this.behaviour[i] = behaviour;
    const stopped = speed < STOPPED_SPEED;
    this.waitSeconds[i] = stopped && this.leaderKind[i] === TRUCK_LEADER ? this.waitSeconds[i]! + dt : 0;
    this.stuckSeconds[i] = stopped ? this.stuckSeconds[i]! + dt : 0;
  }

  private classify(i: number, speed: number, acceleration: number): number {
    if (this.avoidUntil[i]! >= 0) {
      return AVOID;
    }
    if (acceleration < -EMERGENCY_THRESHOLD) {
      return EMERGENCY_STOP;
    }
    if (speed < STOPPED_SPEED && this.leaderKind[i] !== NO_LEADER && this.leaderGap[i]! < 12) {
      return STOP;
    }
    if (this.changeFrom[i]! >= 0 || Math.abs(this.lateral[i]!) > 0.3) {
      return CHANGE_LANE;
    }
    if (this.graph.isTurn(this.link[i]!)) {
      return TURN;
    }
    if (this.leaderKind[i] !== NO_LEADER && this.leaderGap[i]! < MIN_GAP_METERS + speed * HEADWAY_SECONDS * 2 + 10) {
      return FOLLOW;
    }
    return CRUISE;
  }

  /** Cruising speed on the current link, m/s. */
  private cruiseSpeed(i: number): number {
    return this.graph.speedLimit[this.link[i]!]! * this.cruiseFactor[i]! * this.speedFactor;
  }

  /** How fast the vehicle wants to go: its cruise speed, slowed for bends and turns ahead. */
  private desiredSpeed(i: number): number {
    const graph = this.graph;
    const link = this.link[i]!;
    const factor = this.cruiseFactor[i]! * this.speedFactor;
    let desired = Math.min(this.cruiseSpeed(i), graph.advisorySpeed[graph.pointStart[link]! + this.segment[i]! + 1]!);
    const next = this.next[i]!;
    const toEnd = Math.max(0, graph.length[link]! - this.s[i]!);
    if (next >= 0) {
      const entry = Math.min(graph.speedLimit[next]! * factor, graph.advisorySpeed[graph.pointStart[next]!]!);
      desired = Math.min(desired, Math.sqrt(entry * entry + 2 * COMFORTABLE_DECELERATION * toEnd));
      const after = this.after[i]!;
      if (after >= 0) {
        const afterEntry = Math.min(graph.speedLimit[after]! * factor, graph.advisorySpeed[graph.pointStart[after]!]!);
        desired = Math.min(
          desired,
          Math.sqrt(afterEntry * afterEntry + 2 * COMFORTABLE_DECELERATION * (toEnd + graph.length[next]!)),
        );
      }
    }
    if (this.avoidUntil[i]! >= 0) {
      desired = Math.min(desired, AVOID_SPEED);
    }
    return Math.max(0.5, desired);
  }

  /**
   * The nearest thing ahead on the vehicle's path within `lookAhead`: another
   * vehicle, the truck, or the stop line of a turn it may not take yet. Sets
   * leaderGap (bumper to bumper, m), leaderSpeed and leaderKind.
   */
  private findLeader(i: number, lookAhead: number, dt: number): void {
    const graph = this.graph;
    const link = this.link[i]!;
    const next = this.next[i]!;
    const after = this.after[i]!;
    const s = this.s[i]!;
    const toEnd = graph.length[link]! - s;
    const lengthNext = next >= 0 ? graph.length[next]! : 0;
    const half = this.halfLength[i]!;
    const nextIsTurn = next >= 0 && graph.isTurn(next);
    const onTurn = graph.isTurn(link);
    let gap = Infinity;
    let leaderSpeed = 0;
    let kind = NO_LEADER;
    for (let j = 0; j < this.capacity; j++) {
      if (j === i || this.active[j] !== 1) {
        continue;
      }
      const other = this.link[j]!;
      const otherS = this.s[j]!;
      let distance = Infinity;
      let otherSpeed = this.speed[j]!;
      if (other === link) {
        if (otherS > s) {
          distance = otherS - s;
        } else if (next === link) {
          distance = toEnd + otherS; // Round a loop without junctions: behind is also ahead.
        }
      } else if (other === next) {
        distance = toEnd + otherS;
      } else if (other === after && next >= 0) {
        distance = toEnd + lengthNext + otherS;
      } else if (this.changeFrom[j] === link && graph.parallel[link] === other) {
        // Changing out of this lane, and still partly in it.
        const ahead = this.centre[j]! - this.centre[i]!;
        if (ahead > 0) distance = ahead;
      } else if (graph.isTurn(other) && otherS < SIBLING_OVERLAP_METERS) {
        // Turning off the same lane a different way: the two paths still overlap.
        if (nextIsTurn && graph.turnFrom[other] === graph.turnFrom[next]) {
          distance = toEnd + otherS;
        } else if (onTurn && graph.turnFrom[other] === graph.turnFrom[link] && otherS > s) {
          distance = otherS - s;
        }
      } else if (this.avoidUntil[j]! >= 0 && graph.opposite[other] === link) {
        // Coming the other way round an obstacle, in this lane.
        const ahead = graph.stretchLength[link]! - this.centre[j]! - this.centre[i]!;
        if (ahead > 0) {
          distance = ahead;
          otherSpeed = 0;
        }
      }
      if (distance < lookAhead + half) {
        const between = distance - half - this.halfLength[j]!;
        if (between < gap) {
          gap = between;
          leaderSpeed = otherSpeed;
          kind = VEHICLE_LEADER;
        }
      }
    }

    this.scanTruck(i, lookAhead);
    if (this.avoidUntil[i]! < 0 && this.truckGap < gap) {
      gap = this.truckGap;
      leaderSpeed = this.truckSpeed * Math.cos(this.truckHeading - this.heading[i]!);
      kind = TRUCK_LEADER;
    }

    // A turn that conflicts with others: take it only when it is free, else stop at the line.
    let waiting = false;
    const speed = this.speed[i]!;
    const toLine = toEnd - half;
    if (
      nextIsTurn &&
      this.holding[i] === next &&
      toLine > (speed * speed) / (2 * COMFORTABLE_DECELERATION) + 2 &&
      !this.truckAllows(i, next, toEnd, 0)
    ) {
      this.release(i); // The truck turned up: still time to stop, so give way after all.
    }
    if (nextIsTurn && this.holding[i] !== next && this.needsReservation(next)) {
      const commit = (speed * speed) / (2 * COMFORTABLE_DECELERATION) + speed + 12;
      if (toLine <= commit) {
        if (this.canEnter(i, next, toEnd)) {
          this.release(i);
          this.holding[i] = next;
          this.holders[next]!++;
        } else if (toLine - 1 < gap) {
          // First in the queue: stop at the line and claim the turn. The ones behind just follow.
          waiting = true;
          this.lineWait[i]! += dt;
          this.nextClaims[next] = Math.max(this.nextClaims[next]!, this.lineWait[i]!);
          gap = toLine - 1;
          leaderSpeed = 0;
          kind = STOP_LINE_LEADER;
        }
      }
    }
    if (!waiting) {
      this.lineWait[i] = 0;
    }
    this.leaderGap[i] = gap;
    this.leaderSpeed[i] = leaderSpeed;
    this.leaderKind[i] = kind;
  }

  private needsReservation(turn: number): boolean {
    const graph = this.graph;
    return graph.conflictStart[turn + 1]! > graph.conflictStart[turn]! || this.nodeHasConflicts[graph.node[turn]!] === 1;
  }

  /**
   * May vehicle `i` take `turn` now? No conflicting turn is taken, nobody has
   * waited longer for one, the truck is clear of the junction and not about
   * to arrive there (unless it is following this vehicle), and there is room
   * beyond.
   */
  private canEnter(i: number, turn: number, toEnd: number): boolean {
    const graph = this.graph;
    const waited = this.lineWait[i]!;
    for (let k = graph.conflictStart[turn]!; k < graph.conflictStart[turn + 1]!; k++) {
      const other = graph.conflicts[k]!;
      if (this.holders[other]! > 0 || this.claims[other]! > waited + 1e-6) {
        return false;
      }
    }
    if (!this.truckAllows(i, turn, toEnd, GIVE_WAY_MARGIN_SECONDS)) {
      return false;
    }
    const out = graph.turnTo[turn]!;
    const room = 2 * this.halfLength[i]! + 4;
    for (let j = 0; j < this.capacity; j++) {
      if (j !== i && this.active[j] === 1 && this.link[j] === out && this.s[j]! - this.halfLength[j]! < room) {
        return false;
      }
    }
    return this.truckGap > toEnd + graph.length[turn]! + room;
  }

  /**
   * Can vehicle `i`, `toEnd` meters from its lane's end, take `turn` without
   * getting in the truck's way? Not while the truck stands in the junction,
   * nor if the truck gets there less than `margin` seconds after the vehicle
   * is through, unless the truck is just following the vehicle.
   */
  private truckAllows(i: number, turn: number, toEnd: number, margin: number): boolean {
    const node = this.graph.node[turn]!;
    if (this.nodeBlocked[node] === 1) {
      return false;
    }
    const eta = this.truckEta[node]!;
    if (!(eta < Infinity) || this.truckBehind(i)) {
      return true;
    }
    // Through the junction: to the end of the turn, plus its own length. From a standstill it averages half its top speed.
    const distance = Math.max(0, toEnd) + this.graph.length[turn]! + 2 * this.halfLength[i]!;
    const pace = Math.max(this.speed[i]!, 0.5 * Math.sqrt(2 * this.acceleration[i]! * distance));
    return eta > distance / pace + margin;
  }

  /** The truck is behind vehicle `i` on its road (following it, not coming from elsewhere). */
  private truckBehind(i: number): boolean {
    const dx = this.truckX - this.x[i]!;
    const dz = this.truckZ - this.z[i]!;
    const forwardX = Math.sin(this.heading[i]!);
    const forwardZ = Math.cos(this.heading[i]!);
    return dx * forwardX + dz * forwardZ < 0 && Math.abs(dx * forwardZ - dz * forwardX) < 6;
  }

  /**
   * Where the truck is along the vehicle's path: the gap to it if it is in
   * the lane (truckGap), how far along the path it reaches (truckFar) and
   * its leftmost edge relative to the lane's middle (truckMinLeft).
   */
  private scanTruck(i: number, lookAhead: number): void {
    this.truckGap = Infinity;
    this.truckFar = -Infinity;
    this.truckMinLeft = Infinity;
    const reach = lookAhead + this.truckReach + 10;
    const toTruckX = this.truckX - this.x[i]!;
    const toTruckZ = this.truckZ - this.z[i]!;
    if (this.truckCircleCount === 0 || toTruckX * toTruckX + toTruckZ * toTruckZ > reach * reach) {
      return;
    }
    const graph = this.graph;
    const half = this.halfLength[i]!;
    const radius = this.truckRadius;
    const blocking = this.halfWidth[i]! + radius + LATERAL_MARGIN_METERS;
    let link = this.link[i]!;
    let offset = -this.s[i]!;
    for (let step = 0; step < 3 && link >= 0; step++) {
      const first = graph.pointStart[link]!;
      const last = graph.pointStart[link + 1]! - 1;
      for (let k = step === 0 ? first + this.segment[i]! : first; k < last; k++) {
        const start = offset + graph.along[k]!;
        if (start > lookAhead) {
          return;
        }
        const ax = graph.pointX[k]!;
        const az = graph.pointZ[k]!;
        const sx = graph.pointX[k + 1]! - ax;
        const sz = graph.pointZ[k + 1]! - az;
        const lengthSquared = sx * sx + sz * sz;
        if (lengthSquared < 1e-9) {
          continue;
        }
        const length = Math.sqrt(lengthSquared);
        for (let c = 0; c < this.truckCircleCount; c++) {
          const px = this.truckCircleX[c]! - ax;
          const pz = this.truckCircleZ[c]! - az;
          const t = (px * sx + pz * sz) / lengthSquared;
          if (t < -0.1 || t > 1.1) {
            continue;
          }
          const along = start + Math.max(0, Math.min(1, t)) * length;
          if (along < -half - radius) {
            continue;
          }
          const lateral = (pz * sx - px * sz) / length;
          this.truckFar = Math.max(this.truckFar, along + radius);
          this.truckMinLeft = Math.min(this.truckMinLeft, lateral - radius);
          if (Math.abs(lateral) < blocking) {
            this.truckGap = Math.min(this.truckGap, along - half - radius);
          }
        }
      }
      offset += graph.length[link]!;
      link = step === 0 ? this.next[i]! : this.after[i]!;
    }
  }

  /** On a two-lane road: pull out to pass a slower vehicle, and back in once past. */
  private considerLaneChange(i: number, dt: number): void {
    this.laneTimer[i]! -= dt;
    if (this.laneTimer[i]! > 0) {
      return;
    }
    this.laneTimer[i] = LANE_CHANGE_INTERVAL_SECONDS;
    const graph = this.graph;
    const link = this.link[i]!;
    const other = graph.parallel[link]!;
    if (other < 0 || this.avoidUntil[i]! >= 0 || Math.abs(this.lateral[i]!) > 0.5 || this.holding[i]! >= 0) {
      return;
    }
    if (graph.laneIndex[link] === 0) {
      const toEnd = graph.length[link]! - this.s[i]!;
      const slowAhead =
        this.leaderKind[i] !== NO_LEADER &&
        this.leaderKind[i] !== STOP_LINE_LEADER &&
        this.leaderGap[i]! < 60 &&
        this.leaderSpeed[i]! < this.cruiseSpeed(i) * 0.85;
      if (toEnd > LANE_CHANGE_END_CLEARANCE_METERS && slowAhead && this.laneClear(i, other, 30, 50)) {
        this.changeLane(i, other);
      }
    } else if (this.laneClear(i, other, 20, 40)) {
      this.changeLane(i, other);
    }
  }

  /** No vehicle and no part of the truck within `behind` meters behind and `ahead` meters ahead in `lane`. */
  private laneClear(i: number, lane: number, behind: number, ahead: number): boolean {
    const graph = this.graph;
    const here = this.centre[i]!;
    for (let j = 0; j < this.capacity; j++) {
      if (j === i || this.active[j] !== 1 || (this.link[j] !== lane && this.changeFrom[j] !== lane)) {
        continue;
      }
      const offset = this.centre[j]! - here;
      if (offset > -behind - this.halfLength[j]! && offset < ahead + this.halfLength[j]!) {
        return false;
      }
    }
    const s = graph.mapAcross(this.link[i]!, this.s[i]!, lane);
    this.pointAt(lane, s);
    const heading = this.heading[i]!;
    const forwardX = Math.sin(heading);
    const forwardZ = Math.cos(heading);
    const room = graph.laneWidth[lane]! / 2 + this.truckRadius + LATERAL_MARGIN_METERS;
    for (let c = 0; c < this.truckCircleCount; c++) {
      const dx = this.truckCircleX[c]! - this.pointXOut;
      const dz = this.truckCircleZ[c]! - this.pointZOut;
      const along = dx * forwardX + dz * forwardZ;
      const across = dx * forwardZ - dz * forwardX;
      if (along > -behind - this.truckRadius && along < ahead + this.truckRadius && Math.abs(across) < room) {
        return false;
      }
    }
    return true;
  }

  private changeLane(i: number, lane: number): void {
    const graph = this.graph;
    const from = this.link[i]!;
    this.release(i);
    this.s[i] = graph.mapAcross(from, this.s[i]!, lane);
    this.link[i] = lane;
    this.segment[i] = graph.segmentAt(lane, this.s[i]!);
    // Still where it was: the new lane's middle is that far to one side, and it glides over.
    this.lateral[i]! += graph.laneOffset[from]! - graph.laneOffset[lane]!;
    this.changeFrom[i] = from;
    this.next[i] = this.choose(lane);
    this.after[i] = this.next[i]! >= 0 ? this.choose(this.next[i]!) : -1;
  }

  /**
   * Stuck behind the truck standing in its lane: once it has waited, the
   * vehicle drives round through the other lane, if the truck leaves room
   * and nothing is coming. It pulls back in past the truck.
   */
  private considerAvoid(i: number): void {
    const graph = this.graph;
    const link = this.link[i]!;
    if (this.avoidUntil[i]! >= 0) {
      if (this.s[i]! >= this.avoidUntil[i]!) {
        this.endAvoid(i);
      }
      return;
    }
    const opposite = graph.opposite[link]!;
    if (
      opposite < 0 ||
      this.leaderKind[i] !== TRUCK_LEADER ||
      this.waitSeconds[i]! < AVOID_WAIT_SECONDS ||
      Math.abs(this.truckSpeed) > 0.5
    ) {
      return;
    }
    const shift = graph.laneOffset[link]! + graph.laneOffset[opposite]!;
    if (this.truckMinLeft < -shift + this.halfWidth[i]! + AVOID_MARGIN_METERS) {
      return; // The truck blocks the other lane too.
    }
    const pass = this.truckFar + this.halfLength[i]! + 6;
    if (graph.length[link]! - this.s[i]! < pass + 20) {
      return; // Not round a corner or into a junction.
    }
    const here = this.centre[i]!;
    for (let j = 0; j < this.capacity; j++) {
      if (this.active[j] === 1 && this.link[j] === opposite) {
        const at = graph.stretchLength[link]! - this.centre[j]!;
        if (at > here - 15 && at < here + pass + AVOID_ONCOMING_CLEARANCE_METERS) {
          return; // Something is coming.
        }
      }
    }
    this.avoidUntil[i] = this.s[i]! + pass;
    this.lateralTarget[i] = -shift;
  }

  private endAvoid(i: number): void {
    this.avoidUntil[i] = -1;
    this.lateralTarget[i] = 0;
  }

  /** Moves vehicle `i` `distance` meters along its path, onto the next links as it passes their ends. */
  private advance(i: number, distance: number): void {
    const graph = this.graph;
    let s = this.s[i]! + distance;
    let link = this.link[i]!;
    while (s > graph.length[link]!) {
      const next = this.next[i]!;
      if (next < 0) {
        this.despawn(i); // The road ends here (a broken map): the vehicle leaves.
        return;
      }
      s -= graph.length[link]!;
      if (this.holding[i] === link) {
        this.release(i);
      }
      if (graph.isTurn(next) && this.holding[i] !== next && this.needsReservation(next)) {
        // Could not stop in time (it appeared close to the junction): it takes the turn all the same.
        this.release(i);
        this.holding[i] = next;
        this.holders[next]!++;
      }
      link = next;
      this.link[i] = link;
      this.next[i] = this.after[i]!;
      this.after[i] = this.next[i]! >= 0 ? this.choose(this.next[i]!) : -1;
      this.changeFrom[i] = -1;
      this.segment[i] = 0;
      if (this.avoidUntil[i]! >= 0) {
        this.endAvoid(i);
      }
    }
    this.s[i] = s;
  }

  /** Puts vehicle `i` where its link and distance say, shifted sideways by any lane change or pass. */
  private updatePose(i: number, dt: number): void {
    const graph = this.graph;
    const link = this.link[i]!;
    const s = this.s[i]!;
    const length = graph.length[link]!;
    this.segment[i] = graph.segmentAt(link, s);
    this.pointAt(link, Math.max(0, s - HEADING_SPAN_METERS));
    const backX = this.pointXOut;
    const backZ = this.pointZOut;
    this.pointAt(link, Math.min(length, s + HEADING_SPAN_METERS));
    let pathHeading = Math.atan2(this.pointXOut - backX, this.pointZOut - backZ);
    this.pointAt(link, s);

    const lateral = this.lateral[i]!;
    const lateralSpeed =
      dt > 0 ? clamp((this.lateralTarget[i]! - lateral) * LANE_CHANGE_RATE, -LANE_CHANGE_MAX_SPEED, LANE_CHANGE_MAX_SPEED) : 0;
    const shifted = lateral + lateralSpeed * dt;
    this.lateral[i] = shifted;
    if (this.changeFrom[i]! >= 0 && Math.abs(shifted) < 1) {
      this.changeFrom[i] = -1;
    }
    // Moving right (positive lateral speed) turns the nose right, which lowers the heading.
    pathHeading -= Math.atan2(lateralSpeed, Math.max(2, this.speed[i]!));
    const rightX = -Math.cos(pathHeading);
    const rightZ = Math.sin(pathHeading);
    this.x[i] = this.pointXOut + rightX * shifted;
    this.z[i] = this.pointZOut + rightZ * shifted;
    // Keep headings continuous (never wrapped), so rendering can interpolate them.
    const previous = this.heading[i]!;
    let turn = pathHeading - previous;
    turn -= Math.round(turn / (2 * Math.PI)) * 2 * Math.PI;
    this.heading[i] = dt > 0 ? previous + turn : pathHeading;
    this.centre[i] = graph.isTurn(link) ? s : graph.centreAt(link, s);
  }

  /** Writes the point `s` meters along `link` into pointXOut / pointZOut. */
  private pointAt(link: number, s: number): void {
    const graph = this.graph;
    const k = graph.pointStart[link]! + graph.segmentAt(link, s);
    const span = graph.along[k + 1]! - graph.along[k]!;
    const t = span > 0 ? clamp((s - graph.along[k]!) / span, 0, 1) : 0;
    this.pointXOut = graph.pointX[k]! + (graph.pointX[k + 1]! - graph.pointX[k]!) * t;
    this.pointZOut = graph.pointZ[k]! + (graph.pointZ[k + 1]! - graph.pointZ[k]!) * t;
  }

  /** Collision circles along every vehicle, like the truck's footprint. */
  private writeCircles(): void {
    let count = 0;
    for (let i = 0; i < this.capacity; i++) {
      if (this.active[i] !== 1) {
        continue;
      }
      const radius = this.halfWidth[i]!;
      const reach = Math.max(0, this.halfLength[i]! - radius);
      const circles = Math.min(MAX_CIRCLES_PER_VEHICLE, Math.max(2, Math.ceil(this.halfLength[i]! / radius)));
      const sin = Math.sin(this.heading[i]!);
      const cos = Math.cos(this.heading[i]!);
      const speed = this.speed[i]!;
      for (let c = 0; c < circles; c++) {
        const offset = -reach + (2 * reach * c) / (circles - 1);
        this.circleX[count] = this.x[i]! + sin * offset;
        this.circleZ[count] = this.z[i]! + cos * offset;
        this.circleRadius[count] = radius;
        this.circleVelocityX[count] = sin * speed;
        this.circleVelocityZ[count] = cos * speed;
        this.circleOwner[count] = i;
        count++;
      }
    }
    this.circles = count;
  }
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/**
 * The Intelligent Driver Model's acceleration: towards `desired` speed on a
 * free road (the improved form, which brakes gently when above it), and
 * braking to keep a safe gap behind a leader `gap` meters ahead moving at
 * `leaderSpeed`. Never harder than an emergency stop.
 */
export function idmAcceleration(
  speed: number,
  desired: number,
  gap: number,
  leaderSpeed: number,
  maxAcceleration: number,
): number {
  let free: number;
  if (speed <= desired) {
    const ratio = speed / desired;
    free = maxAcceleration * (1 - ratio * ratio * ratio * ratio);
  } else {
    free = -COMFORTABLE_DECELERATION * (1 - Math.pow(desired / speed, (maxAcceleration * 4) / COMFORTABLE_DECELERATION));
  }
  if (!(gap < Infinity)) {
    return free;
  }
  const closing = speed - leaderSpeed;
  const wanted =
    MIN_GAP_METERS +
    Math.max(0, speed * HEADWAY_SECONDS + (speed * closing) / (2 * Math.sqrt(maxAcceleration * COMFORTABLE_DECELERATION)));
  const ratio = wanted / Math.max(gap, 0.1);
  return Math.max(-EMERGENCY_DECELERATION, Math.min(maxAcceleration, free - maxAcceleration * ratio * ratio));
}

/**
 * A convoy contract's trucks (MissionDefinition.variant 'convoy'): from the
 * pickup they follow the player's truck along the very way it drove, their
 * middles this far behind its rear axle, meters (room for a semi-trailer).
 */
export const CONVOY_FOLLOW_GAPS = [24, 46] as const;
/** At this speed or under, km/h, the whole convoy keeps up… */
export const CONVOY_SPEED_KMH = 70;
/**
 * …as each goes no faster than this, m/s (74 and 70 km/h): driven faster,
 * the truck leaves them behind, the last one first. They catch up again when
 * it slows.
 */
export const CONVOY_TOP_SPEEDS = [(CONVOY_SPEED_KMH + 4) / 3.6, CONVOY_SPEED_KMH / 3.6] as const;
/** One this far behind its place is falling behind: time to slow down, meters. */
export const CONVOY_LAGGING_METERS = 90;
/** One this far behind its place is lost to the convoy, meters: it drives on alone, and earns no bonus. */
export const CONVOY_LOST_METERS = 250;
/** The way is kept as a point at least every this many meters… */
const TRAIL_STEP_METERS = 1;
/** …this many of them: more than the last one's place and the distance it is lost at. */
const TRAIL_POINTS = 512;
/** The truck went this far in one step: it was put somewhere else (the ferry, a recovery), and the convoy forms again behind it. */
const JUMP_METERS = 30;

/**
 * The convoy behind the truck: the way the truck drove forward (a ring of
 * points with the distance driven at each), and how far along it each
 * follower has got, at most its top speed (CONVOY_TOP_SPEEDS).
 *
 * The way starts where the convoy forms (the pickup's bay): a follower pulls
 * out onto it once the truck is its gap ahead, and is drawn from then on
 * (`shown`). Backing up takes back the points the truck backs past, and the
 * followers back up with it; driving forward again, the way grows only
 * once its newest point is behind the truck, so turning about in a yard
 * leaves no loop for them to drive. One that falls CONVOY_LOST_METERS behind
 * its place is lost (`present` 0) for the rest of the contract.
 *
 * Where each one is (`vehicleX`, `vehicleZ`, `vehicleHeading`: its middle,
 * facing along the way) is worked out after each step. Allocation-free
 * after it is made. Not saved beyond how many were lost: a contract taken up
 * again from a save forms its convoy afresh behind the truck.
 */
export class ConvoyTrail {
  readonly vehicleX: Float64Array;
  readonly vehicleZ: Float64Array;
  readonly vehicleHeading: Float64Array;
  /** 1 while a follower is with the convoy, 0 once it is lost. */
  readonly present: Uint8Array;
  /** 1 while a follower is on the road behind the truck, to be drawn: with the convoy, and pulled out behind it. */
  readonly shown: Uint8Array;
  private readonly trailX = new Float64Array(TRAIL_POINTS);
  private readonly trailZ = new Float64Array(TRAIL_POINTS);
  private readonly trailS = new Float64Array(TRAIL_POINTS);
  /** The newest point's index, and how many there are. */
  private head = 0;
  private count = 0;
  /** Each follower's distance along the way, meters. */
  private readonly followerS: Float64Array;
  /** The truck at the last step: a jump from there re-forms the convoy. */
  private truckX = 0;
  private truckZ = 0;
  /** The truck's distance along the way at the last step, meters. */
  private leadS = 0;

  /** A convoy forming at a truck at (x, z), the last `lost` of its trucks already lost (from a saved game). */
  constructor(x: number, z: number, lost = 0) {
    const trucks = CONVOY_FOLLOW_GAPS.length;
    this.vehicleX = new Float64Array(trucks);
    this.vehicleZ = new Float64Array(trucks);
    this.vehicleHeading = new Float64Array(trucks);
    this.present = new Uint8Array(trucks);
    for (let i = 0; i < trucks; i++) {
      this.present[i] = i < trucks - lost ? 1 : 0;
    }
    this.shown = new Uint8Array(trucks);
    this.followerS = new Float64Array(trucks);
    this.restart(x, z);
  }

  /** How many trucks the convoy has when none is lost. */
  get size(): number {
    return CONVOY_FOLLOW_GAPS.length;
  }

  /** How many followers are still with the convoy. */
  get trucksWithConvoy(): number {
    let count = 0;
    for (let i = 0; i < this.present.length; i++) {
      count += this.present[i]!;
    }
    return count;
  }

  /** One of those on the road is CONVOY_LAGGING_METERS or more behind its place. */
  get lagging(): boolean {
    const lead = this.leadS;
    for (let i = 0; i < this.followerS.length; i++) {
      if (this.shown[i] === 1 && lead - CONVOY_FOLLOW_GAPS[i]! - this.followerS[i]! >= CONVOY_LAGGING_METERS) {
        return true;
      }
    }
    return false;
  }

  /**
   * `seconds` on, the truck's rear axle at (x, z) facing `heading`: the way
   * grows or is taken back, and the followers move up to their places along
   * it, each no faster than its top speed. Returns the index of a follower
   * lost in this step, or -1.
   */
  step(seconds: number, x: number, z: number, heading: number): number {
    const jumpX = x - this.truckX;
    const jumpZ = z - this.truckZ;
    this.truckX = x;
    this.truckZ = z;
    if (jumpX * jumpX + jumpZ * jumpZ > JUMP_METERS * JUMP_METERS) {
      this.restart(x, z);
      return -1;
    }
    const forwardX = Math.sin(heading);
    const forwardZ = Math.cos(heading);
    // Backing along the way: the points it backs past are taken back.
    while (this.count > 1) {
      const headX = this.trailX[this.head]!;
      const headZ = this.trailZ[this.head]!;
      const before = (this.head - 1 + TRAIL_POINTS) % TRAIL_POINTS;
      const beforeX = this.trailX[before]! - x;
      const beforeZ = this.trailZ[before]! - z;
      const aheadOfTruck = (headX - x) * forwardX + (headZ - z) * forwardZ > 0;
      const headDistance = (headX - x) * (headX - x) + (headZ - z) * (headZ - z);
      if (!aheadOfTruck || beforeX * beforeX + beforeZ * beforeZ >= headDistance) {
        break;
      }
      this.head = before;
      this.count--;
    }
    // Forward past the newest point: the way grows.
    const dx = x - this.trailX[this.head]!;
    const dz = z - this.trailZ[this.head]!;
    const past = dx * forwardX + dz * forwardZ > 0 ? Math.sqrt(dx * dx + dz * dz) : 0;
    if (past >= TRAIL_STEP_METERS) {
      this.push(x, z, this.trailS[this.head]! + past);
    }
    // The truck itself: up to a step on from the newest point.
    const lead = this.trailS[this.head]! + (past >= TRAIL_STEP_METERS ? 0 : past);
    this.leadS = lead;
    const start = this.trailS[this.oldest]!;
    let lost = -1;
    for (let i = 0; i < this.followerS.length; i++) {
      if (this.present[i] === 0) {
        continue;
      }
      const place = lead - CONVOY_FOLLOW_GAPS[i]!;
      if (place < start) {
        // Not pulled out yet, or backed up into the yard again.
        this.shown[i] = 0;
        this.followerS[i] = start;
        continue;
      }
      this.shown[i] = 1;
      const s = this.followerS[i]!;
      // Up to its place, or back to it when the truck backs up.
      this.followerS[i] = place < s ? place : s + Math.min(place - s, CONVOY_TOP_SPEEDS[i]! * Math.max(0, seconds));
      if (place - this.followerS[i]! > CONVOY_LOST_METERS) {
        this.present[i] = 0;
        this.shown[i] = 0;
        lost = i;
      }
    }
    this.place();
    return lost;
  }

  /** The oldest point's index. */
  private get oldest(): number {
    return (this.head - this.count + 1 + TRAIL_POINTS) % TRAIL_POINTS;
  }

  /** The way begins again at the truck: the followers pull out behind it as it drives off. */
  private restart(x: number, z: number): void {
    this.head = 0;
    this.count = 0;
    this.truckX = x;
    this.truckZ = z;
    this.push(x, z, 0);
    this.leadS = 0;
    this.followerS.fill(0);
    this.shown.fill(0);
    this.place();
  }

  private push(x: number, z: number, s: number): void {
    this.head = this.count === 0 ? 0 : (this.head + 1) % TRAIL_POINTS;
    this.trailX[this.head] = x;
    this.trailZ[this.head] = z;
    this.trailS[this.head] = s;
    this.count = Math.min(TRAIL_POINTS, this.count + 1);
  }

  /** Each follower where its distance along the way puts it, facing along the way. */
  private place(): void {
    for (let i = 0; i < this.followerS.length; i++) {
      const s = this.followerS[i]!;
      // From the newest point back to the first one at or before `s`.
      let newer = this.head;
      let older = this.head;
      for (let k = 1; k < this.count; k++) {
        older = (this.head - k + TRAIL_POINTS) % TRAIL_POINTS;
        if (this.trailS[older]! <= s) {
          break;
        }
        newer = older;
      }
      const span = this.trailS[newer]! - this.trailS[older]!;
      const t = span > 1e-9 ? Math.min(1, Math.max(0, (s - this.trailS[older]!) / span)) : 1;
      const ax = this.trailX[older]!;
      const az = this.trailZ[older]!;
      const bx = this.trailX[newer]!;
      const bz = this.trailZ[newer]!;
      this.vehicleX[i] = ax + (bx - ax) * t;
      this.vehicleZ[i] = az + (bz - az) * t;
      if (bx !== ax || bz !== az) {
        this.vehicleHeading[i] = Math.atan2(bx - ax, bz - az);
      }
    }
  }
}

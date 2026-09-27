import {
  isInSea,
  rectangleContains,
  rectangleCorners,
  type Point2,
  type RectangleDefinition,
} from '../../data/definitions/MapDefinition';
import { Buckets } from './buckets';
import { distanceToForestEdge, forestContains, type Forest } from './forests';
import type { RiverPath } from './RiverPath';

/** Something standing on a point: a turbine's tower, a name board, a bridge's middle. */
interface Spot {
  readonly x: number;
  readonly z: number;
}

/** A building's footprint. */
interface Box {
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

/** What a map holds before its side roads grow (DrivingWorld's parts): what they keep clear of. */
export interface LandParts {
  readonly halfSizeMeters: number;
  readonly shoreline: readonly Point2[] | null;
  readonly rivers: readonly RiverPath[];
  readonly forests: readonly Forest[];
  readonly parks: readonly { readonly area: RectangleDefinition }[];
  readonly fields: readonly { readonly area: RectangleDefinition }[];
  /** The depot yards and the rest area lots. */
  readonly yards: readonly RectangleDefinition[];
  readonly buildings: readonly Box[];
  readonly windTurbines: readonly Spot[];
  readonly citySigns: readonly Spot[];
  readonly bridges: readonly Spot[];
}

/** How far a new thing keeps from each kind of thing already there, meters (the water and the woods: from their edge). */
interface Keep {
  readonly shore: number;
  readonly river: number;
  readonly forest: number;
  readonly park: number;
  readonly field: number;
  readonly yard: number;
  readonly building: number;
  readonly turbine: number;
  readonly sign: number;
  /** From the map's edge. */
  readonly edge: number;
}

/**
 * A new road's centreline: clear of the water (the rivers' as far as their
 * channels are looked up), the woods, the parks, the fields (the edge of the
 * widest, a village's street, 8 m and more off theirs), the yards and lots,
 * the buildings, the turbines (60 m and more from its edge) and the name
 * boards. Not of where the truck starts: that moves (?spawn), and what grows
 * must not move with it.
 */
const ROAD: Keep = {
  shore: 50,
  river: 28,
  forest: 12,
  park: 40,
  field: 12.5,
  yard: 40,
  building: 18,
  turbine: 75,
  sign: 45,
  edge: 80,
};
/** A building's footprint (or a park's): the turbines stand 80 m and more from its middle, the fields 5 m and more from its walls. */
const BUILDING: Keep = {
  shore: 20,
  river: 10,
  forest: 6,
  park: 10,
  field: 6,
  yard: 12,
  building: 5,
  turbine: 90,
  sign: 15,
  edge: 20,
};
/** A field: 10 m and more from the turbines, 5 m and more from the buildings, apart from the other fields. */
const FIELD: Keep = {
  shore: 20,
  river: 6,
  forest: 5,
  park: 10,
  field: 4,
  yard: 8,
  building: 6,
  turbine: 12,
  sign: 12,
  edge: 15,
};
/** Roads meet this far from the bridges (80 m and more), the name boards (40 m and more), the yards and lots. */
const JOIN_BRIDGE_CLEARANCE = 110;
const JOIN_SIGN_CLEARANCE = 70;
const JOIN_YARD_CLEARANCE = 80;
/** A rectangle's rim is looked at every this many meters. */
const RIM_SPACING_METERS = 2;
/** Things are filed in cells this big, grown by the furthest any question looks from each kind. */
const BUCKET_METERS = 100;
const REACH = {
  field: Math.max(ROAD.field, BUILDING.field, FIELD.field),
  park: Math.max(ROAD.park, BUILDING.park, FIELD.park),
  yard: Math.max(ROAD.yard, BUILDING.yard, FIELD.yard, JOIN_YARD_CLEARANCE),
  building: Math.max(ROAD.building, BUILDING.building, FIELD.building),
  turbine: Math.max(ROAD.turbine, BUILDING.turbine, FIELD.turbine),
  sign: Math.max(ROAD.sign, BUILDING.sign, FIELD.sign),
  forest: Math.max(ROAD.forest, BUILDING.forest, FIELD.forest),
} as const;

/**
 * Where what grows on a map's land (its villages and side roads, with their
 * buildings, fields and greens: CountryPlan) may go: on open land, clear of
 * whatever the map holds already by enough that the new roads, buildings
 * and fields keep the same distances the map's own do (the content tests
 * check them). The roads are CountryPlan's own business.
 */
export class OpenLand {
  readonly halfSizeMeters: number;
  private readonly fields: Buckets;
  private readonly parks: Buckets;
  private readonly yards: Buckets;
  private readonly buildings: Buckets;
  private readonly turbines: Buckets;
  private readonly signs: Buckets;
  private readonly forests: Buckets;

  constructor(private readonly parts: LandParts) {
    this.halfSizeMeters = parts.halfSizeMeters;
    const half = parts.halfSizeMeters;
    this.fields = new Buckets(BUCKET_METERS, half);
    this.parks = new Buckets(BUCKET_METERS, half);
    this.yards = new Buckets(BUCKET_METERS, half);
    this.buildings = new Buckets(BUCKET_METERS, half);
    this.turbines = new Buckets(BUCKET_METERS, half);
    this.signs = new Buckets(BUCKET_METERS, half);
    this.forests = new Buckets(BUCKET_METERS, half);
    const fileRectangle = (buckets: Buckets, id: number, area: RectangleDefinition, reach: number): void => {
      const corners = rectangleCorners(area);
      const xs = corners.map(([x]) => x);
      const zs = corners.map(([, z]) => z);
      buckets.add(id, Math.min(...xs) - reach, Math.max(...xs) + reach, Math.min(...zs) - reach, Math.max(...zs) + reach);
    };
    parts.fields.forEach((field, id) => fileRectangle(this.fields, id, field.area, REACH.field));
    parts.parks.forEach((park, id) => fileRectangle(this.parks, id, park.area, REACH.park));
    parts.yards.forEach((yard, id) => fileRectangle(this.yards, id, yard, REACH.yard));
    parts.buildings.forEach((box, id) =>
      this.buildings.add(id, box.minX - REACH.building, box.maxX + REACH.building, box.minZ - REACH.building, box.maxZ + REACH.building),
    );
    parts.windTurbines.forEach(({ x, z }, id) => this.turbines.add(id, x - REACH.turbine, x + REACH.turbine, z - REACH.turbine, z + REACH.turbine));
    parts.citySigns.forEach(({ x, z }, id) => this.signs.add(id, x - REACH.sign, x + REACH.sign, z - REACH.sign, z + REACH.sign));
    parts.forests.forEach((forest, id) =>
      this.forests.add(id, forest.minX - REACH.forest, forest.maxX + REACH.forest, forest.minZ - REACH.forest, forest.maxZ + REACH.forest),
    );
  }

  /** Whether a new road's centreline may pass (x, z). */
  isOpenForRoad(x: number, z: number): boolean {
    return this.isOpen(x, z, ROAD);
  }

  /** Whether roads may meet at (x, z): clear of the bridges, the name boards, the yards and lots. */
  canJoinAt(x: number, z: number): boolean {
    const { bridges, citySigns, yards } = this.parts;
    return (
      bridges.every((bridge) => Math.hypot(x - bridge.x, z - bridge.z) >= JOIN_BRIDGE_CLEARANCE) &&
      citySigns.every((sign) => Math.hypot(x - sign.x, z - sign.z) >= JOIN_SIGN_CLEARANCE) &&
      this.yards.at(x, z).every((id) => !rectangleContains(yards[id]!, x, z, JOIN_YARD_CLEARANCE))
    );
  }

  /** Whether a building may stand on `area`. */
  isOpenForBuilding(area: RectangleDefinition): boolean {
    return this.isOpenArea(area, BUILDING);
  }

  /** Whether a field may lie on `area`. */
  isOpenForField(area: RectangleDefinition): boolean {
    return this.isOpenArea(area, FIELD);
  }

  /** Whether all of `area` (its rim and middle) is open, and nothing already there stands inside it. */
  private isOpenArea(area: RectangleDefinition, keep: Keep): boolean {
    const { parts } = this;
    const inside = (x: number, z: number, margin: number): boolean => rectangleContains(area, x, z, margin);
    if (
      parts.windTurbines.some((turbine) => inside(turbine.x, turbine.z, keep.turbine)) ||
      parts.citySigns.some((sign) => inside(sign.x, sign.z, keep.sign)) ||
      parts.buildings.some((box) => inside((box.minX + box.maxX) / 2, (box.minZ + box.maxZ) / 2, keep.building)) ||
      parts.fields.some((field) => rectangleCorners(field.area).some(([x, z]) => inside(x, z, keep.field))) ||
      parts.parks.some((park) => rectangleCorners(park.area).some(([x, z]) => inside(x, z, keep.park))) ||
      parts.yards.some((yard) => rectangleCorners(yard).some(([x, z]) => inside(x, z, keep.yard))) ||
      parts.forests.some((forest) => forest.outline.some(([x, z]) => inside(x, z, keep.forest)))
    ) {
      return false;
    }
    if (!this.isOpen(area.x, area.z, keep)) {
      return false;
    }
    const corners = rectangleCorners(area);
    return corners.every(([ax, az], index) => {
      const [bx, bz] = corners[(index + 1) % corners.length]!;
      const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / RIM_SPACING_METERS));
      for (let step = 0; step < steps; step++) {
        if (!this.isOpen(ax + ((bx - ax) * step) / steps, az + ((bz - az) * step) / steps, keep)) {
          return false;
        }
      }
      return true;
    });
  }

  /** Whether (x, z) keeps `keep`'s distances from everything. */
  private isOpen(x: number, z: number, keep: Keep): boolean {
    const { parts } = this;
    const limit = parts.halfSizeMeters - keep.edge;
    if (Math.abs(x) > limit || Math.abs(z) > limit) {
      return false;
    }
    if (parts.shoreline !== null && isInSea(parts.shoreline, x, z, keep.shore)) {
      return false;
    }
    for (const id of this.turbines.at(x, z)) {
      const turbine = parts.windTurbines[id]!;
      if (Math.hypot(x - turbine.x, z - turbine.z) < keep.turbine) {
        return false;
      }
    }
    for (const id of this.signs.at(x, z)) {
      const sign = parts.citySigns[id]!;
      if (Math.hypot(x - sign.x, z - sign.z) < keep.sign) {
        return false;
      }
    }
    for (const id of this.fields.at(x, z)) {
      if (rectangleContains(parts.fields[id]!.area, x, z, keep.field)) {
        return false;
      }
    }
    for (const id of this.parks.at(x, z)) {
      if (rectangleContains(parts.parks[id]!.area, x, z, keep.park)) {
        return false;
      }
    }
    for (const id of this.yards.at(x, z)) {
      if (rectangleContains(parts.yards[id]!, x, z, keep.yard)) {
        return false;
      }
    }
    for (const id of this.buildings.at(x, z)) {
      const box = parts.buildings[id]!;
      const dx = x - Math.max(box.minX, Math.min(x, box.maxX));
      const dz = z - Math.max(box.minZ, Math.min(z, box.maxZ));
      if (Math.hypot(dx, dz) < keep.building) {
        return false;
      }
    }
    for (const id of this.forests.at(x, z)) {
      const forest = parts.forests[id]!;
      if (forestContains(forest, x, z) || distanceToForestEdge(forest, x, z) < keep.forest) {
        return false;
      }
    }
    return !parts.rivers.some((river) => river.contains(x, z, keep.river));
  }
}

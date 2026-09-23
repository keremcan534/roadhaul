import {
  BoxGeometry,
  BufferAttribute,
  Color,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PlaneGeometry,
  type BufferGeometry,
  type Scene,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { RectangleDefinition, RestAreaDefinition } from '../../data/definitions/MapDefinition';
import type { DrivingWorld } from '../../domain/world/DrivingWorld';
import { concreteImage } from '../textures/proceduralImages';
import { toTexture } from '../textures/toTexture';
import { pavedRectangle, placeFlat } from './groundDecals';
import { flatGroundLight } from './lighting';

/** The lot lies like a depot yard: over the grass and shoulders, under the asphalt (see TrackView). */
const LOT_Y = 0.02;
const LINE_Y = 0.07;
const LINE_WIDTH = 0.18;
const CONCRETE_TILE_METERS = 12;
/** The fuel canopy: how deep (across the lot), how long (along it), and the height of its underside. */
const CANOPY_DEPTH = 12;
const CANOPY_LENGTH = 30;
const CANOPY_CLEARANCE = 6.3;
/** Truck parking stalls along the back of the lot, beside the canopy. */
const STALL_WIDTH = 5;
const STALL_DEPTH = 18;

const ROOF_COLOR = 0xecedef;
const FASCIA_COLOR = 0xf2b233;
const POST_COLOR = 0xc3c8ce;
const ISLAND_COLOR = 0x9b9d9f;
const PUMP_COLOR = 0xe2e5e9;
const PUMP_PANEL_COLOR = 0xd33a2c;
const SCREEN_COLOR = 0x1f262e;

export interface RestAreaViewOptions {
  /** Texture anisotropy for the concrete (renderer capability). */
  readonly anisotropy?: number;
}

/**
 * Draws the rest areas (spec §25): a concrete lot with parking stalls along
 * its back, and a fuel canopy with pump islands and a price sign. The canopy
 * stands in the back half, clear of a truck parked in the middle of the lot.
 * All rest areas together cost three draw calls. The pumps and posts are
 * scenery: they do not stop the truck.
 */
export class RestAreaView {
  private readonly root = new Group();
  private readonly resources: { dispose(): void }[] = [];

  constructor(
    private readonly scene: Scene,
    world: DrivingWorld,
    options: RestAreaViewOptions = {},
  ) {
    const restAreas = world.restAreas;
    if (restAreas.length > 0) {
      const groundLight = flatGroundLight();
      const concrete = this.track(toTexture(concreteImage(), { repeat: true, anisotropy: options.anisotropy ?? 1 }));
      const backs = restAreas.map((restArea) => backSide(restArea, world));
      this.root.add(
        new Mesh(
          this.merged(restAreas.map((restArea) => pavedRectangle(restArea.lot, CONCRETE_TILE_METERS, LOT_Y))),
          this.track(
            new MeshBasicMaterial({
              map: concrete,
              color: new Color(0xffffff).multiply(groundLight),
              polygonOffset: true,
              polygonOffsetFactor: -1,
              polygonOffsetUnits: -3,
            }),
          ),
        ),
        new Mesh(
          this.merged(restAreas.flatMap((restArea, index) => stallLines(restArea.lot, backs[index]!))),
          this.track(
            new MeshBasicMaterial({
              color: new Color(0xf4f3ec).multiply(groundLight),
              polygonOffset: true,
              polygonOffsetFactor: -1,
              polygonOffsetUnits: -6,
            }),
          ),
        ),
        new Mesh(
          this.merged(restAreas.flatMap((restArea, index) => fuelStation(restArea.lot, backs[index]!))),
          this.track(new MeshLambertMaterial({ vertexColors: true })),
        ),
      );
    }
    scene.add(this.root);
  }

  dispose(): void {
    this.scene.remove(this.root);
    for (const resource of this.resources) {
      resource.dispose();
    }
  }

  private merged(parts: BufferGeometry[]): BufferGeometry {
    const geometry = this.track(mergeGeometries(parts));
    for (const part of parts) {
      part.dispose();
    }
    return geometry;
  }

  /** Remembers a GPU resource so dispose() can release it. */
  private track<T extends { dispose(): void }>(resource: T): T {
    this.resources.push(resource);
    return resource;
  }
}

/**
 * Which long side of the lot is its back, away from the road: 1 for the side
 * to the right of its heading, -1 for the left.
 */
function backSide(restArea: RestAreaDefinition, world: DrivingWorld): 1 | -1 {
  const { lot } = restArea;
  const heading = (lot.headingDegrees * Math.PI) / 180;
  const reach = lot.widthMeters / 2;
  const roadDistance = (side: 1 | -1): number => {
    const x = lot.x + Math.cos(heading) * reach * side;
    const z = lot.z - Math.sin(heading) * reach * side;
    return Math.min(...world.roads.map((road) => road.distanceTo(x, z)));
  };
  return roadDistance(1) >= roadDistance(-1) ? 1 : -1;
}

/** A point `along` meters along the lot and `across` meters toward its back, in world coordinates. */
function lotPoint(lot: RectangleDefinition, back: 1 | -1, along: number, across: number): [number, number] {
  const heading = (lot.headingDegrees * Math.PI) / 180;
  return [
    lot.x + Math.sin(heading) * along + Math.cos(heading) * across * back,
    lot.z + Math.cos(heading) * along - Math.sin(heading) * across * back,
  ];
}

/** A box `alongSize` long (along the lot), `acrossSize` deep and `height` tall, standing on `bottom`. */
function lotBox(
  lot: RectangleDefinition,
  back: 1 | -1,
  size: { along: number; across: number; height: number },
  at: { along: number; across: number; bottom: number },
  color: number,
): BufferGeometry {
  const [x, z] = lotPoint(lot, back, at.along, at.across);
  const geometry = new BoxGeometry(size.across, size.height, size.along)
    .rotateY((lot.headingDegrees * Math.PI) / 180)
    .translate(x, at.bottom + size.height / 2, z);
  return colored(geometry, color);
}

/** Stall lines along the back of the lot, beside the canopy (at its far end, along the heading). */
function stallLines(lot: RectangleDefinition, back: 1 | -1): BufferGeometry[] {
  const lines: BufferGeometry[] = [];
  const backEdge = lot.widthMeters / 2 - 0.5;
  const start = -lot.lengthMeters / 2 + CANOPY_LENGTH + 6;
  for (let along = start; along <= lot.lengthMeters / 2 - 2; along += STALL_WIDTH) {
    const [x, z] = lotPoint(lot, back, along, backEdge - STALL_DEPTH / 2);
    lines.push(
      placeFlat(
        new PlaneGeometry(STALL_DEPTH, LINE_WIDTH),
        { x, z, headingDegrees: lot.headingDegrees, lengthMeters: LINE_WIDTH, widthMeters: STALL_DEPTH },
        LINE_Y,
      ),
    );
  }
  return lines;
}

/** The canopy on four posts over three pump islands, and a price sign by the road. */
function fuelStation(lot: RectangleDefinition, back: 1 | -1): BufferGeometry[] {
  const centreAlong = -lot.lengthMeters / 2 + CANOPY_LENGTH / 2 + 3;
  const centreAcross = lot.widthMeters / 2 - 1 - CANOPY_DEPTH / 2;
  const parts: BufferGeometry[] = [
    lotBox(
      lot,
      back,
      { along: CANOPY_LENGTH, across: CANOPY_DEPTH, height: 0.5 },
      { along: centreAlong, across: centreAcross, bottom: CANOPY_CLEARANCE + 0.35 },
      ROOF_COLOR,
    ),
    lotBox(
      lot,
      back,
      { along: CANOPY_LENGTH + 0.2, across: CANOPY_DEPTH + 0.2, height: 0.4 },
      { along: centreAlong, across: centreAcross, bottom: CANOPY_CLEARANCE },
      FASCIA_COLOR,
    ),
  ];
  for (const along of [-1, 1]) {
    for (const across of [-1, 1]) {
      parts.push(
        lotBox(
          lot,
          back,
          { along: 0.45, across: 0.45, height: CANOPY_CLEARANCE },
          { along: centreAlong + along * (CANOPY_LENGTH / 2 - 1.5), across: centreAcross + across * (CANOPY_DEPTH / 2 - 1), bottom: 0 },
          POST_COLOR,
        ),
      );
    }
  }
  for (const along of [-9, 0, 9]) {
    const at = { along: centreAlong + along, across: centreAcross };
    parts.push(
      lotBox(lot, back, { along: 1.4, across: 5, height: 0.22 }, { ...at, bottom: 0 }, ISLAND_COLOR),
      lotBox(lot, back, { along: 0.7, across: 1, height: 1.8 }, { ...at, bottom: 0.22 }, PUMP_COLOR),
      lotBox(lot, back, { along: 0.74, across: 1.04, height: 0.35 }, { ...at, bottom: 1.6 }, PUMP_PANEL_COLOR),
      lotBox(lot, back, { along: 0.76, across: 0.6, height: 0.4 }, { ...at, bottom: 1.05 }, SCREEN_COLOR),
    );
  }
  // The price sign on a pole at the road end of the canopy.
  const sign = { along: -lot.lengthMeters / 2 + 1.5, across: -lot.widthMeters / 2 + 2 };
  parts.push(
    lotBox(lot, back, { along: 0.4, across: 0.4, height: 7 }, { ...sign, bottom: 0 }, POST_COLOR),
    lotBox(lot, back, { along: 0.5, across: 2.6, height: 2.6 }, { ...sign, bottom: 7 }, FASCIA_COLOR),
    lotBox(lot, back, { along: 0.56, across: 2.2, height: 1.4 }, { ...sign, bottom: 7.4 }, SCREEN_COLOR),
  );
  return parts;
}

/** Gives every vertex of `geometry` one colour. */
function colored(geometry: BufferGeometry, hex: number): BufferGeometry {
  const color = new Color(hex);
  const count = geometry.getAttribute('position').count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }
  geometry.setAttribute('color', new BufferAttribute(colors, 3));
  return geometry;
}

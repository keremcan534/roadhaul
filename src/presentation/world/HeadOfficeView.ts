import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { BufferGeometry, CylinderGeometry, Group, Mesh, MeshLambertMaterial, type Scene } from 'three';
import type { RectangleDefinition } from '../../data/definitions/MapDefinition';
import { coloured, colouredBox } from './buildingParts';

/** The campus is drawn within this far of the camera, meters (the world's tiles reach about as far). */
const REACH_METERS = 1100;

const WALL = 0xd9d4c8;
const WALL_DARK = 0xb9b2a4;
const SHED = 0xc9c2b4;
const ROOF = 0x3d4148;
const GLASS = 0x2f4b60;
const DOOR = 0x5d6268;
const PAD = 0xa9aaa5;
const ASPHALT = 0x3b3e41;
const LINE = 0xe6e6de;
const FENCE = 0x8b9197;
const TANK = 0xe8ebee;
const ORANGE = 0xf2a33a;
const TRUCK_BOX = 0xf2f2ee;
const FLOOR_METERS = 3.2;
/** The fence: posts this far apart, this tall, and two rails. */
const POST_SPACING_METERS = 2.4;
const FENCE_HEIGHT_METERS = 1.9;

/** A facility's level at the head office (FacilityService.levelOf): 0 for not built. */
export type FacilityLevelOf = (facilityId: string) => number;

/**
 * The company's head office on the map (the owner's request: a company
 * building that grows): a fenced, paved site (MapDefinition.headOffice)
 * with the main office, and a building for each facility the company has
 * built, bigger with each level: the warehouse's shed and the workshop's
 * hall grow longer and gain doors, the fuel depot's tanks and the yard's
 * parked trucks grow in number, the offices gain floors, the marketing
 * billboard grows. The company's colour runs round the main office.
 *
 * In the site's own frame: x across it (its width), z along it (its
 * length), y up from the ground. The pad and the fence are one merged mesh
 * built once; the buildings another, built again only when a level changes
 * (setLevels): two draw calls, hidden past REACH_METERS (showAround).
 */
export class HeadOfficeView {
  private readonly root = new Group();
  private readonly material = new MeshLambertMaterial({ vertexColors: true });
  private readonly grounds: Mesh;
  private readonly buildings: Mesh;
  private shownKey = '';

  constructor(
    private readonly scene: Scene,
    private readonly site: RectangleDefinition,
    groundY: number,
  ) {
    this.root.name = 'head-office';
    this.root.position.set(site.x, groundY, site.z);
    this.root.rotation.y = (site.headingDegrees * Math.PI) / 180;
    this.grounds = new Mesh(merged(groundParts(site.widthMeters, site.lengthMeters)), this.material);
    this.grounds.name = 'head-office:grounds';
    this.buildings = new Mesh(new BufferGeometry(), this.material);
    this.buildings.name = 'head-office:buildings';
    this.root.add(this.grounds, this.buildings);
    this.root.updateMatrixWorld(true);
    scene.add(this.root);
  }

  /** The site's buildings for the facilities built (`levelOf`), the company's colour `companyColor` round the main office. */
  setLevels(levelOf: FacilityLevelOf, companyColor: number): void {
    const levels = FACILITY_IDS.map((id) => Math.max(0, Math.min(3, Math.floor(levelOf(id)))));
    const key = `${levels.join(',')}|${companyColor}`;
    if (key === this.shownKey) {
      return;
    }
    this.shownKey = key;
    const level = (id: (typeof FACILITY_IDS)[number]): number => levels[FACILITY_IDS.indexOf(id)]!;
    const parts: BufferGeometry[] = [
      ...mainOffice(companyColor),
      ...warehouse(level('warehouse')),
      ...workshop(level('workshop')),
      ...fuelDepot(level('fuel_depot')),
      ...truckYard(level('truck_yard'), companyColor),
      ...logisticsOffice(level('logistics_office')),
      ...dispatchOffice(level('dispatch_office')),
      ...trainingCentre(level('training_centre')),
      ...billboard(level('marketing_office'), companyColor),
    ];
    const previous = this.buildings.geometry;
    this.buildings.geometry = merged(parts);
    previous.dispose();
  }

  /** Shown only within REACH_METERS of (x, z). Allocation-free. */
  showAround(x: number, z: number): void {
    const dx = x - this.site.x;
    const dz = z - this.site.z;
    this.root.visible = dx * dx + dz * dz < REACH_METERS * REACH_METERS;
  }

  /** How many buildings' parts stand now (for tests): the vertices of the buildings' mesh. */
  get buildingVertices(): number {
    return this.buildings.geometry.getAttribute('position')?.count ?? 0;
  }

  dispose(): void {
    this.scene.remove(this.root);
    this.grounds.geometry.dispose();
    this.buildings.geometry.dispose();
    this.material.dispose();
  }
}

/** The facilities the campus draws a building for, in the order setLevels reads them. */
const FACILITY_IDS = [
  'warehouse',
  'workshop',
  'fuel_depot',
  'truck_yard',
  'logistics_office',
  'dispatch_office',
  'training_centre',
  'marketing_office',
] as const;

/** A box `width` (x) by `height` by `depth` (z), standing on `y0` at (x, z). */
function block(width: number, height: number, depth: number, x: number, z: number, hex: number, y0 = 0): BufferGeometry {
  return colouredBox(width, height, depth, x, y0 + height / 2, z, hex);
}

/** An upright cylinder standing on `y0` at (x, z). */
function drum(radius: number, height: number, x: number, z: number, hex: number, y0 = 0): BufferGeometry {
  return coloured(new CylinderGeometry(radius, radius, height, 14).translate(x, y0 + height / 2, z), hex);
}

/** A building of `floors` floors with a band of windows round each, a roof slab and (optionally) a coloured band under it. */
function officeBlock(width: number, depth: number, floors: number, x: number, z: number, wall: number, band: number | null): BufferGeometry[] {
  const height = floors * FLOOR_METERS;
  const parts = [block(width, height, depth, x, z, wall)];
  for (let floor = 0; floor < floors; floor++) {
    parts.push(block(width + 0.08, 1.15, depth + 0.08, x, z, GLASS, floor * FLOOR_METERS + 1.1));
  }
  if (band !== null) {
    parts.push(block(width + 0.12, 0.55, depth + 0.12, x, z, band, height - 0.65));
  }
  parts.push(block(width + 0.4, 0.3, depth + 0.4, x, z, ROOF, height));
  return parts;
}

function merged(parts: BufferGeometry[]): BufferGeometry {
  if (parts.length === 0) {
    return new BufferGeometry();
  }
  const geometry = mergeGeometries(parts);
  for (const part of parts) {
    part.dispose();
  }
  return geometry;
}

/** The paved pad, the driveway down its middle, and the fence round it. */
function groundParts(width: number, length: number): BufferGeometry[] {
  const parts = [block(width, 0.08, length, 0, 0, PAD), block(5, 0.1, length - 1, 0, 0, ASPHALT)];
  const halfX = width / 2;
  const halfZ = length / 2;
  const side = (fromX: number, fromZ: number, toX: number, toZ: number): void => {
    const span = Math.hypot(toX - fromX, toZ - fromZ);
    const steps = Math.max(1, Math.ceil(span / POST_SPACING_METERS));
    for (let i = 0; i < steps; i++) {
      const x = fromX + ((toX - fromX) * i) / steps;
      const z = fromZ + ((toZ - fromZ) * i) / steps;
      parts.push(block(0.12, FENCE_HEIGHT_METERS, 0.12, x, z, FENCE));
    }
    const midX = (fromX + toX) / 2;
    const midZ = (fromZ + toZ) / 2;
    const alongX = fromX === toX;
    for (const y of [0.55, FENCE_HEIGHT_METERS - 0.15]) {
      parts.push(block(alongX ? 0.06 : span, 0.08, alongX ? span : 0.06, midX, midZ, FENCE, y));
    }
  };
  side(-halfX, -halfZ, halfX, -halfZ);
  side(halfX, -halfZ, halfX, halfZ);
  side(halfX, halfZ, -halfX, halfZ);
  side(-halfX, halfZ, -halfX, -halfZ);
  return parts;
}

/** The main office: three floors, the company's colour round its top, an entrance canopy. */
function mainOffice(companyColor: number): BufferGeometry[] {
  return [...officeBlock(10, 14, 3, 8, 0, WALL, companyColor), block(1.6, 0.25, 4, 2.4, 0, ROOF, 3), block(0.1, 2.4, 2.2, 2.95, 0, GLASS)];
}

/** The warehouse: a long shed, longer and with another loading door at each level. */
function warehouse(level: number): BufferGeometry[] {
  if (level === 0) {
    return [];
  }
  const length = 4 + 3.5 * level;
  const z = -(7.5 + length / 2);
  const parts = [block(10, 7, length, 8, z, SHED), block(10.4, 0.3, length + 0.4, 8, z, ROOF, 7)];
  for (let door = 0; door < level; door++) {
    parts.push(block(0.1, 4.4, 2.8, 2.95, -9.5 - door * 3.5, DOOR));
  }
  return parts;
}

/** The workshop: a hall with a roller door for each level. */
function workshop(level: number): BufferGeometry[] {
  if (level === 0) {
    return [];
  }
  const length = 4 + 3.5 * level;
  const z = 7.5 + length / 2;
  const parts = [block(10, 6.5, length, 8, z, WALL_DARK), block(10.4, 0.3, length + 0.4, 8, z, ROOF, 6.5)];
  for (let door = 0; door < level; door++) {
    parts.push(block(0.1, 4.2, 2.8, 2.95, 9.5 + door * 3.5, DOOR), block(0.12, 0.35, 2.9, 2.94, 9.5 + door * 3.5, ORANGE, 4.25));
  }
  return parts;
}

/** The fuel depot: a tank for each level, with an orange band. */
function fuelDepot(level: number): BufferGeometry[] {
  const parts: BufferGeometry[] = [];
  for (let tank = 0; tank < level; tank++) {
    const z = -20.5 + tank * 4;
    parts.push(drum(1.7, 5.5, -11, z, TANK), drum(1.75, 0.45, -11, z, ORANGE, 3.9));
  }
  return parts;
}

/** The truck yard: an asphalt lot with bays, and the company's trucks parked in it (one, two, then four). */
function truckYard(level: number, companyColor: number): BufferGeometry[] {
  if (level === 0) {
    return [];
  }
  const parts = [block(12, 0.06, 11, -9, -2.5, ASPHALT, 0.08)];
  for (let bay = 0; bay <= 4; bay++) {
    parts.push(block(10, 0.02, 0.15, -9, -7.5 + bay * 2.75, LINE, 0.14));
  }
  const trucks = level >= 3 ? 4 : level;
  for (let truck = 0; truck < trucks; truck++) {
    const z = -6.1 + truck * 2.75;
    // Its cab toward the driveway, its box behind.
    parts.push(block(2.2, 2.9, 2.2, -5, z, companyColor, 0.6), block(6.8, 3.4, 2.4, -9.8, z, TRUCK_BOX, 0.7));
  }
  return parts;
}

/** The logistics office: a small block, a floor more with each level. */
function logisticsOffice(level: number): BufferGeometry[] {
  return level === 0 ? [] : officeBlock(7, 6, 1 + level, -10, 8.5, WALL, null);
}

/** The dispatch office: a slender tower, a floor more with each level, an aerial on top. */
function dispatchOffice(level: number): BufferGeometry[] {
  if (level === 0) {
    return [];
  }
  const floors = 2 + level;
  return [...officeBlock(5.5, 5.5, floors, -10, 15.5, WALL_DARK, null), block(0.2, 4, 0.2, -10, 15.5, FENCE, floors * FLOOR_METERS + 0.3)];
}

/** The training centre: a low building; from its second level a course of cones on the driveway. */
function trainingCentre(level: number): BufferGeometry[] {
  if (level === 0) {
    return [];
  }
  const parts = officeBlock(7, 4.5, 1, -10, 21, WALL, null);
  for (let cone = 0; level >= 2 && cone < 4 + level; cone++) {
    parts.push(block(0.35, 0.6, 0.35, cone % 2 === 0 ? -1.2 : 1.2, 20.5 - cone * 2.4, ORANGE, 0.1));
  }
  return parts;
}

/** The marketing office's billboard at the fence, facing out: bigger with each level, in the company's colour. */
function billboard(level: number, companyColor: number): BufferGeometry[] {
  if (level === 0) {
    return [];
  }
  const width = 4 + 2 * level;
  const height = 2 + level;
  const legs = 2.5;
  return [
    block(0.25, legs + height, 0.25, -16.6, -17 - width / 3, FENCE),
    block(0.25, legs + height, 0.25, -16.6, -17 + width / 3, FENCE),
    block(0.2, height, width, -16.8, -17, companyColor, legs),
    block(0.22, height * 0.3, width * 0.8, -16.85, -17, TRUCK_BOX, legs + height * 0.35),
  ];
}

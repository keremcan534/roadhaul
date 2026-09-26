import { FIELD_CROPS, type FieldCrop, type RoadKind } from '../../data/definitions/MapDefinition';
import type { DrivingService } from '../../systems/driving/DrivingService';
import type { FleetService } from '../../systems/fleet/FleetService';
import type { MissionService } from '../../systems/missions/MissionService';
import type { NavigationService } from '../../systems/navigation/NavigationService';
import type { Strings } from '../i18n';
import type { MapRoadRun, MapSketch } from './mapSketch';
import { createCanvasTransform, type MapViewport } from './MapViewport';

/** What the maps show besides the world: the truck, its contract's next bay and the route there, and the fleet's trucks. */
export interface MapSources {
  readonly driving: DrivingService;
  readonly navigation: NavigationService;
  readonly missions: MissionService;
  readonly fleet: FleetService;
}

/** How each kind of road is drawn, bottom to top: at least this wide on screen (px), its colour and its edge's. */
const ROAD_STYLES: readonly { readonly kind: RoadKind; readonly minPixels: number; readonly fill: string; readonly edge: string }[] = [
  { kind: 'street', minPixels: 2, fill: '#a3adb8', edge: '#141b21' },
  { kind: 'rural', minPixels: 2.5, fill: '#d8cca4', edge: '#141b21' },
  { kind: 'ringRoad', minPixels: 3.5, fill: '#eef1f4', edge: '#141b21' },
  { kind: 'highway', minPixels: 4.5, fill: '#f2b233', edge: '#3d2c06' },
];
/** The edge adds this much to a road's width on screen, px. */
const EDGE_PIXELS = 2;
/** Fields, muted so the roads stand out on them. */
const FIELD_COLORS: Readonly<Record<FieldCrop, string>> = {
  wheat: '#5e5a2e',
  stubble: '#4f5236',
  green: '#2c4a2a',
  ploughed: '#4a3a2c',
};
const COLORS = {
  ground: '#1b2923',
  sea: '#1d4a66',
  turbine: '#9fb0bd',
  building: '#33443b',
  paved: '#46525c',
  route: '#2e9bff',
  routeEdge: '#0b2a4a',
  pickup: '#ffa726',
  delivery: '#3ddc84',
  depot: '#c9d3dc',
  restArea: '#4aa3ff',
  truck: '#ffffff',
  truckEdge: '#0d1116',
  fleet: '#ffb020',
  label: '#f4f6f8',
  labelEdge: 'rgb(8 12 16 / 85%)',
  north: '#f0643c',
} as const;
const ROUTE_PIXELS = 5;
const LABEL_FONT = '800 15px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const SMALL_FONT = '800 11px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

/** What to draw besides the roads: names and marks for the full map, a compact picture for the minimap. */
export interface PaintOptions {
  /** City names and the pickup/delivery tag over the next bay. */
  labels: boolean;
  /** The truck's arrow, CSS px from tip to tail. */
  truckPixels: number;
  /** Keeps the next bay's pin inside a circle of this radius round the middle (px), so the minimap always points to it; 0 lets it leave the screen. */
  pinRimPixels: number;
  /** Draws north's mark on a circle of this radius round the middle (px); 0 draws none. */
  northRimPixels: number;
}

/**
 * Draws a MapSketch on a 2D canvas through a MapViewport, for both the
 * full map and the minimap: ground and buildings, the roads by kind (only
 * the runs in view), the route to the contract's next bay, depots, rest
 * areas, city names, the truck and north. The paths are built once; a
 * paint allocates nothing, so the minimap can repaint many times a second.
 */
export class MapPainter {
  private readonly runPaths: readonly (readonly { readonly run: MapRoadRun; readonly path: Path2D }[])[];
  private readonly buildings = new Path2D();
  /** The fields, one path per crop. */
  private readonly fields: readonly { readonly color: string; readonly path: Path2D }[];
  /** Depot yards, rest area lots, quays and turning circles: paved ground off the roads. */
  private readonly paved = new Path2D();
  /** The sea, when the world has one. */
  private readonly sea: Path2D | null;
  private readonly transform = createCanvasTransform();
  /** A box round one point, for MapViewport.sees without allocating. */
  private readonly pointBox = { minX: 0, maxX: 0, minZ: 0, maxZ: 0 };
  private readonly cityNames: readonly string[];
  private readonly pickupText: string;
  private readonly deliveryText: string;
  /** Each driver's initials, for their truck's mark on the full map. */
  private readonly driverInitials: ReadonlyMap<string, string>;

  constructor(
    private readonly sketch: MapSketch,
    private readonly sources: MapSources,
    strings: Strings,
  ) {
    this.runPaths = ROAD_STYLES.map((style) =>
      sketch.runs
        .filter((run) => run.kind === style.kind)
        .map((run) => {
          const path = new Path2D();
          path.moveTo(run.points[0]!, run.points[1]!);
          for (let i = 2; i < run.points.length; i += 2) {
            path.lineTo(run.points[i]!, run.points[i + 1]!);
          }
          return { run, path };
        }),
    );
    this.sea = sketch.sea === null ? null : polygonPath(sketch.sea.corners);
    for (const area of sketch.pavedAreas) {
      this.paved.moveTo(area.corners[0]!, area.corners[1]!);
      for (let i = 2; i < area.corners.length; i += 2) {
        this.paved.lineTo(area.corners[i]!, area.corners[i + 1]!);
      }
      this.paved.closePath();
    }
    for (const circle of sketch.turningCircles) {
      this.paved.moveTo(circle.x + circle.radiusMeters, circle.z);
      this.paved.arc(circle.x, circle.z, circle.radiusMeters, 0, Math.PI * 2);
    }
    for (const building of sketch.buildings) {
      this.buildings.rect(building.minX, building.minZ, building.maxX - building.minX, building.maxZ - building.minZ);
    }
    this.fields = FIELD_CROPS.map((crop) => {
      const path = new Path2D();
      for (const field of sketch.fields.filter((candidate) => candidate.crop === crop)) {
        path.moveTo(field.corners[0]!, field.corners[1]!);
        for (let i = 2; i < field.corners.length; i += 2) {
          path.lineTo(field.corners[i]!, field.corners[i + 1]!);
        }
        path.closePath();
      }
      return { color: FIELD_COLORS[crop], path };
    });
    this.cityNames = sketch.cities.map((city) => strings.cityName(city.cityId));
    this.pickupText = strings.t('map.pickup');
    this.deliveryText = strings.t('map.delivery');
    this.driverInitials = new Map(
      sources.fleet.roster().map((offer) => {
        const name = strings.t(`driver.${offer.definition.id}.name`);
        return [offer.definition.id, name.split(/\s+/).map((part) => part.charAt(0)).join('').slice(0, 2)] as const;
      }),
    );
  }

  /** Paints the whole picture onto `context`, whose canvas is the viewport's size times `pixelRatio`. */
  paint(context: CanvasRenderingContext2D, view: MapViewport, pixelRatio: number, options: PaintOptions): void {
    const canvas = context.canvas;
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.fillStyle = COLORS.ground;
    context.fillRect(0, 0, canvas.width, canvas.height);

    // World meters from here on.
    const t = view.canvasTransform(this.transform, pixelRatio);
    context.setTransform(t.a, t.b, t.c, t.d, t.e, t.f);
    if (this.sea !== null) {
      context.fillStyle = COLORS.sea;
      context.fill(this.sea);
    }
    for (let i = 0; i < this.fields.length; i++) {
      const field = this.fields[i]!;
      context.fillStyle = field.color;
      context.fill(field.path);
    }
    context.fillStyle = COLORS.paved;
    context.fill(this.paved);
    context.fillStyle = COLORS.building;
    context.fill(this.buildings);
    context.lineCap = 'round';
    context.lineJoin = 'round';
    this.paintRoads(context, view, true);
    this.paintRoads(context, view, false);
    this.paintRoute(context, view);

    // Screen pixels from here on: marks keep their size whatever the zoom.
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    this.paintPlaces(context, view, options);
    this.paintFleet(context, view, options);
    const vehicle = this.sources.driving.vehicle;
    this.paintTruck(context, view, vehicle.x, vehicle.z, vehicle.heading, options.truckPixels);
    if (options.northRimPixels > 0) {
      this.paintNorth(context, view, options.northRimPixels);
    }
  }

  private paintRoads(context: CanvasRenderingContext2D, view: MapViewport, edges: boolean): void {
    for (let s = 0; s < ROAD_STYLES.length; s++) {
      const style = ROAD_STYLES[s]!;
      const runs = this.runPaths[s]!;
      context.strokeStyle = edges ? style.edge : style.fill;
      for (let i = 0; i < runs.length; i++) {
        const { run, path } = runs[i]!;
        if (!view.sees(run, 12)) {
          continue;
        }
        const pixels = Math.max(style.minPixels, run.widthMeters * view.scale) + (edges ? EDGE_PIXELS : 0);
        context.lineWidth = pixels / view.scale;
        context.stroke(path);
      }
    }
  }

  /** The route from the truck along the roads to the bay, as NavigationService traced it. */
  private paintRoute(context: CanvasRenderingContext2D, view: MapViewport): void {
    const route = this.sources.navigation.route;
    if (route === null || route.count < 1) {
      return;
    }
    const vehicle = this.sources.driving.vehicle;
    context.beginPath();
    context.moveTo(vehicle.x, vehicle.z);
    for (let i = 0; i < route.count; i++) {
      context.lineTo(route.x[i]!, route.z[i]!);
    }
    context.lineTo(route.targetX, route.targetZ);
    context.strokeStyle = COLORS.routeEdge;
    context.lineWidth = (ROUTE_PIXELS + EDGE_PIXELS) / view.scale;
    context.stroke();
    context.strokeStyle = COLORS.route;
    context.lineWidth = ROUTE_PIXELS / view.scale;
    context.stroke();
  }

  private paintPlaces(context: CanvasRenderingContext2D, view: MapViewport, options: PaintOptions): void {
    const sketch = this.sketch;
    // Wind turbines: three blades round a hub.
    context.strokeStyle = COLORS.turbine;
    context.lineWidth = 2;
    context.lineCap = 'round';
    for (let i = 0; i < sketch.windTurbines.length; i++) {
      const turbine = sketch.windTurbines[i]!;
      if (view.sees(this.around(turbine.x, turbine.z), 8)) {
        const x = view.screenX(turbine.x, turbine.z);
        const y = view.screenY(turbine.x, turbine.z);
        context.beginPath();
        for (let blade = 0; blade < 3; blade++) {
          const angle = (blade * Math.PI * 2) / 3 - Math.PI / 2;
          context.moveTo(x, y);
          context.lineTo(x + Math.cos(angle) * 6, y + Math.sin(angle) * 6);
        }
        context.stroke();
      }
    }
    for (let i = 0; i < sketch.restAreas.length; i++) {
      const restArea = sketch.restAreas[i]!;
      if (view.sees(this.around(restArea.x, restArea.z), 12)) {
        const x = view.screenX(restArea.x, restArea.z);
        const y = view.screenY(restArea.x, restArea.z);
        disc(context, x, y, 8, COLORS.restArea);
        context.fillStyle = '#ffffff';
        context.font = SMALL_FONT;
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        context.fillText('P', x, y + 0.5);
      }
    }
    if (options.labels) {
      context.font = LABEL_FONT;
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.lineWidth = 4;
      context.strokeStyle = COLORS.labelEdge;
      context.fillStyle = COLORS.label;
      for (let i = 0; i < sketch.cities.length; i++) {
        const city = sketch.cities[i]!;
        // Under the city's middle: the next bay's pin and its tag stand above theirs.
        const x = view.screenX(city.x, city.z);
        const y = view.screenY(city.x, city.z) + 22;
        context.strokeText(this.cityNames[i]!, x, y);
        context.fillText(this.cityNames[i]!, x, y);
      }
    }
    const target = this.sources.missions.target;
    for (let i = 0; i < sketch.depots.length; i++) {
      const depot = sketch.depots[i]!;
      const x = view.screenX(depot.x, depot.z);
      const y = view.screenY(depot.x, depot.z);
      if (depot.id === target?.depot.id) {
        continue; // Its pin comes last, on top.
      }
      context.fillStyle = COLORS.truckEdge;
      context.fillRect(x - 6, y - 6, 12, 12);
      context.fillStyle = COLORS.depot;
      context.fillRect(x - 4.5, y - 4.5, 9, 9);
    }
    if (target === null) {
      return;
    }
    const x = view.screenX(target.depot.yard.x, target.depot.yard.z);
    const y = view.screenY(target.depot.yard.x, target.depot.yard.z);
    const color = target.kind === 'pickup' ? COLORS.pickup : COLORS.delivery;
    const rim = options.pinRimPixels;
    const dx = x - view.width / 2;
    const dy = y - view.height / 2;
    const distance = Math.hypot(dx, dy);
    if (rim > 0 && distance > rim) {
      // Beyond the minimap's rim: a pointer on the rim, toward the bay.
      pointer(context, view.width / 2 + (dx / distance) * rim, view.height / 2 + (dy / distance) * rim, dx / distance, dy / distance, color);
      return;
    }
    pin(context, x, y, color);
    if (options.labels) {
      // Beside the pin's head, clear of the truck's arrow when the truck stands at the bay.
      context.font = SMALL_FONT;
      context.textAlign = 'left';
      context.textBaseline = 'middle';
      context.lineWidth = 3;
      context.strokeStyle = COLORS.labelEdge;
      context.fillStyle = color;
      const text = target.kind === 'pickup' ? this.pickupText : this.deliveryText;
      context.strokeText(text, x + 12, y - 15);
      context.fillText(text, x + 12, y - 15);
    }
  }

  /** The fleet's trucks on their contracts: amber arrows, their drivers' initials beside them on the full map. */
  private paintFleet(context: CanvasRenderingContext2D, view: MapViewport, options: PaintOptions): void {
    const fleet = this.sources.fleet;
    const count = fleet.updateMarkers();
    const size = Math.max(10, options.truckPixels * 0.7);
    for (let i = 0; i < count; i++) {
      const marker = fleet.markers[i]!;
      if (!view.sees(this.around(marker.x, marker.z), size)) {
        continue;
      }
      this.paintArrow(context, view, marker.x, marker.z, marker.heading, size, COLORS.fleet, 2.5);
      const initials = options.labels ? this.driverInitials.get(marker.driverId) : undefined;
      if (initials !== undefined) {
        const x = view.screenX(marker.x, marker.z);
        const y = view.screenY(marker.x, marker.z) - size;
        context.font = SMALL_FONT;
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        context.lineWidth = 3;
        context.strokeStyle = COLORS.labelEdge;
        context.fillStyle = COLORS.fleet;
        context.strokeText(initials, x, y);
        context.fillText(initials, x, y);
      }
    }
  }

  /** An arrowhead at the truck, pointing the way it faces. */
  private paintTruck(context: CanvasRenderingContext2D, view: MapViewport, x: number, z: number, heading: number, size: number): void {
    this.paintArrow(context, view, x, z, heading, size, COLORS.truck, 3);
  }

  /** An arrowhead of `size` px in `color` at (x, z), pointing along `heading`, with a dark edge `edge` px wide. */
  private paintArrow(
    context: CanvasRenderingContext2D,
    view: MapViewport,
    x: number,
    z: number,
    heading: number,
    size: number,
    color: string,
    edge: number,
  ): void {
    const cx = view.screenX(x, z);
    const cy = view.screenY(x, z);
    // One meter ahead of the truck, on the screen: the arrow's direction, however the map is turned.
    let fx = view.screenX(x + Math.sin(heading), z + Math.cos(heading)) - cx;
    let fy = view.screenY(x + Math.sin(heading), z + Math.cos(heading)) - cy;
    const length = Math.hypot(fx, fy) || 1;
    fx /= length;
    fy /= length;
    const half = size / 2;
    context.beginPath();
    context.moveTo(cx + fx * half, cy + fy * half);
    context.lineTo(cx - fx * half - fy * half * 0.8, cy - fy * half + fx * half * 0.8);
    context.lineTo(cx - fx * half * 0.45, cy - fy * half * 0.45);
    context.lineTo(cx - fx * half + fy * half * 0.8, cy - fy * half - fx * half * 0.8);
    context.closePath();
    context.lineWidth = edge;
    context.strokeStyle = COLORS.truckEdge;
    context.stroke();
    context.fillStyle = color;
    context.fill();
  }

  private around(x: number, z: number): typeof this.pointBox {
    this.pointBox.minX = this.pointBox.maxX = x;
    this.pointBox.minZ = this.pointBox.maxZ = z;
    return this.pointBox;
  }

  /** "N" on the rim, where north (−z) is. */
  private paintNorth(context: CanvasRenderingContext2D, view: MapViewport, rim: number): void {
    // North is up the unturned screen: turned with the map.
    const x = view.width / 2 + Math.sin(view.rotation) * rim;
    const y = view.height / 2 - Math.cos(view.rotation) * rim;
    disc(context, x, y, 8, COLORS.truckEdge);
    context.fillStyle = COLORS.north;
    context.font = SMALL_FONT;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText('N', x, y + 0.5);
  }
}

function disc(context: CanvasRenderingContext2D, x: number, y: number, radius: number, color: string): void {
  context.beginPath();
  context.arc(x, y, radius, 0, Math.PI * 2);
  context.fillStyle = color;
  context.fill();
}

/** A triangle at (x, y) pointing along the unit vector (ux, uy). */
function pointer(context: CanvasRenderingContext2D, x: number, y: number, ux: number, uy: number, color: string): void {
  context.beginPath();
  context.moveTo(x + ux * 7, y + uy * 7);
  context.lineTo(x - ux * 5 - uy * 7, y - uy * 5 + ux * 7);
  context.lineTo(x - ux * 5 + uy * 7, y - uy * 5 - ux * 7);
  context.closePath();
  context.fillStyle = color;
  context.fill();
  context.lineWidth = 2;
  context.strokeStyle = COLORS.truckEdge;
  context.stroke();
}

/** A map pin whose point is at (x, y). */
function pin(context: CanvasRenderingContext2D, x: number, y: number, color: string): void {
  context.beginPath();
  context.moveTo(x, y);
  context.bezierCurveTo(x - 3, y - 6, x - 9, y - 9, x - 9, y - 15);
  context.arc(x, y - 15, 9, Math.PI, 0);
  context.bezierCurveTo(x + 9, y - 9, x + 3, y - 6, x, y);
  context.closePath();
  context.fillStyle = color;
  context.fill();
  context.lineWidth = 2;
  context.strokeStyle = COLORS.truckEdge;
  context.stroke();
  disc(context, x, y - 15, 3.5, COLORS.truckEdge);
}

/** A closed path through a polygon's corners (x and z interleaved). */
function polygonPath(corners: Float64Array): Path2D {
  const path = new Path2D();
  path.moveTo(corners[0]!, corners[1]!);
  for (let i = 2; i < corners.length; i += 2) {
    path.lineTo(corners[i]!, corners[i + 1]!);
  }
  path.closePath();
  return path;
}

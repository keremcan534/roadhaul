import { FIELD_CROPS, type FieldCrop, type RoadKind } from '../../data/definitions/MapDefinition';
import { PLAYER_COMPANY_ID } from '../../data/definitions/RivalCompanyDefinition';
import type { DrivingService } from '../../systems/driving/DrivingService';
import type { FleetService } from '../../systems/fleet/FleetService';
import type { MissionService } from '../../systems/missions/MissionService';
import type { NavigationService } from '../../systems/navigation/NavigationService';
import type { RivalService } from '../../systems/rivals/RivalService';
import type { CompanyTraffic } from '../../systems/traffic/CompanyTraffic';
import type { Strings } from '../i18n';
import { pickOnMap, type MapPick } from './mapPicking';
import type { MapCityLabel, MapDepot, MapFerry, MapPavedArea, MapRoadRun, MapSketch, MapVillageLabel } from './mapSketch';
import { MapTerrain } from './MapTerrain';
import { createCanvasTransform, type MapViewport } from './MapViewport';

/**
 * What the maps show besides the world: the truck, its contract's next bay
 * and the route there, the fleet's trucks, the rivals' trucks and who leads
 * each city.
 */
export interface MapSources {
  readonly driving: DrivingService;
  readonly navigation: NavigationService;
  readonly missions: MissionService;
  readonly fleet: FleetService;
  readonly rivals: RivalService;
  /** Where the fleet's and the rivals' trucks drive in the traffic, which the maps show instead. */
  readonly companyTraffic: CompanyTraffic;
  /** The company's level: a ferry it has not reached yet is drawn closed. Absent: every ferry open. */
  readonly company?: { readonly level: number };
}

/** How each kind of road is drawn, bottom to top: at least this wide on screen (px), its colour and its edge's. */
const ROAD_STYLES: readonly { readonly kind: RoadKind; readonly minPixels: number; readonly fill: string; readonly edge: string }[] = [
  { kind: 'lane', minPixels: 1.5, fill: '#b9ad8a', edge: '#141b21' },
  { kind: 'street', minPixels: 2, fill: '#a3adb8', edge: '#141b21' },
  { kind: 'rural', minPixels: 2.5, fill: '#d8cca4', edge: '#141b21' },
  { kind: 'ringRoad', minPixels: 3.5, fill: '#eef1f4', edge: '#141b21' },
  { kind: 'highway', minPixels: 4.5, fill: '#f2b233', edge: '#3d2c06' },
];
/** The edge adds this much to a road's width on screen, px. */
const EDGE_PIXELS = 2;
/** Fields, a little see-through so the land's relief shows through, muted so the roads stand out on them. */
const FIELD_COLORS: Readonly<Record<FieldCrop, string>> = {
  wheat: 'rgb(166 152 86 / 82%)',
  stubble: 'rgb(140 132 92 / 82%)',
  green: 'rgb(88 134 66 / 82%)',
  ploughed: 'rgb(122 96 70 / 82%)',
};
/**
 * The sea's shallows round every coast, widest and faintest first: meters
 * wide, but between these many pixels (a wide stroke round a long coast is
 * costly to draw: zoomed in, the band narrows instead), then the beach:
 * sand along the water's edge.
 */
const SHALLOWS: readonly (readonly [number, number, number, string])[] = [
  [1300, 26, 70, 'rgb(44 112 146 / 30%)'],
  [620, 14, 36, 'rgb(64 140 168 / 34%)'],
  [220, 6, 14, 'rgb(96 170 188 / 38%)'],
];
const BEACH_METERS = 45;
const BEACH_PIXELS = 1.2;
const COLORS = {
  /** The land, flat, until its relief is drawn (MapTerrain). */
  ground: '#56774a',
  sea: '#174761',
  beach: '#cdb98d',
  forest: 'rgb(28 64 34 / 78%)',
  park: '#6a9a56',
  turbine: '#e3e9ee',
  building: '#4c535a',
  paved: '#6c747c',
  route: '#2e9bff',
  routeEdge: '#0b2a4a',
  pickup: '#ffa726',
  delivery: '#3ddc84',
  depot: '#c9d3dc',
  restArea: '#4aa3ff',
  ferry: '#16a99c',
  ferryClosed: '#5b6b70',
  ferryGlow: 'rgb(22 169 156 / 35%)',
  crossing: '#3fd0c2',
  regionBlocks: '#5a6169',
  regionLabel: 'rgb(244 246 248 / 70%)',
  truck: '#ffffff',
  truckEdge: '#0d1116',
  fleet: '#ffb020',
  label: '#f4f6f8',
  villageLabel: '#c3ccd3',
  labelEdge: 'rgb(8 12 16 / 85%)',
  north: '#f0643c',
} as const;
const ROUTE_PIXELS = 5;
/** A solid line again after a dashed one. */
const NO_DASH: number[] = [];
/** A city's ground is tinted in its leader's colour this far round its middle, meters. */
const TERRITORY_METERS = 260;
const LABEL_FONT = '800 15px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const SMALL_FONT = '800 11px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
/** Zoomed out further than this (px a meter), the villages' names are left out: they would crowd the towns'. */
const VILLAGE_LABEL_MIN_SCALE = 0.035;
/** A village's name is left out where it would lie within this of a town's (px across, px down from it). */
const VILLAGE_CLEAR_PIXELS = { x: 80, y: 18 } as const;
/** Another region's name over its middle. */
const REGION_FONT = '900 26px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

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
  /** Every region's land (this one's and the others' across the water) in one path: the sea is the rest. */
  private readonly lands: Path2D;
  /** The lands' relief, drawn once each (MapTerrain): grows `version` as each comes in. */
  private readonly terrain: MapTerrain;
  /** The other regions' towns' districts, built up. */
  private readonly regionBlocks = new Path2D();
  /** The ferry crossings, dashed over the water. */
  private readonly crossings = new Path2D();
  /** The ferry terminals here and across the water, their names, and whether any is drawn. */
  private readonly ferries: readonly MapFerry[];
  /** Each other region's depots and city names, and its name over its middle. */
  private readonly regionDepots: readonly MapDepot[];
  private readonly regionCities: readonly MapCityLabel[];
  private readonly regionCityNames: readonly string[];
  private readonly regionVillages: readonly MapVillageLabel[];
  private readonly regionVillageNames: readonly string[];
  private readonly regionNames: readonly string[];
  /** The dash of the crossings, meters on the map: set for each paint (one array, no allocation). */
  private readonly dash = [0, 0];
  /** The rivers' water, in one path. */
  private readonly rivers: Path2D;
  /** The forests and the parks, each in one path. */
  private readonly forests: Path2D;
  private readonly parks: Path2D;
  private readonly transform = createCanvasTransform();
  /**
   * The forests' canopy: tree crowns in a tile repeated over them, a few
   * pixels each whatever the zoom (its matrix set for each paint, in place).
   * Made with the first paint's context; null where patterns are missing.
   */
  private canopy: CanvasPattern | null = null;
  private canopyTried = false;
  private readonly canopyMatrix: DOMMatrix | null = typeof DOMMatrix === 'undefined' ? null : new DOMMatrix();
  /** A box round one point, for MapViewport.sees without allocating. */
  private readonly pointBox = { minX: 0, maxX: 0, minZ: 0, maxZ: 0 };
  private readonly cityNames: readonly string[];
  private readonly villageNames: readonly string[];
  private readonly ferryNames: readonly string[];
  /** A ferry's name with the level it opens at, while it is closed. */
  private readonly ferryClosedNames: readonly string[];
  private readonly pickupText: string;
  private readonly deliveryText: string;
  /** Each driver's initials, for their truck's mark on the full map. */
  private readonly driverInitials: ReadonlyMap<string, string>;
  /** Each company's colour as CSS: its trucks' arrows, and its territory's tint and rim. */
  private readonly companyColors: ReadonlyMap<string, { readonly solid: string; readonly tint: string; readonly rim: string }>;
  /** How many of the fleet's and the rivals' markers the last paint drew (for pick). */
  private fleetPainted = 0;
  private rivalsPainted = 0;

  constructor(
    private readonly sketch: MapSketch,
    private readonly sources: MapSources,
    strings: Strings,
    /** The page, to draw the lands' relief with (null: the lands are drawn flat). */
    document: Document | null = null,
  ) {
    const allRuns = [...sketch.runs, ...sketch.regions.flatMap((region) => region.runs)];
    this.runPaths = ROAD_STYLES.map((style) =>
      allRuns
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
    const regions = sketch.regions;
    const pathOf = (areas: readonly MapPavedArea[]): Path2D => {
      const path = new Path2D();
      for (const area of areas) {
        path.addPath(polygonPath(area.corners));
      }
      return path;
    };
    const lands = [sketch, ...regions].map(({ land, relief }) => ({ land, relief, coast: polygonPath(land.corners) }));
    this.lands = pathOf(lands.map(({ land }) => land));
    this.terrain = new MapTerrain(lands, document);
    this.rivers = pathOf([...sketch.rivers, ...regions.flatMap((region) => region.rivers)]);
    this.forests = pathOf([...sketch.forests, ...regions.flatMap((region) => region.forests)]);
    this.parks = pathOf([...sketch.parks, ...regions.flatMap((region) => region.parks)]);
    this.regionBlocks.addPath(pathOf(regions.flatMap((region) => region.blocks)));
    for (const crossing of sketch.crossings) {
      this.crossings.moveTo(crossing[0]!, crossing[1]!);
      for (let i = 2; i < crossing.length; i += 2) {
        this.crossings.lineTo(crossing[i]!, crossing[i + 1]!);
      }
    }
    this.ferries = [...sketch.ferries, ...regions.flatMap((region) => region.ferries)];
    this.regionDepots = regions.flatMap((region) => region.depots);
    this.regionCities = regions.flatMap((region) => region.cities);
    this.regionCityNames = this.regionCities.map((city) => strings.cityName(city.cityId));
    this.regionVillages = regions.flatMap((region) => region.villages);
    this.regionVillageNames = this.regionVillages.map((village) => strings.villageName(village.villageId));
    this.regionNames = regions.map((region) => strings.t(`region.${region.mapId}.name`).toLocaleUpperCase());
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
    this.villageNames = sketch.villages.map((village) => strings.villageName(village.villageId));
    this.ferryNames = this.ferries.map((ferry) => strings.t('ferry.title', { region: strings.t(`region.${ferry.toMapId}.name`) }));
    this.ferryClosedNames = this.ferries.map((ferry, index) => strings.t('map.ferryClosed', { name: this.ferryNames[index]!, level: ferry.requiredLevel }));
    this.pickupText = strings.t('map.pickup');
    this.deliveryText = strings.t('map.delivery');
    this.driverInitials = new Map(
      sources.fleet.roster().map((offer) => {
        const name = strings.t(`driver.${offer.definition.id}.name`);
        return [offer.definition.id, name.split(/\s+/).map((part) => part.charAt(0)).join('').slice(0, 2)] as const;
      }),
    );
    const colors = new Map<string, { solid: string; tint: string; rim: string }>();
    colors.set(PLAYER_COMPANY_ID, companyColor(0xffb020));
    for (const rival of sources.rivals.definitions) {
      colors.set(rival.id, companyColor(rival.color));
    }
    this.companyColors = colors;
  }

  /** Paints the whole picture onto `context`, whose canvas is the viewport's size times `pixelRatio`. */
  /**
   * What a tap at (x, y), CSS px on `view`, points at on the map as last
   * painted: a company truck's arrow, else a city's territory; null for
   * neither.
   */
  pick(view: MapViewport, x: number, y: number): MapPick | null {
    return pickOnMap(
      view,
      x,
      y,
      this.sources.fleet.markers,
      this.fleetPainted,
      this.sources.rivals.markers,
      this.rivalsPainted,
      this.sketch.cities,
      TERRITORY_METERS,
    );
  }

  /** Grows each time a land's relief comes in: a map that repaints only on a change repaints then. */
  get version(): number {
    return this.terrain.version;
  }

  paint(context: CanvasRenderingContext2D, view: MapViewport, pixelRatio: number, options: PaintOptions): void {
    const canvas = context.canvas;
    context.setTransform(1, 0, 0, 1, 0, 0);
    // The sea is all that is not land.
    context.fillStyle = COLORS.sea;
    context.fillRect(0, 0, canvas.width, canvas.height);

    // World meters from here on.
    const t = view.canvasTransform(this.transform, pixelRatio);
    context.setTransform(t.a, t.b, t.c, t.d, t.e, t.f);
    context.lineCap = 'round';
    context.lineJoin = 'round';
    // The shallows round the coasts, then the lands over them, each with its relief, then the beaches.
    for (let i = 0; i < SHALLOWS.length; i++) {
      const [meters, fewest, most, color] = SHALLOWS[i]!;
      context.strokeStyle = color;
      context.lineWidth = Math.min(Math.max(meters, fewest / view.scale), most / view.scale);
      context.stroke(this.lands);
    }
    context.fillStyle = COLORS.ground;
    context.fill(this.lands);
    this.paintRelief(context, view);
    context.strokeStyle = COLORS.beach;
    context.lineWidth = Math.max(BEACH_METERS, BEACH_PIXELS / view.scale);
    context.stroke(this.lands);
    context.fillStyle = COLORS.forest;
    context.fill(this.forests);
    this.paintCanopy(context, view, pixelRatio);
    context.fillStyle = COLORS.park;
    context.fill(this.parks);
    // The rivers and the straits in the sea's own blue, over the land only (a strait runs on out to the sea through
    // its coast and beach): where one meets the sea, no seam shows.
    context.save();
    context.clip(this.lands);
    context.fillStyle = COLORS.sea;
    context.fill(this.rivers);
    context.restore();
    for (let i = 0; i < this.fields.length; i++) {
      const field = this.fields[i]!;
      context.fillStyle = field.color;
      context.fill(field.path);
    }
    context.fillStyle = COLORS.paved;
    context.fill(this.paved);
    context.fillStyle = COLORS.building;
    context.fill(this.buildings);
    context.fillStyle = COLORS.regionBlocks;
    context.fill(this.regionBlocks);
    this.paintTerritory(context, view);
    this.paintRoads(context, view, true);
    this.paintRoads(context, view, false);
    // The ferry crossings: dashed, a few pixels wide whatever the zoom.
    if (this.sketch.crossings.length > 0) {
      this.dash[0] = 9 / view.scale;
      this.dash[1] = 7 / view.scale;
      context.setLineDash(this.dash);
      context.strokeStyle = COLORS.crossing;
      context.lineWidth = 3 / view.scale;
      context.stroke(this.crossings);
      context.setLineDash(NO_DASH);
    }
    this.paintRoute(context, view);

    // Screen pixels from here on: marks keep their size whatever the zoom.
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    this.paintPlaces(context, view, options);
    this.paintRivals(context, view, options);
    this.paintFleet(context, view, options);
    const vehicle = this.sources.driving.vehicle;
    this.paintTruck(context, view, vehicle.x, vehicle.z, vehicle.heading, options.truckPixels);
    if (options.northRimPixels > 0) {
      this.paintNorth(context, view, options.northRimPixels);
    }
  }

  /** The forests' crowns over their green, about CANOPY_TILE_PIXELS a tile on the screen at any zoom. */
  private paintCanopy(context: CanvasRenderingContext2D, view: MapViewport, pixelRatio: number): void {
    if (!this.canopyTried) {
      this.canopyTried = true;
      this.canopy = canopyPattern(context);
    }
    const canopy = this.canopy;
    const matrix = this.canopyMatrix;
    if (canopy === null || matrix === null) {
      return;
    }
    // The pattern's pixels are the user space's (meters): scaled back to the screen's.
    const size = 1 / (view.scale * pixelRatio);
    matrix.a = size;
    matrix.d = size;
    canopy.setTransform(matrix);
    context.fillStyle = canopy;
    context.fill(this.forests);
  }

  /** Each land's relief (MapTerrain) in view, once drawn, clipped to its coast. */
  private paintRelief(context: CanvasRenderingContext2D, view: MapViewport): void {
    const layers = this.terrain.layers;
    for (let i = 0; i < layers.length; i++) {
      const layer = layers[i]!;
      if (layer.image === null || !view.sees(layer.land, 0)) {
        continue;
      }
      context.save();
      context.clip(layer.coast);
      context.drawImage(layer.image, layer.minX, layer.minZ, layer.widthMeters, layer.heightMeters);
      context.restore();
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
    // The other regions' depots, as this region's but quieter: their contracts are over there.
    for (let i = 0; i < this.regionDepots.length; i++) {
      const depot = this.regionDepots[i]!;
      if (view.sees(this.around(depot.x, depot.z), 8)) {
        const x = view.screenX(depot.x, depot.z);
        const y = view.screenY(depot.x, depot.z);
        context.fillStyle = COLORS.truckEdge;
        context.fillRect(x - 5, y - 5, 10, 10);
        context.fillStyle = COLORS.ferryClosed;
        context.fillRect(x - 3.5, y - 3.5, 7, 7);
      }
    }
    // The ferry terminals: a boat on a teal disc (grey while the company has not reached its level), ringed while
    // open, and where it goes on the full map.
    const level = this.sources.company?.level ?? Infinity;
    for (let i = 0; i < this.ferries.length; i++) {
      const ferry = this.ferries[i]!;
      if (!view.sees(this.around(ferry.x, ferry.z), 16)) {
        continue;
      }
      const x = view.screenX(ferry.x, ferry.z);
      const y = view.screenY(ferry.x, ferry.z);
      const open = level >= ferry.requiredLevel;
      if (open) {
        disc(context, x, y, 15, COLORS.ferryGlow);
      }
      disc(context, x, y, 9, open ? COLORS.ferry : COLORS.ferryClosed);
      context.fillStyle = '#ffffff';
      context.beginPath();
      context.moveTo(x - 5.5, y);
      context.lineTo(x + 5.5, y);
      context.lineTo(x + 3.5, y + 3.5);
      context.lineTo(x - 3.5, y + 3.5);
      context.closePath();
      context.rect(x - 2.5, y - 4, 4, 3);
      context.fill();
      if (options.labels) {
        const name = open ? this.ferryNames[i]! : this.ferryClosedNames[i]!;
        context.font = SMALL_FONT;
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        context.lineWidth = 3;
        context.strokeStyle = COLORS.labelEdge;
        context.strokeText(name, x, y + 20);
        context.fillStyle = open ? COLORS.crossing : COLORS.villageLabel;
        context.fillText(name, x, y + 20);
      }
    }
    if (options.labels && this.regionNames.length > 0) {
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.strokeStyle = COLORS.labelEdge;
      // The other regions' names over their middles, large and faint; their villages' and cities' names as here.
      context.font = REGION_FONT;
      context.lineWidth = 5;
      context.fillStyle = COLORS.regionLabel;
      for (let i = 0; i < this.regionNames.length; i++) {
        const region = this.sketch.regions[i]!;
        if (view.sees(region, 0)) {
          const x = view.screenX(region.x, region.z);
          const y = view.screenY(region.x, region.z);
          context.strokeText(this.regionNames[i]!, x, y);
          context.fillText(this.regionNames[i]!, x, y);
        }
      }
      context.font = SMALL_FONT;
      context.lineWidth = 3;
      context.fillStyle = COLORS.villageLabel;
      for (let i = 0; i < this.regionVillages.length; i++) {
        const village = this.regionVillages[i]!;
        if (view.scale >= VILLAGE_LABEL_MIN_SCALE && view.sees(this.around(village.x, village.z), 60)) {
          const x = view.screenX(village.x, village.z);
          const y = view.screenY(village.x, village.z);
          if (this.nearTownName(view, x, y)) {
            continue;
          }
          context.strokeText(this.regionVillageNames[i]!, x, y);
          context.fillText(this.regionVillageNames[i]!, x, y);
        }
      }
      context.font = LABEL_FONT;
      context.lineWidth = 4;
      context.fillStyle = COLORS.label;
      for (let i = 0; i < this.regionCities.length; i++) {
        const city = this.regionCities[i]!;
        if (view.sees(this.around(city.x, city.z), 80)) {
          const x = view.screenX(city.x, city.z);
          const y = view.screenY(city.x, city.z) + 22;
          context.strokeText(this.regionCityNames[i]!, x, y);
          context.fillText(this.regionCityNames[i]!, x, y);
        }
      }
    }
    if (options.labels) {
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.strokeStyle = COLORS.labelEdge;
      // The villages' names, smaller and dimmer than the cities'.
      context.font = SMALL_FONT;
      context.lineWidth = 3;
      context.fillStyle = COLORS.villageLabel;
      for (let i = 0; i < sketch.villages.length; i++) {
        const village = sketch.villages[i]!;
        if (view.scale >= VILLAGE_LABEL_MIN_SCALE && view.sees(this.around(village.x, village.z), 60)) {
          const x = view.screenX(village.x, village.z);
          const y = view.screenY(village.x, village.z);
          if (this.nearTownName(view, x, y)) {
            continue;
          }
          context.strokeText(this.villageNames[i]!, x, y);
          context.fillText(this.villageNames[i]!, x, y);
        }
      }
      context.font = LABEL_FONT;
      context.lineWidth = 4;
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

  /** Whether a village's name at (x, y), screen px, would overlap a town's name here or across the water. Allocation-free. */
  private nearTownName(view: MapViewport, x: number, y: number): boolean {
    return nearName(this.sketch.cities, view, x, y) || nearName(this.regionCities, view, x, y);
  }

  /** Each city's ground tinted in the colour of the company leading it, and ringed in it; none while it is contested. */
  private paintTerritory(context: CanvasRenderingContext2D, view: MapViewport): void {
    const cities = this.sketch.cities;
    // World meters here: a rim 2 px wide on screen.
    context.lineWidth = 2 / Math.max(1e-6, view.scale);
    for (let i = 0; i < cities.length; i++) {
      const city = cities[i]!;
      const leader = this.sources.rivals.leaderOf(city.cityId);
      const colors = leader === null ? undefined : this.companyColors.get(leader);
      if (colors === undefined || !view.sees(this.around(city.x, city.z), TERRITORY_METERS * view.scale)) {
        continue;
      }
      context.beginPath();
      context.arc(city.x, city.z, TERRITORY_METERS, 0, Math.PI * 2);
      context.fillStyle = colors.tint;
      context.fill();
      context.strokeStyle = colors.rim;
      context.stroke();
    }
  }

  /** The rivals' trucks: small arrows in their companies' colours; the one racing the company for its tender larger, ringed. */
  private paintRivals(context: CanvasRenderingContext2D, view: MapViewport, options: PaintOptions): void {
    const rivals = this.sources.rivals;
    const count = rivals.updateMarkers();
    this.rivalsPainted = count;
    const size = Math.max(8, options.truckPixels * 0.55);
    for (let i = 0; i < count; i++) {
      const marker = rivals.markers[i]!;
      this.sources.companyTraffic.placeInTraffic(marker.key, marker);
      const markerSize = marker.racing ? size * 1.5 : size;
      if (!view.sees(this.around(marker.x, marker.z), markerSize)) {
        continue;
      }
      const color = this.companyColors.get(marker.rivalId)?.solid ?? COLORS.depot;
      if (marker.racing) {
        disc(context, view.screenX(marker.x, marker.z), view.screenY(marker.x, marker.z), markerSize * 0.75, COLORS.truck);
      }
      this.paintArrow(context, view, marker.x, marker.z, marker.heading, markerSize, color, 2);
    }
  }

  /** The fleet's trucks on their contracts: amber arrows, their drivers' initials beside them on the full map. */
  private paintFleet(context: CanvasRenderingContext2D, view: MapViewport, options: PaintOptions): void {
    const fleet = this.sources.fleet;
    const count = fleet.updateMarkers();
    this.fleetPainted = count;
    const size = Math.max(10, options.truckPixels * 0.7);
    for (let i = 0; i < count; i++) {
      const marker = fleet.markers[i]!;
      this.sources.companyTraffic.placeInTraffic(marker.key, marker);
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
/** Whether any of `cities`' names, drawn 22 px under its middle, lies close to (x, y), screen px. Allocation-free. */
function nearName(cities: readonly MapCityLabel[], view: MapViewport, x: number, y: number): boolean {
  for (let i = 0; i < cities.length; i++) {
    const city = cities[i]!;
    const dx = view.screenX(city.x, city.z) - x;
    const dy = view.screenY(city.x, city.z) + 22 - y;
    if (Math.abs(dx) < VILLAGE_CLEAR_PIXELS.x && Math.abs(dy) < VILLAGE_CLEAR_PIXELS.y) {
      return true;
    }
  }
  return false;
}

/** The canopy's tile, pixels square: the crowns repeat this far apart on the screen. */
const CANOPY_TILE_PIXELS = 30;

/**
 * A tile of tree crowns for the forests (MapPainter.paintCanopy): round
 * crowns lit from the north-west, their shadows to the south-east, on
 * nothing (the forest's green shows between them). Null without a canvas.
 */
function canopyPattern(context: CanvasRenderingContext2D): CanvasPattern | null {
  const document = context.canvas.ownerDocument as Document | undefined;
  const tile = document?.createElement('canvas');
  const tileContext = tile?.getContext('2d') ?? null;
  if (tile === undefined || tileContext === null) {
    return null;
  }
  tile.width = CANOPY_TILE_PIXELS;
  tile.height = CANOPY_TILE_PIXELS;
  // Crowns: x, y, radius (px), shade; placed so the tile repeats without a seam.
  const crowns: readonly (readonly [number, number, number, number])[] = [
    [5, 6, 4.2, 0],
    [17, 4, 3.6, 1],
    [26, 13, 4.4, 2],
    [11, 16, 4.6, 1],
    [21, 24, 3.8, 0],
    [4, 26, 3.4, 2],
    [14, 27, 3.0, 2],
  ];
  const greens = ['#2e5a2c', '#36652f', '#294f28'];
  for (const [x, y, r, shade] of crowns) {
    for (const [dx, dy] of [[0, 0], [CANOPY_TILE_PIXELS, 0], [-CANOPY_TILE_PIXELS, 0], [0, CANOPY_TILE_PIXELS], [0, -CANOPY_TILE_PIXELS]] as const) {
      tileContext.fillStyle = 'rgb(10 24 12 / 45%)';
      tileContext.beginPath();
      tileContext.arc(x + dx + 1.2, y + dy + 1.4, r, 0, Math.PI * 2);
      tileContext.fill();
      tileContext.fillStyle = greens[shade]!;
      tileContext.beginPath();
      tileContext.arc(x + dx, y + dy, r, 0, Math.PI * 2);
      tileContext.fill();
      tileContext.fillStyle = 'rgb(140 190 110 / 28%)';
      tileContext.beginPath();
      tileContext.arc(x + dx - r * 0.35, y + dy - r * 0.35, r * 0.45, 0, Math.PI * 2);
      tileContext.fill();
    }
  }
  return context.createPattern(tile, 'repeat');
}

function polygonPath(corners: Float64Array): Path2D {
  const path = new Path2D();
  path.moveTo(corners[0]!, corners[1]!);
  for (let i = 2; i < corners.length; i += 2) {
    path.lineTo(corners[i]!, corners[i + 1]!);
  }
  path.closePath();
  return path;
}

/** A company's colour (0xRRGGBB) as CSS: solid for its trucks, a faint tint and a stronger rim for its territory. */
function companyColor(color: number): { solid: string; tint: string; rim: string } {
  const r = (color >> 16) & 0xff;
  const g = (color >> 8) & 0xff;
  const b = color & 0xff;
  return { solid: `rgb(${r} ${g} ${b})`, tint: `rgb(${r} ${g} ${b} / 16%)`, rim: `rgb(${r} ${g} ${b} / 55%)` };
}

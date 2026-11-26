import { Color, Group, Mesh, MeshBasicMaterial, MeshLambertMaterial, type BufferGeometry, type Scene } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { PlaceDefinition, RectangleDefinition } from '../../data/definitions/MapDefinition';
import type { DrivingWorld } from '../../domain/world/DrivingWorld';
import { pavedRectangle } from './groundDecals';
import { flatGroundLight, type PrelitMaterials } from './lighting';
import { lotBackSide, lotBox, lotCylinder } from './lotParts';

/** The places are drawn only with the truck this near one, meters: elsewhere no draw at all. */
const REACH_METERS = 1300;
/** The lot lies like a rest area's: over the grass, under the asphalt. */
const LOT_Y = 0.02;
const LOT_COLOR = 0xa9acae;

const WOOD = 0x9c6b3f;
const DARK_WOOD = 0x6b4a2f;
const GLASS = 0x2a3946;
const POLE = 0x9aa3ab;
const WHITE = 0xf3f4f1;

/**
 * Draws the places to visit (MapDefinition.places): each one's paved lot
 * and, on its back half (away from the road, clear of a truck stopped in
 * the middle), what makes it: the diner's building with its coffee cup sign
 * and picnic tables; the truck wash's portal with its brushes over the
 * lot's middle, and its kiosk; the lookout's deck with railings, coin
 * telescopes, benches and a board. Two draw calls for all of them, hidden
 * while none is within REACH_METERS (showAround). Scenery: nothing here
 * stops the truck.
 */
export class PlacesView {
  private readonly root = new Group();
  private readonly resources: { dispose(): void }[] = [];
  private readonly places: readonly PlaceDefinition[];

  constructor(
    private readonly scene: Scene,
    world: Pick<DrivingWorld, 'places' | 'roads'>,
    options: { readonly prelit?: PrelitMaterials } = {},
  ) {
    this.root.name = 'places';
    this.places = world.places;
    if (this.places.length > 0) {
      const lots = new MeshBasicMaterial({
        color: new Color(LOT_COLOR).multiply(flatGroundLight()),
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -3,
      });
      options.prelit?.add(lots);
      const paved = new Mesh(this.merged(this.places.map((place) => pavedRectangle(place.lot, 12, LOT_Y))), this.track(lots));
      paved.name = 'places:lots';
      const buildings = new Mesh(
        this.merged(this.places.flatMap((place) => placeParts(place, lotBackSide(place.lot, world)))),
        this.track(new MeshLambertMaterial({ vertexColors: true })),
      );
      buildings.name = 'places:buildings';
      this.root.add(paved, buildings);
    }
    this.root.visible = false;
    scene.add(this.root);
  }

  /** Shows the places only with (x, z) within reach of one. Allocation-free. */
  showAround(x: number, z: number): void {
    let near = false;
    for (let i = 0; i < this.places.length && !near; i++) {
      const lot = this.places[i]!.lot;
      const dx = lot.x - x;
      const dz = lot.z - z;
      near = dx * dx + dz * dz < REACH_METERS * REACH_METERS;
    }
    this.root.visible = near;
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

/** What stands on a place's lot, by its kind; `back` is its side away from the road. Exported for tests. */
export function placeParts(place: PlaceDefinition, back: 1 | -1): BufferGeometry[] {
  switch (place.kind) {
    case 'diner':
      return dinerParts(place.lot, back);
    case 'truckWash':
      return truckWashParts(place.lot, back);
    case 'lookout':
      return lookoutParts(place.lot, back);
    case 'raceClub':
      return raceClubParts(place.lot, back);
    case 'busStation':
      return coachStationParts(place.lot, back);
    case 'stadium':
      return stadiumParts(place.lot, back);
  }
}

/**
 * A football stadium on its big lot (the front a car park): a striped pitch
 * with its lines, stepped stands round it (the main one at the back under a
 * roof, in the home side's blue; the others in red), floodlights on masts at
 * the corners, a scoreboard over one end and a ticket booth by the road. The
 * stands face the pitch; about a thousand triangles, merged with the rest.
 */
function stadiumParts(lot: RectangleDefinition, back: 1 | -1): BufferGeometry[] {
  const box = (size: Size, at: At, color: number) => lotBox(lot, back, size, at, color);
  const concrete = 0xb9bec4;
  const blue = 0x2f6dff;
  const red = 0xd23c3c;
  const pitchAlong = 52;
  const pitchAcross = 30;
  // The pitch's middle: toward the back of the lot, the front left for the car park.
  const middle = lot.widthMeters / 2 - 6 - 6.5 - pitchAcross / 2;
  const parts: BufferGeometry[] = [];
  // The grass in stripes, then its lines.
  const stripes = 8;
  for (let stripe = 0; stripe < stripes; stripe++) {
    parts.push(
      box(
        { along: pitchAlong / stripes, across: pitchAcross, height: 0.08 },
        { along: -pitchAlong / 2 + (pitchAlong / stripes) * (stripe + 0.5), across: middle, bottom: 0.02 },
        stripe % 2 === 0 ? 0x3f9a3a : 0x358a31,
      ),
    );
  }
  const line = (size: { along: number; across: number }, along: number, across: number) =>
    box({ ...size, height: 0.02 }, { along, across: middle + across, bottom: 0.1 }, WHITE);
  parts.push(
    line({ along: pitchAlong - 2, across: 0.15 }, 0, -pitchAcross / 2 + 1),
    line({ along: pitchAlong - 2, across: 0.15 }, 0, pitchAcross / 2 - 1),
    line({ along: 0.15, across: pitchAcross - 2 }, -pitchAlong / 2 + 1, 0),
    line({ along: 0.15, across: pitchAcross - 2 }, pitchAlong / 2 - 1, 0),
    line({ along: 0.15, across: pitchAcross - 2 }, 0, 0),
    // The boxes at either end.
    line({ along: 0.15, across: 14 }, -pitchAlong / 2 + 7, 0),
    line({ along: 0.15, across: 14 }, pitchAlong / 2 - 7, 0),
    line({ along: 6, across: 0.15 }, -pitchAlong / 2 + 4, -7),
    line({ along: 6, across: 0.15 }, -pitchAlong / 2 + 4, 7),
    line({ along: 6, across: 0.15 }, pitchAlong / 2 - 4, -7),
    line({ along: 6, across: 0.15 }, pitchAlong / 2 - 4, 7),
  );
  // The goals: two posts and a bar at each end.
  for (const end of [-1, 1]) {
    const along = end * (pitchAlong / 2 - 1);
    parts.push(
      box({ along: 0.15, across: 0.15, height: 2.4 }, { along, across: middle - 3.6, bottom: 0.1 }, WHITE),
      box({ along: 0.15, across: 0.15, height: 2.4 }, { along, across: middle + 3.6, bottom: 0.1 }, WHITE),
      box({ along: 0.15, across: 7.4, height: 0.15 }, { along, across: middle, bottom: 2.5 }, WHITE),
    );
  }
  // The stands: steps of seats rising away from the pitch.
  const sideStand = (side: 1 | -1, steps: number, seats: number) => {
    for (let step = 0; step < steps; step++) {
      const across = middle + side * (pitchAcross / 2 + 0.75 + step * 1.5);
      const height = 0.6 + step * 0.7;
      parts.push(
        box({ along: pitchAlong + 4, across: 1.5, height }, { along: 0, across, bottom: 0 }, concrete),
        box({ along: pitchAlong + 3, across: 0.6, height: 0.3 }, { along: 0, across: across + side * 0.3, bottom: height }, seats),
      );
    }
  };
  const endStand = (end: 1 | -1, steps: number) => {
    for (let step = 0; step < steps; step++) {
      const along = end * (pitchAlong / 2 + 0.75 + step * 1.5);
      const height = 0.6 + step * 0.7;
      parts.push(
        box({ along: 1.5, across: pitchAcross, height }, { along, across: middle, bottom: 0 }, concrete),
        box({ along: 0.6, across: pitchAcross - 1, height: 0.3 }, { along: along + end * 0.3, across: middle, bottom: height }, red),
      );
    }
  };
  sideStand(1, 4, blue);
  sideStand(-1, 3, red);
  endStand(1, 3);
  endStand(-1, 3);
  // The main stand's roof on posts, and its back wall.
  const mainBack = middle + pitchAcross / 2 + 6;
  for (const along of [-24, -8, 8, 24]) {
    parts.push(box({ along: 0.4, across: 0.4, height: 8.5 }, { along, across: mainBack, bottom: 0 }, POLE));
  }
  parts.push(
    box({ along: pitchAlong + 6, across: 0.5, height: 3.6 }, { along: 0, across: mainBack + 0.2, bottom: 0 }, concrete),
    box({ along: pitchAlong + 6, across: 7.5, height: 0.4 }, { along: 0, across: mainBack - 3, bottom: 8.5 }, 0xe8eaed),
    box({ along: pitchAlong + 6.2, across: 0.5, height: 1 }, { along: 0, across: mainBack - 6.6, bottom: 8 }, blue),
  );
  // The scoreboard over one end.
  const boardAlong = pitchAlong / 2 + 6;
  parts.push(
    box({ along: 0.4, across: 0.4, height: 7 }, { along: boardAlong, across: middle - 4, bottom: 0 }, POLE),
    box({ along: 0.4, across: 0.4, height: 7 }, { along: boardAlong, across: middle + 4, bottom: 0 }, POLE),
    box({ along: 0.6, across: 10, height: 3.4 }, { along: boardAlong, across: middle, bottom: 6.5 }, 0x1d2126),
    box({ along: 0.65, across: 8.6, height: 0.9 }, { along: boardAlong, across: middle, bottom: 8.2 }, 0xffc21a),
  );
  // Floodlights at the corners: a mast and a bank of lamps leaning over the pitch.
  for (const end of [-1, 1]) {
    for (const side of [-1, 1]) {
      const at = { along: end * (pitchAlong / 2 + 6), across: middle + side * (pitchAcross / 2 + 7.5) };
      parts.push(
        box({ along: 0.6, across: 0.6, height: 22 }, { ...at, bottom: 0 }, POLE),
        box({ along: 3.6, across: 0.6, height: 2.4 }, { ...at, bottom: 22 }, 0x3a4048),
        box({ along: 3.2, across: 0.7, height: 2 }, { along: at.along, across: at.across - side * 0.1, bottom: 22.2 }, 0xfff4c2),
      );
    }
  }
  // The ticket booth by the car park, under a blue band.
  const booth = { along: -pitchAlong / 2 - 4, across: middle - pitchAcross / 2 - 8 };
  parts.push(
    box({ along: 4, across: 3, height: 2.8 }, { ...booth, bottom: 0 }, 0xe8eaed),
    box({ along: 4.1, across: 3.1, height: 0.5 }, { ...booth, bottom: 2.3 }, blue),
    box({ along: 2.4, across: 0.12, height: 1.1 }, { along: booth.along, across: booth.across - 1.5, bottom: 1 }, GLASS),
  );
  return parts;
}

/** A coach station: a glass-fronted hall in the coaches' green, a platform under a canopy beside it, a sign with a coach by the road. */
function coachStationParts(lot: RectangleDefinition, back: 1 | -1): BufferGeometry[] {
  const box = (size: Size, at: At, color: number) => lotBox(lot, back, size, at, color);
  const green = 0x1f8a70;
  const front = 6;
  const depth = 8;
  const middle = front + depth / 2;
  const parts = [
    box({ along: 22, across: depth, height: 4.6 }, { along: 6, across: middle, bottom: 0 }, 0xdfe4e8),
    box({ along: 22.1, across: depth + 0.1, height: 0.7 }, { along: 6, across: middle, bottom: 3.5 }, green),
    box({ along: 22.6, across: depth + 0.6, height: 0.3 }, { along: 6, across: middle, bottom: 4.6 }, 0x3a4048),
    // Doors in the middle of the glass front.
    box({ along: 2.4, across: 0.12, height: 2.4 }, { along: 6, across: front - 0.04, bottom: 0 }, DARK_WOOD),
  ];
  for (const along of [-2.5, 1.5, 10.5, 14.5]) {
    parts.push(box({ along: 3.4, across: 0.12, height: 2.2 }, { along, across: front - 0.04, bottom: 0.6 }, GLASS));
  }
  // The platform beside the hall: a canopy on posts over benches, at the back of the lot (the front is the coach's).
  for (const along of [-18.5, -12, -5.5]) {
    for (const across of [6.5, 12.5]) {
      parts.push(box({ along: 0.25, across: 0.25, height: 3.6 }, { along, across, bottom: 0 }, POLE));
    }
  }
  parts.push(
    box({ along: 14, across: 7, height: 0.25 }, { along: -12, across: 9.5, bottom: 3.6 }, green),
    box({ along: 5, across: 0.6, height: 0.45 }, { along: -15, across: 11.5, bottom: 0 }, WOOD),
    box({ along: 5, across: 0.6, height: 0.45 }, { along: -9, across: 11.5, bottom: 0 }, WOOD),
  );
  // The sign by the road: a green board with a white coach on it, its windows dark.
  const sign = { along: 19, across: -12.5 };
  parts.push(
    box({ along: 0.3, across: 0.3, height: 5.5 }, { ...sign, bottom: 0 }, POLE),
    box({ along: 3.2, across: 0.2, height: 2 }, { ...sign, bottom: 5.5 }, green),
    box({ along: 2.4, across: 0.24, height: 1 }, { ...sign, bottom: 6 }, WHITE),
  );
  for (const offset of [-0.75, 0, 0.75]) {
    parts.push(box({ along: 0.5, across: 0.28, height: 0.35 }, { along: sign.along + offset, across: sign.across, bottom: 6.5 }, 0x1d2126));
  }
  return parts;
}

/** A race club: a garage hall with its doors, a little grandstand, and checkered flags by the road. */
function raceClubParts(lot: RectangleDefinition, back: 1 | -1): BufferGeometry[] {
  const box = (size: Size, at: At, color: number) => lotBox(lot, back, size, at, color);
  const front = 6;
  const depth = 8;
  const middle = front + depth / 2;
  const parts = [
    box({ along: 18, across: depth, height: 5 }, { along: 6, across: middle, bottom: 0 }, 0xe8eaed),
    box({ along: 18.1, across: depth + 0.1, height: 0.6 }, { along: 6, across: middle, bottom: 3.7 }, 0xd23c3c),
    box({ along: 18.6, across: depth + 0.6, height: 0.3 }, { along: 6, across: middle, bottom: 5 }, 0x3a4048),
  ];
  for (const along of [0.5, 6, 11.5]) {
    parts.push(box({ along: 4, across: 0.12, height: 3.2 }, { along, across: front - 0.04, bottom: 0 }, 0x59616a));
  }
  // The grandstand: three steps of seats, facing the road.
  for (let step = 0; step < 3; step++) {
    const at = { along: -12, across: 8 + step * 1.6, bottom: 0 };
    parts.push(
      box({ along: 9, across: 1.6, height: 0.6 + step * 0.6 }, at, 0x9aa3ab),
      box({ along: 8.6, across: 0.5, height: 0.25 }, { along: -12, across: at.across - 0.4, bottom: 0.6 + step * 0.6 }, 0x2f6dff),
    );
  }
  // Checkered flags on poles at the road end of the lot.
  for (const along of [-19, 19]) {
    parts.push(box({ along: 0.2, across: 0.2, height: 6 }, { along, across: -12.5, bottom: 0 }, POLE));
    for (let row = 0; row < 2; row++) {
      for (let column = 0; column < 3; column++) {
        parts.push(
          box(
            { along: 0.06, across: 0.5, height: 0.5 },
            { along, across: -12.25 + column * 0.5, bottom: 5.0 + row * 0.5 },
            (row + column) % 2 === 0 ? 0x111111 : WHITE,
          ),
        );
      }
    }
  }
  return parts;
}

/** A roadside diner: cream walls, a teal band, a red roof's edge, big windows; a coffee cup high on a pole by the road; picnic tables. */
function dinerParts(lot: RectangleDefinition, back: 1 | -1): BufferGeometry[] {
  const box = (size: Size, at: At, color: number) => lotBox(lot, back, size, at, color);
  const front = 6;
  const depth = 9;
  const middle = front + depth / 2;
  const parts = [
    box({ along: 18, across: depth, height: 4.4 }, { along: 0, across: middle, bottom: 0 }, 0xf4ead5),
    box({ along: 18.1, across: depth + 0.1, height: 0.5 }, { along: 0, across: middle, bottom: 3.1 }, 0x2a9d8f),
    box({ along: 18.8, across: depth + 0.8, height: 0.45 }, { along: 0, across: middle, bottom: 4.4 }, 0xb23a2e),
    // The door, and the windows either side of it, on the front.
    box({ along: 1.6, across: 0.12, height: 2.3 }, { along: 0, across: front - 0.04, bottom: 0 }, DARK_WOOD),
  ];
  for (const along of [-7, -4, 4, 7]) {
    parts.push(box({ along: 2.6, across: 0.12, height: 1.6 }, { along, across: front - 0.04, bottom: 1.1 }, GLASS));
  }
  // The sign by the road: a coffee cup on its saucer, steaming hot (in white).
  const cup = { along: -18, across: -12 };
  parts.push(
    box({ along: 0.35, across: 0.35, height: 7.5 }, { ...cup, bottom: 0 }, POLE),
    lotCylinder(lot, back, { radius: 1.9, height: 0.16, segments: 14 }, { ...cup, bottom: 7.5 }, WHITE),
    lotCylinder(lot, back, { radius: 1.3, height: 1.8, segments: 14 }, { ...cup, bottom: 7.66 }, 0xd8463b),
    lotCylinder(lot, back, { radius: 1.15, height: 0.08, segments: 14 }, { ...cup, bottom: 9.46 }, 0x5b3a1e),
    box({ along: 0.55, across: 0.26, height: 1 }, { along: cup.along + 1.5, across: cup.across, bottom: 8 }, 0xd8463b),
  );
  // Picnic tables beside the diner.
  for (const along of [12.5, 16.5]) {
    const at = { along, across: front + 3 };
    parts.push(
      box({ along: 1.8, across: 0.8, height: 0.08 }, { ...at, bottom: 0.74 }, WOOD),
      box({ along: 0.12, across: 0.5, height: 0.74 }, { ...at, bottom: 0 }, DARK_WOOD),
      box({ along: 1.8, across: 0.28, height: 0.06 }, { along, across: at.across - 0.7, bottom: 0.44 }, WOOD),
      box({ along: 1.8, across: 0.28, height: 0.06 }, { along, across: at.across + 0.7, bottom: 0.44 }, WOOD),
    );
  }
  return parts;
}

/** A truck wash: a portal with brushes over the lot's middle, where the truck stops, and a kiosk at the back with its sign. */
function truckWashParts(lot: RectangleDefinition, back: 1 | -1): BufferGeometry[] {
  const box = (size: Size, at: At, color: number) => lotBox(lot, back, size, at, color);
  const blue = 0x2563c9;
  const parts: BufferGeometry[] = [];
  for (const along of [-1.6, 1.6]) {
    for (const across of [-3.5, 3.5]) {
      parts.push(box({ along: 0.4, across: 0.4, height: 6.2 }, { along, across, bottom: 0 }, blue));
    }
  }
  parts.push(
    box({ along: 3.6, across: 7.4, height: 0.8 }, { along: 0, across: 0, bottom: 6.0 }, blue),
    box({ along: 4, across: 7.8, height: 0.15 }, { along: 0, across: 0, bottom: 6.8 }, WHITE),
    // The brushes: two upright either side, one lying across over the truck.
    lotCylinder(lot, back, { radius: 0.55, height: 4.2, segments: 12 }, { along: 0, across: -2.6, bottom: 0.3 }, 0x3fa9f5),
    lotCylinder(lot, back, { radius: 0.55, height: 4.2, segments: 12 }, { along: 0, across: 2.6, bottom: 0.3 }, 0xffd23f),
    lotCylinder(lot, back, { radius: 0.5, height: 5.6, segments: 12, lying: 'across' }, { along: 0, across: 0, bottom: 5.3 }, 0xf25f5c),
  );
  // The kiosk and its sign.
  const kiosk = { along: -14, across: 11 };
  parts.push(
    box({ along: 6, across: 4, height: 3 }, { ...kiosk, bottom: 0 }, 0xeef2f5),
    box({ along: 6.1, across: 4.1, height: 0.5 }, { ...kiosk, bottom: 2.2 }, blue),
    box({ along: 2.4, across: 0.12, height: 1.2 }, { along: kiosk.along, across: kiosk.across - 2.03, bottom: 0.9 }, GLASS),
    box({ along: 0.3, across: 0.3, height: 6 }, { along: -19, across: -12, bottom: 0 }, POLE),
    box({ along: 0.4, across: 2.6, height: 1.8 }, { along: -19, across: -12, bottom: 6 }, blue),
    box({ along: 0.46, across: 1.2, height: 1.2 }, { along: -19, across: -12, bottom: 6.3 }, WHITE),
  );
  return parts;
}

/** A lookout: a wooden deck at the back with railings, coin telescopes and benches facing the view, and a board about it. */
function lookoutParts(lot: RectangleDefinition, back: 1 | -1): BufferGeometry[] {
  const box = (size: Size, at: At, color: number) => lotBox(lot, back, size, at, color);
  const deckFront = 8;
  const deckBack = 14.6;
  const deckMiddle = (deckFront + deckBack) / 2;
  const deck = 0.45;
  const parts = [box({ along: 16, across: deckBack - deckFront, height: deck }, { along: 0, across: deckMiddle, bottom: 0 }, WOOD)];
  // Railings along the back and the two ends: posts and a rail.
  for (let along = -8; along <= 8; along += 2) {
    parts.push(box({ along: 0.12, across: 0.12, height: 1.1 }, { along, across: deckBack - 0.1, bottom: deck }, DARK_WOOD));
  }
  parts.push(box({ along: 16, across: 0.1, height: 0.08 }, { along: 0, across: deckBack - 0.1, bottom: deck + 1.05 }, DARK_WOOD));
  for (const along of [-7.95, 7.95]) {
    parts.push(box({ along: 0.1, across: deckBack - deckFront, height: 0.08 }, { along, across: deckMiddle, bottom: deck + 1.05 }, DARK_WOOD));
    for (let across = deckFront + 0.5; across < deckBack; across += 2) {
      parts.push(box({ along: 0.12, across: 0.12, height: 1.1 }, { along, across, bottom: deck }, DARK_WOOD));
    }
  }
  // Two coin telescopes at the rail, looking out.
  for (const along of [-3.5, 3.5]) {
    const at = { along, across: deckBack - 1.2 };
    parts.push(
      lotCylinder(lot, back, { radius: 0.08, height: 1.2 }, { ...at, bottom: deck }, 0x3a4750),
      lotCylinder(lot, back, { radius: 0.14, height: 0.75, lying: 'across' }, { ...at, bottom: deck + 1.4 }, 0x3a4750),
      lotCylinder(lot, back, { radius: 0.16, height: 0.12, lying: 'across' }, { along, across: at.across + 0.3, bottom: deck + 1.4 }, 0xf2b233),
    );
  }
  // Benches facing the view.
  for (const along of [-6, 0, 6]) {
    parts.push(
      box({ along: 1.8, across: 0.45, height: 0.07 }, { along, across: deckFront + 2, bottom: deck + 0.42 }, WOOD),
      box({ along: 1.8, across: 0.07, height: 0.4 }, { along, across: deckFront + 1.75, bottom: deck + 0.5 }, WOOD),
      box({ along: 0.1, across: 0.4, height: 0.42 }, { along, across: deckFront + 2, bottom: deck }, DARK_WOOD),
    );
  }
  // The board, by the deck's steps.
  parts.push(
    box({ along: 0.12, across: 0.12, height: 1.9 }, { along: -10.2, across: deckFront - 1, bottom: 0 }, DARK_WOOD),
    box({ along: 0.12, across: 0.12, height: 1.9 }, { along: -11.8, across: deckFront - 1, bottom: 0 }, DARK_WOOD),
    box({ along: 1.9, across: 0.1, height: 1.1 }, { along: -11, across: deckFront - 1, bottom: 0.9 }, 0x2f5d50),
    // Low planters along the deck's front.
    box({ along: 4, across: 0.7, height: 0.45 }, { along: -5, across: deckFront - 0.5, bottom: 0 }, 0x7a8a5a),
    box({ along: 4, across: 0.7, height: 0.45 }, { along: 5, across: deckFront - 0.5, bottom: 0 }, 0x7a8a5a),
  );
  return parts;
}

type Size = { readonly along: number; readonly across: number; readonly height: number };
type At = { readonly along: number; readonly across: number; readonly bottom: number };

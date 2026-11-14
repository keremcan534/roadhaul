import { BoxGeometry, BufferAttribute, Color, CylinderGeometry, type BufferGeometry } from 'three';
import type { RectangleDefinition } from '../../data/definitions/MapDefinition';
import type { DrivingWorld } from '../../domain/world/DrivingWorld';

/**
 * Laying out what stands on a lot beside a road (a rest area, a place to
 * visit): points and boxes by how far `along` the lot (its heading) and how
 * far `across` it toward its back, the long side away from the road.
 */

/** Which long side of the lot is its back, away from the road: 1 for the side to the left of its heading, -1 for the right. */
export function lotBackSide(lot: RectangleDefinition, world: Pick<DrivingWorld, 'roads'>): 1 | -1 {
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
export function lotPoint(lot: RectangleDefinition, back: 1 | -1, along: number, across: number): [number, number] {
  const heading = (lot.headingDegrees * Math.PI) / 180;
  return [
    lot.x + Math.sin(heading) * along + Math.cos(heading) * across * back,
    lot.z + Math.cos(heading) * along - Math.sin(heading) * across * back,
  ];
}

/** A box `size.along` long (along the lot), `size.across` deep and `size.height` tall, standing on `at.bottom`. */
export function lotBox(
  lot: RectangleDefinition,
  back: 1 | -1,
  size: { readonly along: number; readonly across: number; readonly height: number },
  at: { readonly along: number; readonly across: number; readonly bottom: number },
  color: number,
): BufferGeometry {
  const [x, z] = lotPoint(lot, back, at.along, at.across);
  const geometry = new BoxGeometry(size.across, size.height, size.along)
    .rotateY((lot.headingDegrees * Math.PI) / 180)
    .translate(x, at.bottom + size.height / 2, z);
  return colored(geometry, color);
}

/**
 * An upright cylinder of `radius` and `height` standing on `at.bottom`, or
 * one lying along the lot (`lying` 'along') or across it, its middle there.
 */
export function lotCylinder(
  lot: RectangleDefinition,
  back: 1 | -1,
  shape: { readonly radius: number; readonly height: number; readonly segments?: number; readonly lying?: 'along' | 'across' },
  at: { readonly along: number; readonly across: number; readonly bottom: number },
  color: number,
): BufferGeometry {
  const [x, z] = lotPoint(lot, back, at.along, at.across);
  const geometry = new CylinderGeometry(shape.radius, shape.radius, shape.height, shape.segments ?? 10);
  const heading = (lot.headingDegrees * Math.PI) / 180;
  if (shape.lying === 'along') {
    geometry.rotateX(Math.PI / 2).rotateY(heading).translate(x, at.bottom, z);
  } else if (shape.lying === 'across') {
    geometry.rotateZ(Math.PI / 2).rotateY(heading).translate(x, at.bottom, z);
  } else {
    geometry.translate(x, at.bottom + shape.height / 2, z);
  }
  return colored(geometry, color);
}

/** Gives every vertex of `geometry` one colour. */
export function colored(geometry: BufferGeometry, hex: number): BufferGeometry {
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

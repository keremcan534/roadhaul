import { Box3, Scene } from 'three';
import { describe, expect, it } from 'vitest';
import { DrivingWorld } from '../../../../src/domain/world/DrivingWorld';
import { DeckView, deckGeometry, keptDeckSamples } from '../../../../src/presentation/world/DeckView';
import { mapFixture } from '../../../support/contentFixtures';

const overpass = {
  id: 'overpass',
  kind: 'street' as const,
  widthMeters: 8,
  closed: false,
  controlPoints: [
    [0, -180],
    [0, 180],
  ] as [number, number][],
  profile: [
    { atMeters: 40, heightMeters: 0 },
    { atMeters: 140, heightMeters: 7.5 },
    { atMeters: 220, heightMeters: 7.5 },
    { atMeters: 320, heightMeters: 0 },
  ],
  elevated: [[100, 260]] as [number, number][],
};

describe('DeckView', () => {
  it('draws nothing on a map without decks', () => {
    const scene = new Scene();
    const view = new DeckView(scene, new DrivingWorld(mapFixture()));

    expect(view.mesh).toBeNull();
    expect(scene.children).toEqual([]);
  });

  it('draws a deck under a road carried over another, its parapets above the road and piers down to the ground beside the road under it', () => {
    const world = new DrivingWorld(mapFixture({ roads: [...mapFixture().roads, overpass], buildings: [] }));
    const geometry = deckGeometry(world)!;
    const bounds = new Box3().setFromBufferAttribute(geometry.getAttribute('position') as never);

    // Along the elevated stretch (z -80 to 80), from the ground up to the parapets' tops over the 7.5 m deck.
    expect(bounds.min.z).toBeGreaterThan(-82);
    expect(bounds.max.z).toBeLessThan(82);
    expect(bounds.min.y).toBeCloseTo(0, 1);
    expect(bounds.max.y).toBeCloseTo(7.5 + 1.05, 1);
    expect(bounds.max.x).toBeLessThan(4 + 0.8);

    // No pier stands on the road under it (z = 0, 10 m wide).
    const positions = geometry.getAttribute('position');
    for (let i = 0; i < positions.count; i++) {
      if (positions.getY(i) < 4) {
        expect(Math.abs(positions.getZ(i))).toBeGreaterThan(5 + 1.5 - 0.95);
      }
    }

    const scene = new Scene();
    const view = new DeckView(scene, world);
    expect(scene.children).toEqual([view.mesh]);
    view.dispose();
    expect(scene.children).toEqual([]);
  });
});

describe('keptDeckSamples', () => {
  it('draws a straight deck in long pieces where it is level or climbs evenly, every sample where its climb changes', () => {
    const world = new DrivingWorld(mapFixture({ roads: [...mapFixture().roads, overpass], buildings: [] }));
    const road = world.roads.find((candidate) => candidate.id === 'overpass')!;
    const last = road.pointCount - 1;
    const kept = keptDeckSamples(road, 0, last);

    expect(kept[0]).toBe(0);
    expect(kept[kept.length - 1]).toBe(last);
    expect(kept.length).toBeLessThan(road.pointCount / 2);
    // Every sample left out lies on its kept neighbours' line, in height too.
    for (let k = 0; k + 1 < kept.length; k++) {
      const [a, b] = [kept[k]!, kept[k + 1]!];
      for (let i = a + 1; i < b; i++) {
        const t = (road.distances[i]! - road.distances[a]!) / (road.distances[b]! - road.distances[a]!);
        expect(Math.abs(road.heights[i]! - (road.heights[a]! + (road.heights[b]! - road.heights[a]!) * t))).toBeLessThan(0.021);
      }
    }
  });
});

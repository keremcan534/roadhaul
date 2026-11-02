import { Box3, Scene } from 'three';
import { describe, expect, it } from 'vitest';
import { DrivingWorld } from '../../../../src/domain/world/DrivingWorld';
import { DeckView, deckGeometry } from '../../../../src/presentation/world/DeckView';
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

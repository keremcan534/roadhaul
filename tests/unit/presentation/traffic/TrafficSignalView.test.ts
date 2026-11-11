import { InstancedMesh, Scene } from 'three';
import { describe, expect, it } from 'vitest';
import { SIGNAL_GREEN_SECONDS, SIGNAL_AMBER_SECONDS, type SignalHead } from '../../../../src/domain/traffic/trafficSignals';
import { TrafficSignalView } from '../../../../src/presentation/traffic/TrafficSignalView';
import { drawCallCount } from '../../../support/threeResources';

const HEADS: SignalHead[] = [
  { x: 0, z: -8, y: 0, heading: Math.PI, group: 0 },
  { x: 8, z: 0, y: 0, heading: -Math.PI / 2, group: 1 },
];
/** A lens's colour, as its red, green and blue (0..255). */
const rgb = (hex: number): [number, number, number] => [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
const lit = (view: TrafficSignalView, head: number, lens: number): boolean => Math.max(...rgb(view.lensColor(head * 3 + lens))) > 200;

describe('TrafficSignalView', () => {
  it('stands a pole and a head of three lenses at each approach, in two draw calls', () => {
    const scene = new Scene();
    new TrafficSignalView(scene, HEADS);
    expect(drawCallCount(scene)).toBe(2);
  });

  it('lights the lens each head\'s light shows: green one way while the other is red, then amber', () => {
    const view = new TrafficSignalView(new Scene(), HEADS);
    view.update(1);
    // Lenses top to bottom: red, amber, green.
    expect([0, 1, 2].map((lens) => lit(view, 0, lens))).toEqual([false, false, true]);
    expect([0, 1, 2].map((lens) => lit(view, 1, lens))).toEqual([true, false, false]);
    view.update(SIGNAL_GREEN_SECONDS + SIGNAL_AMBER_SECONDS / 2);
    expect([0, 1, 2].map((lens) => lit(view, 0, lens))).toEqual([false, true, false]);
    expect([0, 1, 2].map((lens) => lit(view, 1, lens))).toEqual([true, false, false]);
  });

  it('draws only the lights within 700 m of the camera', () => {
    const scene = new Scene();
    const view = new TrafficSignalView(scene, HEADS);
    const drawn = (): number[] => {
      const counts: number[] = [];
      scene.traverse((object) => {
        if (object instanceof InstancedMesh) {
          counts.push(object.count);
        }
      });
      return counts;
    };
    view.showAround(0, 0);
    expect(drawn()).toEqual([2, 6]);
    view.showAround(5000, 0);
    expect(drawn()).toEqual([0, 0]);
  });

  it('draws nothing without heads', () => {
    const scene = new Scene();
    const view = new TrafficSignalView(scene, []);
    expect(drawCallCount(scene)).toBe(0);
    view.dispose();
    expect(scene.children).toEqual([]);
  });
});

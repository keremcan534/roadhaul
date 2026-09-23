import { describe, expect, it } from 'vitest';
import { importSpecifiers } from '../support/importSpecifiers';

describe('importSpecifiers', () => {
  it.each([
    ["import { a } from './a';", './a'],
    ['import type { A } from "../types/A";', '../types/A'],
    ["import './side-effect.css';", './side-effect.css'],
    ["import * as THREE from 'three';", 'three'],
    ["import { Vector3 } from'three';", 'three'],
    ["export * from './all';", './all'],
    ["export*from'./packed'", './packed'],
    ["export { a, b } from './reexport';", './reexport'],
    ["import {\n  First,\n  Second,\n} from './multi-line';", './multi-line'],
    ["const lazy = import('./lazy');", './lazy'],
    ['const lazy = import(`./template`);', './template'],
    ["const lazy = import ( /* @vite-ignore */ './commented');", './commented'],
    ["const files = import.meta.glob('../presentation/*.ts', { eager: true });", '../presentation/*.ts'],
    ["const files = import.meta.glob<string>(['./a/*.ts', './b/*.ts']);", './a/*.ts'],
  ])('finds the specifier in %j', (source, expected) => {
    expect(importSpecifiers(source)).toContain(expected);
  });

  it.each([
    ["export const label = 'from';"],
    ["export function load(): void {}\nconst text = 'imported from elsewhere';"],
    ["const mode = import.meta.env.MODE === 'production';"],
    ["const exports = './not-an-import';"],
  ])('finds nothing in %j', (source) => {
    expect(importSpecifiers(source)).toEqual([]);
  });
});

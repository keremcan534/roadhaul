import { describe, expect, it } from 'vitest';
import { importSpecifiers } from '../support/importSpecifiers';

/**
 * Enforces the layer rules described in ARCHITECTURE.md
 * (Data -> Domain -> Systems -> Presentation -> UI).
 *
 * When this test fails, move the code to the layer it belongs to. Change the
 * rules only together with ARCHITECTURE.md, and explain why in the commit.
 */

const LAYERS = [
  'core',
  'data',
  'domain',
  'systems',
  'app',
  'simulation',
  'presentation',
  'ui',
  'platform',
  'entry',
] as const;
type Layer = (typeof LAYERS)[number];

/** Layers each layer may import from, besides itself. */
const ALLOWED_LAYER_IMPORTS: Readonly<Record<Layer, readonly Layer[]>> = {
  core: [],
  data: ['core'],
  domain: ['core', 'data'],
  systems: ['core', 'data', 'domain'],
  app: ['core', 'data', 'domain', 'systems'],
  simulation: ['core', 'data', 'domain', 'systems'],
  presentation: ['core', 'data', 'domain', 'systems', 'simulation'],
  ui: ['core', 'data', 'domain', 'systems'],
  platform: ['core', 'data', 'domain', 'systems'],
  entry: ['core', 'data', 'domain', 'systems', 'app', 'simulation', 'presentation', 'ui', 'platform'],
};

/** npm packages each layer may import. The engine-agnostic layers may import none. */
const ALLOWED_PACKAGES: Readonly<Record<Layer, readonly string[]>> = {
  core: [],
  data: [],
  domain: [],
  systems: [],
  app: [],
  simulation: ['@dimforge/rapier3d-compat'],
  presentation: ['three'],
  ui: [],
  platform: [],
  entry: [],
};

const sources = import.meta.glob<string>('/src/**/*.{ts,mts,cts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
});
const files = Object.keys(sources).sort();

function isPath(specifier: string): boolean {
  return specifier.startsWith('.') || specifier.startsWith('/');
}

function layerOf(path: string): Layer | undefined {
  if (path === '/src/main.ts') {
    return 'entry';
  }
  const folder = /^\/src\/([^/]+)\//.exec(path)?.[1];
  return LAYERS.find((layer) => layer === folder && layer !== 'entry');
}

function resolvePath(fromFile: string, specifier: string): string {
  if (specifier.startsWith('/')) {
    return specifier; // Project-root path, as Vite resolves it.
  }
  const parts = fromFile.split('/').slice(0, -1);
  for (const segment of specifier.split('/')) {
    if (segment === '..') {
      parts.pop();
    } else if (segment !== '.') {
      parts.push(segment);
    }
  }
  return parts.join('/');
}

function packageName(specifier: string): string {
  const segments = specifier.split('/');
  return specifier.startsWith('@') ? segments.slice(0, 2).join('/') : (segments[0] ?? specifier);
}

describe('architecture', () => {
  it('finds the source files', () => {
    expect(files.length).toBeGreaterThan(10);
    expect(files).toContain('/src/main.ts');
  });

  it('places every source file in a known layer folder', () => {
    expect(files.filter((file) => layerOf(file) === undefined)).toEqual([]);
  });

  it('only imports from allowed layers', () => {
    const violations: string[] = [];
    for (const file of files) {
      const from = layerOf(file);
      if (from === undefined) {
        continue;
      }
      for (const specifier of importSpecifiers(sources[file] ?? '')) {
        if (!isPath(specifier)) {
          continue;
        }
        const to = layerOf(resolvePath(file, specifier));
        if (to === undefined) {
          violations.push(`${file} imports "${specifier}", which is outside the layer folders`);
        } else if (to !== from && !ALLOWED_LAYER_IMPORTS[from].includes(to)) {
          violations.push(`${file} (${from}) must not import "${specifier}" (${to})`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('only imports npm packages where they are allowed', () => {
    const violations: string[] = [];
    for (const file of files) {
      const from = layerOf(file);
      if (from === undefined) {
        continue;
      }
      for (const specifier of importSpecifiers(sources[file] ?? '')) {
        if (!isPath(specifier) && !ALLOWED_PACKAGES[from].includes(packageName(specifier))) {
          violations.push(`${file} (${from}) must not import package "${specifier}"`);
        }
      }
    }
    expect(violations).toEqual([]);
  });
});

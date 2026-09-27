import { describe, expect, it } from 'vitest';
import { CARGO_CATEGORIES } from '../../../src/data/definitions/CargoDefinition';
import { FACILITY_EFFECTS } from '../../../src/data/definitions/FacilityDefinition';
import { UPGRADE_LOOKS } from '../../../src/data/definitions/UpgradeDefinition';
import { cargoIcon, facilityIcon, iconMarkup, upgradeIcon, type IconName } from '../../../src/ui/iconShapes';

const PAGES_FIGURES_AND_MENUS = [
  'jobs',
  'truck',
  'garage',
  'events',
  'fleet',
  'rivals',
  'office',
  'flag',
  'map',
  'close',
  'eye',
  'coins',
  'reputation',
  'pin',
  'route',
  'clock',
  'fuel',
  'wrench',
  'cargo',
  'trophy',
  'express',
  'careful',
  'heavy',
  'play',
  'controls',
  'steering',
  'tilt',
  'arrows',
  'camera',
  'keyboard',
  'plus',
  'home',
  'settings',
] as const satisfies readonly IconName[];

const ALL: readonly IconName[] = [
  ...PAGES_FIGURES_AND_MENUS,
  ...CARGO_CATEGORIES.map(cargoIcon),
  ...UPGRADE_LOOKS.map(upgradeIcon),
  ...FACILITY_EFFECTS.map(facilityIcon),
];

/** One shape element, self-closed, with attributes in quotes. */
const SHAPE = /<(path|rect|circle|ellipse)((?: [a-z-]+="[^"<>]*")+)\/>/g;

describe('iconShapes', () => {
  it('has a glyph for every page, figure, menu, cargo, truck part and facility, made of well-formed shapes', () => {
    for (const name of ALL) {
      const markup = iconMarkup(name);
      expect(markup, name).not.toBe('');
      expect(markup, name).not.toMatch(/\$\{|undefined|NaN/);
      // Nothing but shapes, each attribute once.
      expect(markup.replace(SHAPE, ''), name).toBe('');
      for (const [, , attributes] of markup.matchAll(SHAPE)) {
        const names = [...attributes!.matchAll(/ ([a-z-]+)="/g)].map((match) => match[1]);
        expect(new Set(names).size, `${name}: ${attributes}`).toBe(names.length);
      }
    }
  });

  it('draws inside its 24-unit square', () => {
    for (const name of ALL) {
      for (const [, attribute, value] of iconMarkup(name).matchAll(/ (x|y|cx|cy)="([^"]+)"/g)) {
        expect(Number(value), `${name} ${attribute}`).toBeGreaterThanOrEqual(0);
        expect(Number(value), `${name} ${attribute}`).toBeLessThanOrEqual(24);
      }
    }
  });

  it('paints the accent through a variable, so a selected button or a cargo that needs care can recolour it', () => {
    for (const name of ['truck', 'garage', 'cargo', 'coins', 'route', 'medical', 'hazardous'] as const) {
      expect(iconMarkup(name), name).toContain('var(--rh-icon-accent,#f2a33a)');
    }
  });
});

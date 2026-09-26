/**
 * The seasons, as the year goes round from the calendar's March: they set
 * how the land looks (the grass, the trees, the fields, snow in winter) and
 * what weather may come (snow in winter, rain in the others).
 */
export const SEASONS = ['spring', 'summer', 'autumn', 'winter'] as const;
export type Season = (typeof SEASONS)[number];

export function isSeason(value: unknown): value is Season {
  return (SEASONS as readonly unknown[]).includes(value);
}

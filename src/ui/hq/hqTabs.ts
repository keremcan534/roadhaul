/**
 * The company panel's pages: the job board, the truck's state, the garage
 * (paint, upgrades, trucks), the fleet (drivers and their trucks), the
 * rivals (the league, the cities, campaigns and buy-outs) and the special
 * events.
 */
export const HQ_TABS = ['jobs', 'truck', 'garage', 'fleet', 'rivals', 'events'] as const;
export type HqTab = (typeof HQ_TABS)[number];

/** The pages with a button of their own on the road (HudDock): the fleet and the rivals are reached through the panel. */
export const DOCK_TABS = ['jobs', 'truck', 'garage', 'events'] as const satisfies readonly HqTab[];
export type DockTab = (typeof DOCK_TABS)[number];

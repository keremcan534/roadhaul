/**
 * The company panel's pages: the job board, the truck's state, the garage
 * (paint, upgrades, trucks), the fleet (drivers and their trucks) and the
 * special events.
 */
export const HQ_TABS = ['jobs', 'truck', 'garage', 'fleet', 'events'] as const;
export type HqTab = (typeof HQ_TABS)[number];

/** The pages with a button of their own on the road (HudDock): the fleet is reached through the panel. */
export const DOCK_TABS = ['jobs', 'truck', 'garage', 'events'] as const satisfies readonly HqTab[];
export type DockTab = (typeof DOCK_TABS)[number];

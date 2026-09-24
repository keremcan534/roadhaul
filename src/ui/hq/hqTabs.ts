/** The company panel's pages: the job board, the truck's state, the garage (paint, upgrades, trucks) and the special events. */
export const HQ_TABS = ['jobs', 'truck', 'garage', 'events'] as const;
export type HqTab = (typeof HQ_TABS)[number];

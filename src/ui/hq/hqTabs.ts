/** The HQ's pages: the job board, the garage and the upgrade shop. */
export const HQ_TABS = ['jobs', 'garage', 'upgrades'] as const;
export type HqTab = (typeof HQ_TABS)[number];

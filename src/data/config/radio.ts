/** The cab radio's stations (CabRadio), in the order the radio button steps through them. Ids are stable (settings). */
export const RADIO_STATIONS = ['highway', 'night', 'country'] as const;
export type RadioStation = (typeof RADIO_STATIONS)[number];

/** The radio's choice: a station, or off. */
export const RADIO_CHOICES = ['off', ...RADIO_STATIONS] as const;
export type RadioChoice = (typeof RADIO_CHOICES)[number];

export function isRadioChoice(value: unknown): value is RadioChoice {
  return typeof value === 'string' && (RADIO_CHOICES as readonly string[]).includes(value);
}

/** The choice after `choice`: off, then each station, then off again. */
export function nextRadioChoice(choice: RadioChoice): RadioChoice {
  return RADIO_CHOICES[(RADIO_CHOICES.indexOf(choice) + 1) % RADIO_CHOICES.length]!;
}

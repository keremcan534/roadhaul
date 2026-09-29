import { button, element } from '../dom';

/** A row of choices, one of them picked. */
export interface ChoiceRow<T> {
  readonly row: HTMLDivElement;
  /** Marks `value` as the picked one, without telling anyone. */
  pick(value: T): void;
  /** Who hears when the player picks a choice. */
  onPick(listener: (value: T) => void): void;
}

/**
 * A labelled row of choices, each marked `data-<key>="<value>"` (on/off for
 * true/false). Picking one shows it picked at once and tells the listener
 * given to `onPick`.
 */
export function choiceRow<T extends string | boolean>(
  document: Document,
  label: string,
  key: string,
  values: readonly T[],
  picked: T,
  labelOf: (value: T) => string,
): ChoiceRow<T> {
  const row = element(document, 'div', 'settings__row');
  const group = element(document, 'div', 'settings__choices');
  group.setAttribute('role', 'radiogroup');
  group.setAttribute('aria-label', label);
  const dataKey = key.replace(/-(\w)/g, (_, letter: string) => letter.toUpperCase());
  let listener: (value: T) => void = () => {};
  const options = values.map((value) => {
    const option = button(document, 'settings__choice', labelOf(value), key, () => {
      pick(value);
      listener(value);
    });
    option.setAttribute('role', 'radio');
    option.dataset[dataKey] = typeof value === 'boolean' ? (value ? 'on' : 'off') : value;
    group.append(option);
    return option;
  });
  const pick = (value: T): void => {
    values.forEach((candidate, index) => select(options[index]!, candidate === value));
  };
  pick(picked);
  row.append(element(document, 'h3', 'settings__label', label), group);
  return {
    row,
    pick,
    onPick: (next) => {
      listener = next;
    },
  };
}

/** Marks a choice as the picked one of its group, or not. */
export function select(option: HTMLButtonElement, selected: boolean): void {
  option.classList.toggle('button--primary', selected);
  option.classList.toggle('is-selected', selected);
  option.classList.toggle('button--secondary', !selected);
  option.setAttribute('aria-checked', String(selected));
}

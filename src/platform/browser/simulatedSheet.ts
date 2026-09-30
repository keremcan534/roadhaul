/** A simulated ad's or purchase's full-screen sheet: its title, a line that changes, and its buttons. */
export interface SimulatedSheet {
  readonly root: HTMLElement;
  readonly status: HTMLElement;
  /** Adds a button with `data-action` = `action`; the sheet closes as it is pressed. */
  button(label: string, action: string, onPress: () => void): HTMLButtonElement;
}

/**
 * A plain full-screen sheet over the game, for the simulated ads and store (simulatedAds.ts, simulatedStore.ts): what
 * the Android app's ads and Google Play would show there. Development and tests only, never shown to players: its
 * words are English and not in the string tables.
 */
export function simulatedSheet(document: Document, title: string): SimulatedSheet {
  const root = document.createElement('div');
  root.className = 'simulated';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  const panel = document.createElement('div');
  panel.className = 'simulated__panel';
  const heading = document.createElement('strong');
  heading.className = 'simulated__title';
  heading.textContent = title;
  const status = document.createElement('p');
  status.className = 'simulated__status';
  const buttons = document.createElement('div');
  buttons.className = 'simulated__buttons';
  panel.append(heading, status, buttons);
  root.append(panel);
  document.body.append(root);
  return {
    root,
    status,
    button: (label, action, onPress) => {
      const node = document.createElement('button');
      node.type = 'button';
      node.className = 'button button--secondary';
      node.dataset.action = action;
      node.textContent = label;
      node.addEventListener('click', () => {
        root.remove();
        onPress();
      });
      buttons.append(node);
      return node;
    },
  };
}

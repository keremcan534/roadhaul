/** Creates an element with a class name and, optionally, text. */
export function element<K extends keyof HTMLElementTagNameMap>(
  document: Document,
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) {
    node.textContent = text;
  }
  return node;
}

/**
 * A button that runs `onClick`. `action` becomes `data-action`, a stable
 * hook for tests, since the label changes with the language.
 */
export function button(
  document: Document,
  className: string,
  label: string,
  action: string,
  onClick: () => void,
): HTMLButtonElement {
  const node = element(document, 'button', `button ${className}`, label);
  node.type = 'button';
  node.dataset.action = action;
  node.addEventListener('click', onClick);
  return node;
}

/** Sets textContent only when it changes, so per-frame callers do not touch the DOM needlessly. */
export function setText(node: Node, text: string): void {
  if (node.textContent !== text) {
    node.textContent = text;
  }
}

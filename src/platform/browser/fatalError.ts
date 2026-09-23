/**
 * Last-resort error screen for failures the game UI cannot handle: boot
 * errors, missing WebGL, a crashed game loop. Uses textContent only, never
 * innerHTML.
 */
export function showFatalError(document: Document, title: string, error: unknown): void {
  document.querySelector('.fatal-error')?.remove();

  const panel = document.createElement('div');
  panel.className = 'fatal-error';
  panel.setAttribute('role', 'alert');

  const heading = document.createElement('strong');
  heading.textContent = title;

  const details = document.createElement('pre');
  details.textContent = error instanceof Error ? error.message : String(error);

  panel.append(heading, details);
  document.body.append(panel);
}

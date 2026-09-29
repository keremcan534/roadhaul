/** What the error screen says, in the player's language. */
export interface FatalErrorText {
  readonly title: string;
  /** What happened to the company (it is kept as last saved), or why the game cannot run here. */
  readonly note: string;
  /** The restart button's label. */
  readonly restart: string;
}

/**
 * Last-resort error screen for failures the game UI cannot handle: boot
 * errors, missing WebGL, a crashed game loop. It says what happened in the
 * player's words and offers a restart (the save is untouched: the game goes
 * on from what it last saved), with the error itself below, small, for a bug
 * report. Uses textContent only, never innerHTML.
 */
export function showFatalError(document: Document, text: FatalErrorText, error: unknown): void {
  document.querySelector('.fatal-error')?.remove();

  const panel = document.createElement('div');
  panel.className = 'fatal-error';
  panel.setAttribute('role', 'alert');

  const heading = document.createElement('strong');
  heading.className = 'fatal-error__title';
  heading.textContent = text.title;

  const note = document.createElement('p');
  note.className = 'fatal-error__note';
  note.textContent = text.note;

  const restart = document.createElement('button');
  restart.type = 'button';
  restart.className = 'button fatal-error__restart';
  restart.dataset.action = 'restart';
  restart.textContent = text.restart;
  restart.addEventListener('click', () => document.defaultView?.location.reload());

  const details = document.createElement('pre');
  details.textContent = error instanceof Error ? error.message : String(error);

  panel.append(heading, note, restart, details);
  document.body.append(panel);
}

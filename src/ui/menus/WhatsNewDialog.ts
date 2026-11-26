import { button, element } from '../dom';
import type { Strings } from '../i18n';
import { icon } from '../icons';

export interface WhatsNewActions {
  readonly onClose: () => void;
}

/**
 * What's New: what the update brought, in the player's language, the same
 * words as Google Play's release notes for the build (the store listing's
 * changelogs, built in: `__RELEASE_NOTES__`), and below them the releases
 * before it (`__RELEASE_HISTORY__`): the game's patch notes. It opens by
 * itself at the main menu once for each new build (whatsNew.ts), and from
 * the main menu's What's New button.
 */
export class WhatsNewDialog {
  private readonly overlay: HTMLDivElement;
  private readonly version: HTMLParagraphElement;
  private readonly notes: HTMLParagraphElement;
  private readonly earlier: HTMLDivElement;
  private readonly ok: HTMLButtonElement;

  constructor(
    parent: HTMLElement,
    private readonly strings: Strings,
    actions: WhatsNewActions,
  ) {
    const document = parent.ownerDocument;
    this.overlay = element(document, 'div', 'screen whats-new');
    this.overlay.dataset.screen = 'whatsNew';
    this.overlay.hidden = true;
    const panel = element(document, 'div', 'panel whats-new__panel');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-labelledby', 'whats-new-title');
    const title = element(document, 'h2', 'panel__title whats-new__title');
    title.id = 'whats-new-title';
    title.append(icon(document, 'news', 'whats-new__icon'), document.createTextNode(strings.t('whatsNew.title')));
    this.version = element(document, 'p', 'whats-new__version');
    this.notes = element(document, 'p', 'whats-new__notes');
    this.notes.dataset.value = 'release-notes';
    this.earlier = element(document, 'div', 'whats-new__earlier');
    this.earlier.dataset.value = 'earlier-notes';
    this.ok = button(document, 'button--primary whats-new__ok', strings.t('whatsNew.ok'), 'close-whats-new', actions.onClose);
    panel.append(title, this.version, this.notes, this.earlier, this.ok);
    this.overlay.append(panel);
    parent.append(this.overlay);
  }

  /**
   * Opens with `notes`, the update's (its line breaks kept), under the
   * version `version`; below them the releases before it, newest first,
   * each under its build (the patch notes).
   */
  open(notes: string, version: string, earlier: readonly { readonly build: string; readonly notes: string }[] = []): void {
    const document = this.overlay.ownerDocument;
    this.version.textContent = version;
    this.notes.textContent = notes;
    const sections = earlier.map((release) => {
      const section = element(document, 'section', 'whats-new__release');
      section.append(
        element(document, 'h3', 'whats-new__release-title', this.strings.t('whatsNew.release', { build: release.build })),
        element(document, 'p', 'whats-new__release-notes', release.notes),
      );
      return section;
    });
    if (sections.length > 0) {
      sections.unshift(element(document, 'h3', 'whats-new__earlier-title', this.strings.t('whatsNew.earlier')));
    }
    this.earlier.replaceChildren(...sections);
    this.earlier.hidden = sections.length === 0;
    this.overlay.hidden = false;
    this.ok.focus();
  }

  get isOpen(): boolean {
    return !this.overlay.hidden;
  }

  close(): void {
    this.overlay.hidden = true;
  }

  dispose(): void {
    this.overlay.remove();
  }
}

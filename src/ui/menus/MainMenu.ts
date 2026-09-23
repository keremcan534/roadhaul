import { button, element } from '../dom';
import type { Strings } from '../i18n';

export interface MainMenuActions {
  readonly onPlay: () => void;
  /** Switches between Turkish and English. */
  readonly onSwitchLanguage: () => void;
}

/** The title screen over the slowly circling camera: logo, tagline, Play and a language switch. */
export class MainMenu {
  private readonly root: HTMLDivElement;

  constructor(parent: HTMLElement, strings: Strings, actions: MainMenuActions) {
    const document = parent.ownerDocument;
    this.root = element(document, 'div', 'screen main-menu');
    this.root.dataset.screen = 'mainMenu';
    this.root.hidden = true;

    const logo = element(document, 'h1', 'main-menu__logo', 'ROAD');
    logo.append(element(document, 'span', 'main-menu__logo-accent', 'HAUL'));
    const tagline = element(document, 'p', 'main-menu__tagline', strings.t('menu.tagline'));
    const play = button(document, 'button--primary main-menu__play', strings.t('menu.play'), 'play', actions.onPlay);
    const language = button(
      document,
      'button--ghost main-menu__language',
      strings.t('menu.language'),
      'switch-language',
      actions.onSwitchLanguage,
    );
    this.root.append(logo, tagline, play, language);
    parent.append(this.root);
  }

  set visible(visible: boolean) {
    this.root.hidden = !visible;
  }

  dispose(): void {
    this.root.remove();
  }
}

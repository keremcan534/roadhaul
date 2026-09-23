import { button, element, setText } from '../dom';
import type { Strings } from '../i18n';

export interface MainMenuActions {
  readonly onContinue: () => void;
  readonly onNewCompany: () => void;
  /** Switches between Turkish and English. */
  readonly onSwitchLanguage: () => void;
}

/**
 * The title screen over the slowly circling camera: logo, tagline, Continue
 * (with a saved game), New company and a language switch.
 */
export class MainMenu {
  private readonly root: HTMLDivElement;
  private readonly continueButton: HTMLButtonElement;
  private readonly newCompanyButton: HTMLButtonElement;
  private readonly message: HTMLParagraphElement;

  constructor(parent: HTMLElement, strings: Strings, actions: MainMenuActions) {
    const document = parent.ownerDocument;
    this.root = element(document, 'div', 'screen main-menu');
    this.root.dataset.screen = 'mainMenu';
    this.root.hidden = true;

    const logo = element(document, 'h1', 'main-menu__logo', 'ROAD');
    logo.append(element(document, 'span', 'main-menu__logo-accent', 'HAUL'));
    const tagline = element(document, 'p', 'main-menu__tagline', strings.t('menu.tagline'));
    this.continueButton = button(
      document,
      'button--primary main-menu__play',
      strings.t('menu.continue'),
      'continue-game',
      actions.onContinue,
    );
    this.newCompanyButton = button(
      document,
      'button--primary main-menu__play',
      strings.t('menu.newCompany'),
      'new-company',
      actions.onNewCompany,
    );
    this.message = element(document, 'p', 'main-menu__message');
    const language = button(
      document,
      'button--ghost main-menu__language',
      strings.t('menu.language'),
      'switch-language',
      actions.onSwitchLanguage,
    );
    this.root.append(logo, tagline, this.continueButton, this.newCompanyButton, this.message, language);
    parent.append(this.root);
  }

  set visible(visible: boolean) {
    this.root.hidden = !visible;
  }

  /**
   * Offers Continue only with a saved game (New company is then secondary),
   * and shows `message` (a load problem, saving being off) when there is one.
   */
  update(hasSave: boolean, message: string | null): void {
    this.continueButton.hidden = !hasSave;
    this.newCompanyButton.classList.toggle('button--primary', !hasSave);
    this.newCompanyButton.classList.toggle('button--secondary', hasSave);
    setText(this.message, message ?? '');
    this.message.hidden = message === null;
  }

  dispose(): void {
    this.root.remove();
  }
}

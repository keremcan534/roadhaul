import { COMPANY_NAME_MAX_LENGTH, type CompanyNameError } from '../../domain/company/companyName';
import { button, element } from '../dom';
import type { Strings } from '../i18n';

export interface NewCompanyActions {
  /** Returns why the name was refused, or null when the company was founded. */
  readonly onStart: (companyName: string) => CompanyNameError | null;
  readonly onBack: () => void;
}

/** Spec §41 step 1: the player names the company. */
export class NewCompanyDialog {
  private readonly overlay: HTMLDivElement;
  private readonly input: HTMLInputElement;
  private readonly error: HTMLParagraphElement;
  private readonly warning: HTMLParagraphElement;

  constructor(parent: HTMLElement, strings: Strings, actions: NewCompanyActions) {
    const document = parent.ownerDocument;
    this.overlay = element(document, 'div', 'screen new-company');
    this.overlay.dataset.screen = 'newCompany';
    this.overlay.hidden = true;
    const form = element(document, 'form', 'panel new-company__panel');
    form.noValidate = true;
    const label = element(document, 'label', 'new-company__label', strings.t('newCompany.label'));
    this.input = element(document, 'input', 'new-company__input');
    this.input.type = 'text';
    this.input.name = 'companyName';
    this.input.maxLength = COMPANY_NAME_MAX_LENGTH + 8; // Room for spaces that get trimmed.
    this.input.autocomplete = 'organization';
    this.input.spellcheck = false;
    this.input.placeholder = strings.t('newCompany.placeholder');
    this.input.enterKeyHint = 'go';
    label.append(this.input);
    this.error = element(document, 'p', 'new-company__error');
    this.error.setAttribute('role', 'alert');
    this.warning = element(document, 'p', 'new-company__warning', strings.t('newCompany.replaces'));
    const start = element(document, 'button', 'button button--primary', strings.t('newCompany.start'));
    start.type = 'submit';
    start.dataset.action = 'start-company';
    const buttons = element(document, 'div', 'new-company__buttons');
    buttons.append(button(document, 'button--ghost', strings.t('newCompany.back'), 'back', actions.onBack), start);
    form.append(element(document, 'h2', 'panel__title', strings.t('newCompany.title')), label, this.error, this.warning, buttons);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const problem = actions.onStart(this.input.value);
      this.error.textContent = problem === null ? '' : strings.t(`newCompany.error.${problem}`);
    });
    this.overlay.append(form);
    parent.append(this.overlay);
  }

  /** Opens the dialog; `replacesSave` warns that a saved company will be overwritten. */
  open(replacesSave: boolean): void {
    this.error.textContent = '';
    this.warning.hidden = !replacesSave;
    this.overlay.hidden = false;
    this.input.focus();
  }

  get isOpen(): boolean {
    return !this.overlay.hidden;
  }

  close(): void {
    this.input.blur();
    this.overlay.hidden = true;
  }

  dispose(): void {
    this.overlay.remove();
  }
}

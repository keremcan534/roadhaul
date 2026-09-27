import type { SaveSummary } from '../../domain/save/saveSummary';
import type { StartPlace, StartPlaceKind } from '../../domain/world/startPlaces';
import { brandMark, brandWordmark } from '../brand';
import { button, element, setText } from '../dom';
import { icon, withIcon } from '../icons';
import type { IconName } from '../iconShapes';
import type { Strings } from '../i18n';
import { select } from './choiceRow';

export interface MainMenuActions {
  /** Continues the saved company, starting at the place picked (its id: startPlaces). */
  readonly onContinue: (startId: string) => void;
  /** Founds a new company (the dialog asks its name), starting at the place picked. */
  readonly onNewCompany: (startId: string) => void;
  /** A place to start was picked: the truck is shown there behind the menu. */
  readonly onPreviewStart: (place: StartPlace) => void;
  /** Switches between Turkish and English. */
  readonly onSwitchLanguage: () => void;
  readonly onControls: () => void;
  readonly onSettings: () => void;
}

/** What the main menu shows. */
export interface MainMenuView {
  /** The saved company at a glance; null without one, or when it cannot be read (`message` says why). */
  readonly saved: SaveSummary | null;
  /** Where the saved company's truck is, in words ("At Ironford depot"); null without a saved company. */
  readonly truckWhere: string | null;
  /** The places a drive can start at, the one it starts at unless another is picked first. */
  readonly places: readonly StartPlace[];
  /** A contract is under way: the drive goes on from where the truck was left. */
  readonly startLocked: boolean;
  /** A load problem, or saving being off; null for none. */
  readonly message: string | null;
}

/** Each kind of start place's picture on its chip. */
const PLACE_ICONS: Readonly<Record<StartPlaceKind, IconName>> = { left: 'pin', home: 'home', depot: 'garage', restArea: 'fuel' };

/**
 * The title screen over the slowly circling camera. The brand's lockup and
 * motto; the saved company at a glance (its name and level, money, trucks,
 * drivers and deliveries, where its truck is and the contract under way);
 * where the drive starts (where the truck was left or the map's own start,
 * a depot or the rest area: the truck is shown there behind the menu), then
 * Continue (with a saved company) and New company; and the controls, the
 * settings and a language switch.
 */
export class MainMenu {
  private readonly root: HTMLDivElement;
  private readonly card: HTMLElement;
  private readonly cardName: HTMLHeadingElement;
  private readonly cardLevel: HTMLSpanElement;
  private readonly cardCredits: HTMLSpanElement;
  private readonly cardTrucks: HTMLSpanElement;
  private readonly cardDrivers: HTMLSpanElement;
  private readonly cardDeliveries: HTMLSpanElement;
  private readonly cardTruck: HTMLParagraphElement;
  private readonly cardContract: HTMLParagraphElement;
  private readonly places: HTMLDivElement;
  private readonly startNote: HTMLParagraphElement;
  private readonly continueButton: HTMLButtonElement;
  private readonly newCompanyButton: HTMLButtonElement;
  private readonly message: HTMLParagraphElement;
  private shownPlaces: readonly StartPlace[] = [];
  private placeButtons: HTMLButtonElement[] = [];
  private picked = 0;

  constructor(
    parent: HTMLElement,
    private readonly strings: Strings,
    private readonly actions: MainMenuActions,
  ) {
    const document = parent.ownerDocument;
    this.root = element(document, 'div', 'screen main-menu');
    this.root.dataset.screen = 'mainMenu';
    this.root.hidden = true;

    // The brand's lockup: the mark over the wordmark (drawings: the heading's name is the label).
    const brand = element(document, 'div', 'main-menu__brand');
    const logo = element(document, 'h1', 'main-menu__logo');
    logo.setAttribute('aria-label', 'RoadHaul');
    logo.append(brandMark(document, 'main-menu__mark'), brandWordmark(document, 'main-menu__wordmark'));
    brand.append(logo, element(document, 'p', 'main-menu__tagline', strings.t('menu.tagline')));

    // The saved company at a glance.
    this.card = element(document, 'section', 'main-menu__card');
    this.card.dataset.value = 'company-card';
    this.card.hidden = true;
    const head = element(document, 'div', 'main-menu__card-head');
    this.cardName = element(document, 'h2', 'main-menu__card-name');
    this.cardLevel = element(document, 'span', 'main-menu__card-level');
    head.append(this.cardName, this.cardLevel);
    const figures = element(document, 'p', 'main-menu__card-figures');
    const figure = (name: IconName, label: string): HTMLSpanElement => {
      const node = element(document, 'span', 'main-menu__figure');
      node.title = label;
      const value = element(document, 'span', 'main-menu__figure-value');
      node.append(icon(document, name, 'main-menu__figure-icon'), value);
      figures.append(node);
      return value;
    };
    this.cardCredits = figure('coins', strings.t('menu.card.credits'));
    this.cardTrucks = figure('truck', strings.t('menu.card.trucks'));
    this.cardDrivers = figure('fleet', strings.t('menu.card.drivers'));
    this.cardDeliveries = figure('jobs', strings.t('menu.card.deliveries'));
    this.cardTruck = element(document, 'p', 'main-menu__card-line');
    this.cardTruck.dataset.value = 'truck-where';
    this.cardContract = element(document, 'p', 'main-menu__card-line main-menu__card-contract');
    this.cardContract.dataset.value = 'contract';
    this.card.append(head, figures, this.cardTruck, this.cardContract);

    // Where the drive starts: a chip for each place.
    const start = element(document, 'div', 'main-menu__start');
    start.dataset.value = 'start-places';
    this.places = element(document, 'div', 'main-menu__places');
    this.places.setAttribute('role', 'radiogroup');
    this.places.setAttribute('aria-label', strings.t('menu.start'));
    this.startNote = element(document, 'p', 'main-menu__start-note', strings.t('menu.start.locked'));
    this.startNote.hidden = true;
    start.append(element(document, 'h3', 'main-menu__label', strings.t('menu.start')), this.places, this.startNote);

    this.continueButton = withIcon(
      button(document, 'button--primary main-menu__play', strings.t('menu.continue'), 'continue-game', () =>
        this.actions.onContinue(this.pickedId()),
      ),
      'play',
    );
    this.newCompanyButton = withIcon(
      button(document, 'button--primary main-menu__play', strings.t('menu.newCompany'), 'new-company', () =>
        this.actions.onNewCompany(this.pickedId()),
      ),
      'plus',
    );
    const play = element(document, 'div', 'main-menu__buttons');
    play.append(this.continueButton, this.newCompanyButton);
    this.message = element(document, 'p', 'main-menu__message');
    const small = element(document, 'div', 'main-menu__small');
    small.append(
      withIcon(button(document, 'button--ghost main-menu__language', strings.t('menu.controls'), 'controls', actions.onControls), 'controls'),
      withIcon(button(document, 'button--ghost main-menu__language', strings.t('menu.settings'), 'settings', actions.onSettings), 'settings'),
      button(document, 'button--ghost main-menu__language', strings.t('menu.language'), 'switch-language', actions.onSwitchLanguage),
    );

    const side = element(document, 'div', 'main-menu__side');
    side.append(brand, this.card);
    const main = element(document, 'div', 'main-menu__main');
    main.append(start, play, this.message, small);
    this.root.append(side, main);
    parent.append(this.root);
  }

  set visible(visible: boolean) {
    this.root.hidden = !visible;
  }

  /**
   * Shows `view`: the saved company's card and Continue only with one (New
   * company is then secondary), the places to start at with the first
   * picked (the truck is shown there), and the message when there is one.
   */
  update(view: MainMenuView): void {
    const { saved, truckWhere, places, startLocked, message } = view;
    this.card.hidden = saved === null;
    if (saved !== null) {
      const { strings } = this;
      setText(this.cardName, saved.companyName);
      setText(this.cardLevel, strings.t('menu.card.level', { level: saved.level }));
      setText(this.cardCredits, strings.money(saved.credits));
      setText(this.cardTrucks, strings.number(saved.trucks));
      setText(this.cardDrivers, strings.number(saved.drivers));
      setText(this.cardDeliveries, strings.number(saved.deliveries));
      setText(this.cardTruck, `${strings.vehicleName(saved.truckModelId)} · ${truckWhere ?? ''}`);
      const contract = saved.contract;
      this.cardContract.hidden = contract === null;
      if (contract !== null) {
        setText(
          this.cardContract,
          strings.t('menu.card.contract', {
            cargo: strings.cargoName(contract.cargoId),
            from: strings.cityName(contract.originCityId),
            to: strings.cityName(contract.destinationCityId),
          }),
        );
      }
    }
    this.continueButton.hidden = saved === null;
    this.newCompanyButton.classList.toggle('button--primary', saved === null);
    this.newCompanyButton.classList.toggle('button--secondary', saved !== null);
    setText(this.message, message ?? '');
    this.message.hidden = message === null;
    this.showPlaces(places, startLocked);
  }

  dispose(): void {
    this.root.remove();
  }

  /** A chip for each place, the first picked; with the start locked, only the first can be. */
  private showPlaces(places: readonly StartPlace[], locked: boolean): void {
    const document = this.root.ownerDocument;
    this.shownPlaces = places;
    this.placeButtons = places.map((place, index) => {
      const chip = button(document, 'main-menu__place', '', 'start-place', () => this.pick(index));
      chip.setAttribute('role', 'radio');
      chip.dataset.start = place.id;
      chip.dataset.kind = place.kind;
      chip.disabled = locked && index > 0;
      chip.append(icon(document, PLACE_ICONS[place.kind], 'main-menu__place-icon'), element(document, 'span', '', this.placeName(place)));
      return chip;
    });
    this.places.replaceChildren(...this.placeButtons);
    this.startNote.hidden = !locked;
    this.pick(0);
  }

  private pick(index: number): void {
    const place = this.shownPlaces[index];
    if (place === undefined) {
      return;
    }
    this.picked = index;
    this.placeButtons.forEach((chip, candidate) => select(chip, candidate === index));
    this.actions.onPreviewStart(place);
  }

  private pickedId(): string {
    return this.shownPlaces[this.picked]?.id ?? 'left';
  }

  /** What a place is called on its chip: where the truck was left, home, a city's depot, the rest area. */
  private placeName(place: StartPlace): string {
    const { strings } = this;
    const city = place.cityId === null ? '' : strings.cityName(place.cityId);
    switch (place.kind) {
      case 'left':
        return strings.t('menu.start.left');
      case 'home':
        return strings.t('menu.start.home', { city });
      case 'depot':
        return strings.t('depot.name', { city });
      case 'restArea':
        return strings.t('menu.start.restArea');
    }
  }
}

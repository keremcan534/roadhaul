import { LANGUAGE_NAMES } from '../../data/config/languages';
import type { SaveSummary } from '../../domain/save/saveSummary';
import type { StartPlace, StartPlaceKind } from '../../domain/world/startPlaces';
import { brandMark, brandWordmark } from '../brand';
import { button, element, setText } from '../dom';
import { icon, withIcon } from '../icons';
import type { IconName } from '../iconShapes';
import type { Strings } from '../i18n';
import { select } from './choiceRow';

export interface MainMenuActions {
  /**
   * Continues the saved company, starting at the place picked (its id:
   * startPlaces), or crossing to region `regionId` (a map id) when that was
   * picked.
   */
  readonly onContinue: (startId: string, regionId: string | null) => void;
  /** Founds a new company (the dialog asks its name), starting at the place picked, or in the region picked. */
  readonly onNewCompany: (startId: string, regionId: string | null) => void;
  /** A place to start was picked: the truck is shown there behind the menu. */
  readonly onPreviewStart: (place: StartPlace) => void;
  /** Opens the settings at the language list. */
  readonly onLanguage: () => void;
  readonly onControls: () => void;
  readonly onSettings: () => void;
  /** The shop: shown only where purchases can be made (shopVisible). */
  readonly onShop: () => void;
  /** Starts the earnings boost (after its ad): offered only when it can be (earningsBoost). */
  readonly onEarningsBoost: () => void;
  /** Opens the map on the place picked (the truck is shown there). */
  readonly onMap: () => void;
}

/** The earnings boost, as the main menu offers it. */
export interface EarningsBoostView {
  /** Its share of the pay, as the language writes a percentage, and how long it lasts. */
  readonly percent: string;
  readonly minutes: number;
  /** Minutes it has left; 0 when it is not on. */
  readonly minutesLeft: number;
  /** It can be started now; and whether an ad comes first (none once ads are removed). */
  readonly offered: boolean;
  readonly withAd: boolean;
}

/** Another region a drive can start in, over the water (its ferry). */
export interface MenuRegion {
  /** Its map id. */
  readonly mapId: string;
  /**
   * The company level the saved company needs to cross to it, while it has
   * not reached it; null when it can (and for a new company, which can start
   * there at once).
   */
  readonly lockedUntilLevel: number | null;
}

/** What the main menu shows. */
export interface MainMenuView {
  /** The saved company at a glance; null without one, or when it cannot be read (`message` says why). */
  readonly saved: SaveSummary | null;
  /** Where the saved company's truck is, in words ("At Ironford depot"); null without a saved company. */
  readonly truckWhere: string | null;
  /** The places a drive can start at, the one it starts at unless another is picked first. */
  readonly places: readonly StartPlace[];
  /** The other regions, after the places: the saved company crosses there, a new company starts there. */
  readonly regions: readonly MenuRegion[];
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
 * settings and the language (its own name under a globe: the settings'
 * language list).
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
  private readonly shopButton: HTMLButtonElement;
  /** The earnings boost: its button while it can be started, its time left while it is on. */
  private readonly boostButton: HTMLButtonElement;
  private readonly boostLabel: HTMLSpanElement;
  private readonly boostNote: HTMLParagraphElement;
  private shownPlaces: readonly StartPlace[] = [];
  private shownRegions: readonly MenuRegion[] = [];
  private placeButtons: HTMLButtonElement[] = [];
  private hasSaved = false;
  /** A contract is under way: only the first place can be picked. */
  private startLocked = false;
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
    // Its label, and beside it the map, on the place picked: where the depots, the rest area and home lie.
    const startHead = element(document, 'div', 'main-menu__start-head');
    startHead.append(
      element(document, 'h3', 'main-menu__label', strings.t('menu.start')),
      withIcon(button(document, 'button--ghost main-menu__map', strings.t('menu.start.map'), 'menu-map', () => actions.onMap()), 'map'),
    );
    start.append(startHead, this.places, this.startNote);

    this.continueButton = withIcon(
      button(document, 'button--primary main-menu__play', strings.t('menu.continue'), 'continue-game', () =>
        this.actions.onContinue(this.pickedId(), this.pickedRegion()?.mapId ?? null),
      ),
      'play',
    );
    this.newCompanyButton = withIcon(
      button(document, 'button--primary main-menu__play', strings.t('menu.newCompany'), 'new-company', () =>
        this.actions.onNewCompany(this.pickedId(), this.pickedRegion()?.mapId ?? null),
      ),
      'plus',
    );
    this.boostButton = withIcon(
      button(document, 'button--secondary main-menu__boost', '', 'earnings-boost', () => this.actions.onEarningsBoost()),
      'play',
    );
    this.boostLabel = element(document, 'span', 'main-menu__boost-label');
    this.boostButton.append(this.boostLabel);
    this.boostButton.hidden = true;
    this.boostNote = element(document, 'p', 'main-menu__boost-note');
    this.boostNote.hidden = true;
    const play = element(document, 'div', 'main-menu__buttons');
    play.append(this.continueButton, this.newCompanyButton, this.boostButton, this.boostNote);
    this.message = element(document, 'p', 'main-menu__message');
    const small = element(document, 'div', 'main-menu__small');
    this.shopButton = withIcon(button(document, 'button--ghost main-menu__language', strings.t('menu.shop'), 'shop', actions.onShop), 'coins');
    this.shopButton.hidden = true;
    small.append(
      withIcon(button(document, 'button--ghost main-menu__language', strings.t('menu.controls'), 'controls', actions.onControls), 'controls'),
      withIcon(button(document, 'button--ghost main-menu__language', strings.t('menu.settings'), 'settings', actions.onSettings), 'settings'),
      this.shopButton,
      this.languageButton(document, strings, actions),
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

  /** The shop's button, once the store is up (the Android app with Google Play; never the web game). */
  set shopVisible(visible: boolean) {
    this.shopButton.hidden = !visible;
  }

  /** The earnings boost: offered (after an ad, or none), on with its time left, or neither (nothing shown). */
  set earningsBoost(boost: EarningsBoostView) {
    const { strings } = this;
    const on = boost.minutesLeft > 0;
    this.boostButton.hidden = on || !boost.offered;
    this.boostNote.hidden = !on;
    if (!this.boostButton.hidden) {
      const label = strings.t(boost.withAd ? 'menu.boost.offer' : 'menu.boost.offerFree', { percent: boost.percent, minutes: boost.minutes });
      setText(this.boostLabel, label);
    }
    if (on) {
      setText(this.boostNote, strings.t('menu.boost.on', { percent: boost.percent, minutes: boost.minutesLeft }));
    }
  }

  /**
   * Shows `view`: the saved company's card and Continue only with one (New
   * company is then secondary), the places to start at with the first
   * picked (the truck is shown there), and the message when there is one.
   */
  update(view: MainMenuView): void {
    const { saved, truckWhere, places, regions, startLocked, message } = view;
    this.hasSaved = saved !== null;
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
    this.showPlaces(places, regions, startLocked);
  }

  dispose(): void {
    this.root.remove();
  }

  /**
   * A chip for each place, then for each region over the water, the first
   * picked; with the start locked, only the first can be.
   */
  private showPlaces(places: readonly StartPlace[], regions: readonly MenuRegion[], locked: boolean): void {
    const document = this.root.ownerDocument;
    this.shownPlaces = places;
    this.shownRegions = regions;
    this.startLocked = locked;
    const chip = (index: number, iconName: IconName, name: string): HTMLButtonElement => {
      const node = button(document, 'main-menu__place', '', 'start-place', () => this.pick(index));
      node.setAttribute('role', 'radio');
      node.disabled = locked && index > 0;
      node.append(icon(document, iconName, 'main-menu__place-icon'), element(document, 'span', '', name));
      return node;
    };
    this.placeButtons = places.map((place, index) => {
      const node = chip(index, PLACE_ICONS[place.kind], this.placeName(place));
      node.dataset.start = place.id;
      node.dataset.kind = place.kind;
      return node;
    });
    regions.forEach((region, index) => {
      const node = chip(places.length + index, 'route', this.strings.t(`region.${region.mapId}.name`));
      node.dataset.start = 'region';
      node.dataset.kind = 'region';
      node.dataset.region = region.mapId;
      this.placeButtons.push(node);
    });
    this.places.replaceChildren(...this.placeButtons);
    this.pick(0);
  }

  /**
   * Picks the chip at `index`: a place (the truck is shown there) or a
   * region. A region the saved company cannot cross to yet keeps Continue
   * off, and says when it opens (a new company can start there at once).
   */
  private pick(index: number): void {
    const place = this.shownPlaces[index];
    const region = this.shownRegions[index - this.shownPlaces.length];
    if (place === undefined && region === undefined) {
      return;
    }
    this.picked = index;
    this.placeButtons.forEach((chip, candidate) => select(chip, candidate === index));
    if (place !== undefined) {
      this.actions.onPreviewStart(place);
    }
    const lockedLevel = this.hasSaved ? (region?.lockedUntilLevel ?? null) : null;
    this.continueButton.disabled = lockedLevel !== null;
    if (region !== undefined && lockedLevel !== null) {
      const name = this.strings.t(`region.${region.mapId}.name`);
      setText(this.startNote, `${this.strings.t('ferry.locked', { region: name, level: lockedLevel })} ${this.strings.t('menu.start.regionNew')}`);
    } else {
      setText(this.startNote, this.strings.t('menu.start.locked'));
    }
    this.startNote.hidden = !this.startLocked && lockedLevel === null;
  }

  private pickedId(): string {
    return this.shownPlaces[this.picked]?.id ?? 'left';
  }

  /** The region picked, when a region's chip is. */
  private pickedRegion(): MenuRegion | null {
    return this.shownRegions[this.picked - this.shownPlaces.length] ?? null;
  }

  /** The language button: the language spoken now, named in itself, with a globe; it opens the language list. */
  private languageButton(document: Document, strings: Strings, actions: MainMenuActions): HTMLButtonElement {
    const name = LANGUAGE_NAMES[strings.language];
    const node = withIcon(button(document, 'button--ghost main-menu__language', name, 'language', actions.onLanguage), 'language');
    node.setAttribute('aria-label', `${strings.t('menu.language')}: ${name}`);
    node.lang = strings.language;
    return node;
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

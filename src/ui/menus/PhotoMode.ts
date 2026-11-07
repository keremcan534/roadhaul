import { button, element } from '../dom';
import type { Strings } from '../i18n';
import { icon, withIcon } from '../icons';
import { PHOTO_FILTER_IDS, photoCssFilter, photoVignette, type PhotoFilterId } from '../photo/photoFilters';

/** What became of a picture taken: shared (the share sheet), saved (downloaded), the share sheet closed, or none taken. */
export type PhotoOutcome = 'shared' | 'saved' | 'cancelled' | 'failed';

export interface PhotoModeActions {
  /** A drag across the picture, so many pixels right and down: the camera goes round the truck. */
  readonly onOrbit: (dxPixels: number, dyPixels: number) => void;
  /** A pinch or the wheel: nearer under 1, farther over 1. */
  readonly onZoom: (factor: number) => void;
  /** The look picked, as a CSS filter for the game's canvas ('none' for none). */
  readonly onLook: (cssFilter: string) => void;
  /** The shutter: the picture in the look picked, taken and handed on. */
  readonly onShoot: (filter: PhotoFilterId) => Promise<PhotoOutcome>;
  /** The back button: the entry point closes photo mode (close()) and goes back to the pause menu. */
  readonly onClose: () => void;
}

/** The wheel's zoom: a factor of e per this many pixels scrolled. */
const WHEEL_PIXELS_PER_E = 600;

/**
 * Photo mode, over the paused road: nothing on the screen but the picture
 * (html[data-photo] hides the rest), a back button, a row of looks and the
 * shutter. A drag turns the camera round the truck, a pinch or the wheel
 * brings it nearer; the look shows on the canvas as picked, its darkened
 * corners over it. The shutter flashes, and a line says where the picture
 * went.
 */
export class PhotoMode {
  private readonly overlay: HTMLDivElement;
  private readonly vignette: HTMLDivElement;
  private readonly flash: HTMLDivElement;
  private hint: HTMLParagraphElement;
  private readonly statusLine: HTMLDivElement;
  private readonly shutter: HTMLButtonElement;
  private readonly looks: HTMLButtonElement[];
  private filter: PhotoFilterId = 'natural';
  private busy = false;
  /** The fingers (or the mouse) on the picture, at most two: their pointer ids (-1 for none) and where they are. */
  private firstId = -1;
  private firstX = 0;
  private firstY = 0;
  private secondId = -1;
  private secondX = 0;
  private secondY = 0;

  constructor(
    parent: HTMLElement,
    private readonly strings: Strings,
    private readonly actions: PhotoModeActions,
  ) {
    const document = parent.ownerDocument;
    this.overlay = element(document, 'div', 'photo-mode');
    this.overlay.dataset.screen = 'photo';
    this.overlay.hidden = true;
    this.vignette = element(document, 'div', 'photo-mode__vignette');
    const stage = element(document, 'div', 'photo-mode__stage');
    this.flash = element(document, 'div', 'photo-mode__flash');
    this.flash.addEventListener('animationend', () => this.flash.classList.remove('is-flashing'));
    this.hint = element(document, 'p', 'photo-mode__hint', strings.t('photo.hint'));
    this.statusLine = element(document, 'div', 'photo-mode__status');
    this.statusLine.setAttribute('role', 'status');

    const back = withIcon(button(document, 'button--secondary photo-mode__back', strings.t('photo.close'), 'photo-close', actions.onClose), 'close');
    const top = element(document, 'div', 'photo-mode__top');
    top.append(back, element(document, 'h2', 'photo-mode__title', strings.t('photo.title')));

    const lookRow = element(document, 'div', 'photo-mode__looks');
    lookRow.setAttribute('role', 'radiogroup');
    lookRow.setAttribute('aria-label', strings.t('photo.looks'));
    this.looks = PHOTO_FILTER_IDS.map((id) => {
      const look = button(document, 'photo-mode__look', strings.t(`photo.filter.${id}`), 'photo-filter', () => this.pick(id));
      look.setAttribute('role', 'radio');
      look.dataset.filter = id;
      lookRow.append(look);
      return look;
    });
    this.shutter = button(document, 'photo-mode__shutter', '', 'photo-shoot', () => this.shoot());
    this.shutter.setAttribute('aria-label', strings.t('photo.shoot'));
    this.shutter.append(icon(document, 'photo', 'photo-mode__shutter-icon'));
    const bottom = element(document, 'div', 'photo-mode__bottom');
    bottom.append(lookRow, this.shutter);

    this.overlay.append(this.vignette, stage, this.flash, top, this.hint, this.statusLine, bottom);
    parent.append(this.overlay);
    this.showLook();

    stage.addEventListener('pointerdown', (event) => this.down(event, stage));
    stage.addEventListener('pointermove', (event) => this.move(event));
    stage.addEventListener('pointerup', (event) => this.up(event));
    stage.addEventListener('pointercancel', (event) => this.up(event));
    stage.addEventListener(
      'wheel',
      (event) => {
        event.preventDefault();
        actions.onZoom(Math.exp(event.deltaY / WHEEL_PIXELS_PER_E));
      },
      { passive: false },
    );
  }

  get isOpen(): boolean {
    return !this.overlay.hidden;
  }

  /** Shows photo mode in the look last picked, the hint again. */
  open(): void {
    this.firstId = -1;
    this.secondId = -1;
    this.statusLine.replaceChildren();
    // A new hint each time: its showing-and-fading animation runs anew.
    const hint = element(this.overlay.ownerDocument, 'p', 'photo-mode__hint', this.strings.t('photo.hint'));
    this.hint.replaceWith(hint);
    this.hint = hint;
    this.overlay.hidden = false;
    this.actions.onLook(photoCssFilter(this.filter));
  }

  close(): void {
    this.overlay.hidden = true;
    this.actions.onLook('none');
  }

  dispose(): void {
    this.overlay.remove();
  }

  private pick(id: PhotoFilterId): void {
    this.filter = id;
    this.showLook();
    this.actions.onLook(photoCssFilter(id));
  }

  private showLook(): void {
    PHOTO_FILTER_IDS.forEach((id, index) => {
      const look = this.looks[index]!;
      look.classList.toggle('is-selected', id === this.filter);
      look.setAttribute('aria-checked', String(id === this.filter));
    });
    this.overlay.dataset.filter = this.filter;
    this.vignette.style.opacity = String(photoVignette(this.filter));
  }

  private shoot(): void {
    if (this.busy) {
      return;
    }
    this.busy = true;
    this.shutter.disabled = true;
    this.flash.classList.remove('is-flashing');
    // The flash starts over on the next style change: a class added in the same frame it was taken away would not.
    void this.flash.offsetWidth;
    this.flash.classList.add('is-flashing');
    this.actions
      .onShoot(this.filter)
      .catch((): PhotoOutcome => 'failed')
      .then((outcome) => {
        this.overlay.dataset.outcome = outcome;
        if (outcome !== 'cancelled') {
          // A new line each time: its showing-and-fading animation runs anew.
          const line = element(this.overlay.ownerDocument, 'p', `photo-mode__message is-${outcome}`, this.strings.t(`photo.${outcome}`));
          this.statusLine.replaceChildren(line);
        }
      })
      .finally(() => {
        this.busy = false;
        this.shutter.disabled = false;
      });
  }

  private down(event: PointerEvent, stage: HTMLElement): void {
    if (this.firstId < 0) {
      this.firstId = event.pointerId;
      this.firstX = event.clientX;
      this.firstY = event.clientY;
    } else if (this.secondId < 0 && event.pointerId !== this.firstId) {
      this.secondId = event.pointerId;
      this.secondX = event.clientX;
      this.secondY = event.clientY;
    } else {
      return;
    }
    stage.setPointerCapture(event.pointerId);
    this.hint.hidden = true;
  }

  private move(event: PointerEvent): void {
    const x = event.clientX;
    const y = event.clientY;
    if (event.pointerId === this.firstId) {
      if (this.secondId < 0) {
        this.actions.onOrbit(x - this.firstX, y - this.firstY);
        this.firstX = x;
        this.firstY = y;
        return;
      }
      const before = Math.sqrt((this.secondX - this.firstX) ** 2 + (this.secondY - this.firstY) ** 2);
      this.firstX = x;
      this.firstY = y;
      this.pinched(before);
    } else if (event.pointerId === this.secondId) {
      const before = Math.sqrt((this.secondX - this.firstX) ** 2 + (this.secondY - this.firstY) ** 2);
      this.secondX = x;
      this.secondY = y;
      this.pinched(before);
    }
  }

  /** Two fingers moved apart (nearer) or together (farther) from `before` pixels apart. */
  private pinched(before: number): void {
    const after = Math.sqrt((this.secondX - this.firstX) ** 2 + (this.secondY - this.firstY) ** 2);
    if (before > 1 && after > 1) {
      this.actions.onZoom(before / after);
    }
  }

  private up(event: PointerEvent): void {
    if (event.pointerId === this.firstId) {
      // The other finger, if one is down, turns the camera from now on.
      this.firstId = this.secondId;
      this.firstX = this.secondX;
      this.firstY = this.secondY;
      this.secondId = -1;
    } else if (event.pointerId === this.secondId) {
      this.secondId = -1;
    }
  }
}

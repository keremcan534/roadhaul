/** The smallest a label is made to fit its box (of its size): smaller would be hard to read. */
const MIN_FIT = 0.7;

/**
 * Keeps a row of short labels (tab names, the dock's buttons) whole: a label
 * too wide for its box (a long word in some languages: "Événements",
 * "Perusahaan") is made smaller until it fits, rather than cut short. Its CSS
 * multiplies its font size by the `--fit` custom property this sets, and keeps
 * an ellipsis for a label that still cannot fit at the smallest size.
 *
 * Fits again when the container changes width (the phone turned, a layout
 * switched) and on `refit()`. Reads the layout: on those occasions, never per
 * frame. A label's size never changes its container's width, so fitting never
 * calls for fitting again.
 */
export class LabelFitter {
  /** The container's width when the labels were last fitted to it (-1: not yet). */
  private fittedWidth = -1;
  private readonly observer: ResizeObserver | null = null;

  constructor(
    private readonly container: HTMLElement,
    private readonly labels: readonly HTMLElement[],
  ) {
    const view = container.ownerDocument.defaultView;
    if (view !== null && typeof view.ResizeObserver === 'function') {
      this.observer = new view.ResizeObserver(() => this.fit(false));
      this.observer.observe(container);
    }
  }

  /** Fits the labels again, whatever the container's width: their boxes changed without it (the row's buttons changed). */
  refit(): void {
    this.fit(true);
  }

  dispose(): void {
    this.observer?.disconnect();
  }

  private fit(force: boolean): void {
    const width = this.container.clientWidth;
    // Hidden (no width), or fitted to this width already.
    if (width === 0 || (!force && width === this.fittedWidth)) {
      return;
    }
    this.fittedWidth = width;
    for (const label of this.labels) {
      label.style.removeProperty('--fit');
    }
    // The text's own width against its box's, in fractions of a pixel (a label a hair too wide is cut short too);
    // every label measured before any changes, so the page is laid out once for them all. Glyphs do not shrink
    // exactly with the font: 2% to spare, and a label still too wide is taken down a little more.
    const range = this.container.ownerDocument.createRange();
    const overflow = (label: HTMLElement): number => {
      const box = label.getBoundingClientRect().width;
      if (box === 0) {
        return 0; // Not shown in this layout.
      }
      range.selectNodeContents(label);
      return range.getBoundingClientRect().width / box;
    };
    let fits = this.labels.map((label) => {
      const ratio = overflow(label);
      return ratio > 1.001 ? Math.floor((0.98 / ratio) * 100) / 100 : 1;
    });
    for (let pass = 0; pass < 3 && fits.some((fit) => fit < 1); pass++) {
      this.labels.forEach((label, index) => {
        const fit = Math.max(MIN_FIT, fits[index] ?? 1);
        if (fit < 1) {
          label.style.setProperty('--fit', String(fit));
        }
      });
      fits = this.labels.map((label, index) => {
        const fit = Math.max(MIN_FIT, fits[index] ?? 1);
        return fit < 1 && fit > MIN_FIT && overflow(label) > 1.001 ? fit - 0.03 : 1;
      });
    }
  }
}

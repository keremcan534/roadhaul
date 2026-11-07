/**
 * The boxes the map's names take on the screen, as they are placed: a name
 * that would cover one placed before it is left out (or moved), so two names
 * never run into each other. Fixed capacity; allocation-free after
 * construction, so the full map can place its names on every repaint.
 */
export class LabelSpace {
  /** minX, minY, maxX, maxY of each box taken, screen px. */
  private readonly boxes: Float64Array;
  private count = 0;

  constructor(private readonly capacity: number) {
    this.boxes = new Float64Array(Math.max(0, capacity) * 4);
  }

  /** How many boxes are taken. */
  get size(): number {
    return this.count;
  }

  /** Frees every box, for the next paint. */
  clear(): void {
    this.count = 0;
  }

  /** Whether the box minX..maxX, minY..maxY (screen px) is clear of every box taken. */
  isFree(minX: number, minY: number, maxX: number, maxY: number): boolean {
    const boxes = this.boxes;
    for (let i = 0; i < this.count * 4; i += 4) {
      if (minX < boxes[i + 2]! && maxX > boxes[i]! && minY < boxes[i + 3]! && maxY > boxes[i + 1]!) {
        return false;
      }
    }
    return true;
  }

  /** Takes the box. Past the capacity it is not kept: a later name may then cover it. */
  take(minX: number, minY: number, maxX: number, maxY: number): void {
    if (this.count >= this.capacity) {
      return;
    }
    const at = this.count * 4;
    this.boxes[at] = minX;
    this.boxes[at + 1] = minY;
    this.boxes[at + 2] = maxX;
    this.boxes[at + 3] = maxY;
    this.count++;
  }

  /** Takes the box if it is free; whether it was. */
  tryTake(minX: number, minY: number, maxX: number, maxY: number): boolean {
    if (!this.isFree(minX, minY, maxX, maxY)) {
      return false;
    }
    this.take(minX, minY, maxX, maxY);
    return true;
  }
}

/**
 * The middle of a label reaching `half` px each side of it, as near `x` as
 * keeps it inside 0..`width`, screen px (in the middle if it is wider).
 */
export function keptInside(x: number, half: number, width: number): number {
  if (2 * half >= width) {
    return width / 2;
  }
  return Math.min(Math.max(x, half), width - half);
}

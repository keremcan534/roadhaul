import { SeededRandom } from '../../core/random/SeededRandom';

/** What turning a card did. */
export type MemoryFlip = 'first' | 'pair' | 'miss' | 'ignored';

/**
 * The cab tablet's memory game (the owner's card games for auto-drive): a
 * deck of pairs face down, dealt from a seed; turn two at a time, a pair
 * stays up, two that differ go back down (`hideMiss`, after the player has
 * seen them). Won when every pair is up. A turn is two cards turned.
 */
export class MemoryGame {
  /** Each card's face: a number from 0 to pairs − 1, each twice. */
  readonly faces: readonly number[];
  /** 1 for a card face up (turned or paired), else 0. */
  readonly up: Uint8Array;
  /** 1 for a card in a pair found. */
  readonly paired: Uint8Array;
  private first = -1;
  /** The two cards of a miss, showing until hidden. */
  private missA = -1;
  private missB = -1;
  private turnsValue = 0;
  private pairsValue = 0;

  constructor(pairs: number, seed: number) {
    if (!Number.isInteger(pairs) || pairs < 1) {
      throw new Error(`A memory game needs pairs, not ${pairs}.`);
    }
    const faces: number[] = [];
    for (let face = 0; face < pairs; face++) {
      faces.push(face, face);
    }
    // Shuffled the same way for the same seed (Fisher–Yates).
    const random = new SeededRandom(seed);
    for (let i = faces.length - 1; i > 0; i--) {
      const j = random.int(0, i);
      [faces[i], faces[j]] = [faces[j]!, faces[i]!];
    }
    this.faces = faces;
    this.up = new Uint8Array(faces.length);
    this.paired = new Uint8Array(faces.length);
  }

  /** Pairs in the deck. */
  get pairs(): number {
    return this.faces.length / 2;
  }

  get pairsFound(): number {
    return this.pairsValue;
  }

  /** Two cards turned, a pair or not. */
  get turns(): number {
    return this.turnsValue;
  }

  get won(): boolean {
    return this.pairsValue === this.pairs;
  }

  /** Two different cards are showing, waiting to go back down (hideMiss). */
  get missShowing(): boolean {
    return this.missA >= 0;
  }

  /**
   * Turns card `index`: the first of two ('first'), the second making a
   * pair ('pair') or not ('miss': both stay up until hideMiss). A card
   * already up, out of the deck, or turned while a miss shows, does nothing
   * ('ignored').
   */
  flip(index: number): MemoryFlip {
    if (!Number.isInteger(index) || index < 0 || index >= this.faces.length || this.up[index] === 1 || this.missA >= 0 || this.won) {
      return 'ignored';
    }
    this.up[index] = 1;
    if (this.first < 0) {
      this.first = index;
      return 'first';
    }
    const first = this.first;
    this.first = -1;
    this.turnsValue++;
    if (this.faces[first] === this.faces[index]) {
      this.paired[first] = 1;
      this.paired[index] = 1;
      this.pairsValue++;
      return 'pair';
    }
    this.missA = first;
    this.missB = index;
    return 'miss';
  }

  /** The two cards of a miss go back down. */
  hideMiss(): void {
    if (this.missA < 0) {
      return;
    }
    this.up[this.missA] = 0;
    this.up[this.missB] = 0;
    this.missA = -1;
    this.missB = -1;
  }
}

import { err, ok, type Result } from '../../core/Result';
import type { Credits } from '../../data/units';

export type SpendError = 'insufficientFunds';

/**
 * The company's credits (spec §13, §51 CurrencyWallet). Only whole,
 * non-negative amounts move: anything else is a bug and throws. Not having
 * enough money is an expected outcome and comes back as a Result.
 */
export class CurrencyWallet {
  private credits: Credits;

  constructor(initial: Credits = 0) {
    assertCredits(initial, 'initial balance');
    this.credits = initial;
  }

  get balance(): Credits {
    return this.credits;
  }

  canAfford(amount: Credits): boolean {
    assertCredits(amount, 'amount');
    return amount <= this.credits;
  }

  add(amount: Credits): void {
    assertCredits(amount, 'amount');
    this.credits += amount;
  }

  spend(amount: Credits): Result<Credits, SpendError> {
    if (!this.canAfford(amount)) {
      return err('insufficientFunds');
    }
    this.credits -= amount;
    return ok(this.credits);
  }

  /** Replaces the balance, e.g. when a saved game is loaded. */
  reset(balance: Credits): void {
    assertCredits(balance, 'balance');
    this.credits = balance;
  }
}

function assertCredits(amount: Credits, what: string): void {
  if (!Number.isSafeInteger(amount) || amount < 0) {
    throw new RangeError(`The ${what} must be a whole number of credits, 0 or more; got ${amount}.`);
  }
}

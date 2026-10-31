import type { EventBus } from '../../core/events/EventBus';
import type { Logger } from '../../core/logging/Logger';
import { err, ok, type Result } from '../../core/Result';
import type { GameConfig } from '../../data/config/GameConfig';
import type { Credits } from '../../data/units';
import { drawSymbol, REEL_COUNT, slotPayout, slotWin, type SlotWin } from '../../domain/casino/slotMachine';
import type { SpendError } from '../../domain/economy/CurrencyWallet';
import type { EconomyService } from '../economy/EconomyService';
import type { GameEvents } from '../GameEvents';

export type SpinError = 'unknownBet' | SpendError;

/** One spin of the slot machine. */
export interface SlotSpin {
  readonly bet: Credits;
  /** Each reel's symbol, an index into GameConfig.casino.symbols. */
  readonly reels: readonly number[];
  readonly win: SlotWin;
  /** What it paid (the bet back included); 0 for nothing. */
  readonly payout: Credits;
}

/**
 * The truck stop's slot machine (GameConfig.casino): a spin takes the bet
 * from the company's credits and pays what its line wins. Credits only:
 * never real money, and credits are never sold. The odds are the config's,
 * honest and the same on every spin (`slotOdds` works out the return); the
 * reels show the line drawn. It keeps what this sitting has won or lost,
 * for the player to see.
 */
export class CasinoService {
  private net = 0;
  private spins = 0;

  constructor(
    private readonly config: GameConfig['casino'],
    private readonly economy: EconomyService,
    /** Uniform in [0, 1): a seeded generator in tests. */
    private readonly random: () => number,
    private readonly events: EventBus<GameEvents>,
    private readonly logger: Logger,
  ) {}

  get bets(): readonly Credits[] {
    return this.config.bets;
  }

  /** Credits won (above 0) or lost (below) since the game started. */
  get sessionNet(): Credits {
    return this.net;
  }

  get sessionSpins(): number {
    return this.spins;
  }

  /** Spins the reels for `bet`, one of the bets on offer, paying it first. */
  spin(bet: Credits): Result<SlotSpin, SpinError> {
    if (!this.config.bets.includes(bet)) {
      return err('unknownBet');
    }
    const paid = this.economy.spend(bet, 'casino');
    if (!paid.ok) {
      return err(paid.error);
    }
    const reels: number[] = [];
    for (let reel = 0; reel < REEL_COUNT; reel++) {
      reels.push(drawSymbol(this.config.symbols, this.random()));
    }
    const win = slotWin(this.config.symbols, reels);
    const payout = slotPayout(win, bet);
    this.economy.earn(payout, 'casino');
    this.net += payout - bet;
    this.spins += 1;
    this.logger.info(`Slot: bet ${bet}, ${reels.join('-')}, paid ${payout}.`);
    this.events.emit('SlotSpun', { bet, payout, kind: win.kind, multiplier: win.multiplier });
    return ok({ bet, reels, win, payout });
  }
}

import { describe, expect, it } from 'vitest';
import { CurrencyWallet } from '../../../../src/domain/economy/CurrencyWallet';
import { fuelCost, repairCost } from '../../../../src/domain/economy/costs';

describe('CurrencyWallet', () => {
  it('adds and spends whole credits', () => {
    const wallet = new CurrencyWallet(1000);

    wallet.add(250);
    expect(wallet.spend(400)).toEqual({ ok: true, value: 850 });
    expect(wallet.balance).toBe(850);
  });

  it('refuses to spend more than it holds, leaving the balance alone', () => {
    const wallet = new CurrencyWallet(100);

    expect(wallet.canAfford(100)).toBe(true);
    expect(wallet.canAfford(101)).toBe(false);
    expect(wallet.spend(101)).toEqual({ ok: false, error: 'insufficientFunds' });
    expect(wallet.balance).toBe(100);
  });

  it('treats negative, fractional or unsafe amounts as bugs', () => {
    const wallet = new CurrencyWallet();

    expect(() => wallet.add(-5)).toThrow(RangeError);
    expect(() => wallet.add(2.5)).toThrow(RangeError);
    expect(() => wallet.spend(Number.NaN)).toThrow(RangeError);
    expect(() => new CurrencyWallet(Number.MAX_SAFE_INTEGER + 2)).toThrow(RangeError);
    expect(() => wallet.reset(-1)).toThrow(RangeError);
  });

  it('can be reset to a loaded balance', () => {
    const wallet = new CurrencyWallet(10);

    wallet.reset(4200);

    expect(wallet.balance).toBe(4200);
  });
});

describe('costs', () => {
  it('rounds fuel up to whole credits', () => {
    expect(fuelCost(10, 12)).toBe(120);
    expect(fuelCost(10.01, 12)).toBe(121);
    expect(fuelCost(0, 12)).toBe(0);
    expect(fuelCost(-3, 12)).toBe(0);
  });

  it('prices a repair by the damage share, rounded up', () => {
    expect(repairCost(0.25, 6000)).toBe(1500);
    expect(repairCost(0.0001, 6000)).toBe(1);
    expect(repairCost(0, 6000)).toBe(0);
  });
});

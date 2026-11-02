import { describe, expect, it } from 'vitest';
import { DEFAULT_GAME_CONFIG } from '../../../../src/data/config/GameConfig';
import type { GameEvents } from '../../../../src/systems/GameEvents';
import { CONVOY_GAPS, ConvoyService } from '../../../../src/systems/world/ConvoyService';
import { MemoryLogger } from '../../../support/MemoryLogger';
import { newCompany, type Game } from '../../../support/game';

const CONVOY = DEFAULT_GAME_CONFIG.convoy;
const STEP = 1 / 10;

function listen<K extends keyof GameEvents>(game: Game, name: K): GameEvents[K][] {
  const heard: GameEvents[K][] = [];
  game.events.on(name, (event) => heard.push(event));
  return heard;
}

/** A convoy on the game's world, the truck put by hand, from the depot of city A heading down its road. */
async function convoyGame() {
  const game = await newCompany(1, 1000);
  const depot = game.driving.world.depotOf('city_a')!.bay;
  const truck = { x: depot.x, z: depot.z, y: 0, heading: (depot.headingDegrees * Math.PI) / 180, speed: 0 };
  const driving = { isDriving: true, vehicle: truck, world: game.driving.world };
  let luck = 0.4;
  const convoy = new ConvoyService(driving, game.economy, CONVOY, () => luck, game.events, new MemoryLogger());
  return { game, convoy, truck, setLuck: (value: number) => (luck = value) };
}

describe('ConvoyService', () => {
  it('sends a convoy of three trucks ahead after a while on the road, the lead in front, in line', async () => {
    const { game, convoy } = await convoyGame();
    const started = listen(game, 'ConvoyStarted');
    for (let t = 0; t < CONVOY.firstAfterSeconds - 1; t += STEP) {
      convoy.update(STEP);
    }
    expect(convoy.active).toBe(false);
    for (let t = 0; t < 2 && !convoy.active; t += STEP) {
      convoy.update(STEP);
    }
    expect(convoy.active).toBe(true);
    expect(started).toHaveLength(1);
    // Moving on, the trucks keep their gaps.
    for (let t = 0; t < 20; t += STEP) {
      convoy.update(STEP);
    }
    for (let i = 1; i < CONVOY_GAPS.length; i++) {
      const gap = Math.hypot(convoy.vehicleX[i]! - convoy.vehicleX[i - 1]!, convoy.vehicleZ[i]! - convoy.vehicleZ[i - 1]!);
      expect(gap).toBeGreaterThan(CONVOY_GAPS[1]! * 0.7);
      expect(gap).toBeLessThan(CONVOY_GAPS[1]! * 1.3);
    }
  });

  it('counts the kilometres ridden close to it, and pays them when it reaches its end', async () => {
    const { game, convoy, truck } = await convoyGame();
    const ended = listen(game, 'ConvoyEnded');
    convoy.sendConvoy();
    convoy.update(STEP);
    expect(convoy.active).toBe(true);
    // Riding just behind the last truck, at its pace, all the way.
    let steps = 0;
    while (convoy.active && steps < 100_000) {
      convoy.update(STEP);
      const last = CONVOY_GAPS.length - 1;
      Object.assign(truck, { x: convoy.vehicleX[last]! + 3, z: convoy.vehicleZ[last]! + 3, speed: CONVOY.speed });
      if (steps === 50) {
        expect(convoy.riding).toBe(true);
      }
      steps++;
    }
    expect(ended).toHaveLength(1);
    const { riddenMeters, reward } = ended[0]!;
    expect(riddenMeters).toBeGreaterThan(1000);
    expect(reward).toBe(Math.round(((riddenMeters / 1000) * CONVOY.creditsPerKm) / 10) * 10);
    expect(game.economy.credits).toBe(1000 + reward);
  });

  it('pays nothing for too little ridden, and sends another after a gap', async () => {
    const { game, convoy, truck } = await convoyGame();
    const ended = listen(game, 'ConvoyEnded');
    convoy.sendConvoy();
    convoy.update(STEP);
    // Far away, standing: never riding with it.
    Object.assign(truck, { x: truck.x + 5000, speed: 0 });
    for (let t = 0; t < CONVOY.mostSeconds + 1 && convoy.active; t += STEP) {
      convoy.update(STEP);
    }
    expect(ended).toEqual([{ riddenMeters: 0, reward: 0 }]);
    expect(game.economy.credits).toBe(1000);
    expect(convoy.active).toBe(false);
  });
});

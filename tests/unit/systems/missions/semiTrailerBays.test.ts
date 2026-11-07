import { describe, expect, it } from 'vitest';
import { DEFAULT_GAME_CONFIG } from '../../../../src/data/config/GameConfig';
import { bayParkingPose } from '../../../../src/domain/missions/loadingBay';
import { deliver, newCompany, play, type Game } from '../../../support/game';
import { STEP_SECONDS } from '../../../support/driving';

/** A company at the top level driving a T1, a tractor unit with a box semi-trailer. */
async function companyWithRig(): Promise<Game> {
  const game = await newCompany(10, 500_000);
  const bought = game.garage.buy('rh_t1');
  if (!bought.ok) {
    throw new Error(`Could not buy the T1: ${bought.error}`);
  }
  game.garage.switchTo(bought.value.instanceId);
  return game;
}

describe('a tractor unit at the depots', () => {
  it('loads and unloads with its semi-trailer in the bay, the tractor standing out of it', async () => {
    const game = await companyWithRig();
    expect(game.driving.definition.id).toBe('rh_t1');
    expect(game.driving.trailer).not.toBeNull();

    deliver(game, 'store_restock');

    expect(game.missions.active).toBeNull();
    expect(game.company.stats.deliveriesCompleted).toBe(1);
  });

  it('does not load with only the tractor in the bay and its trailer out of it', async () => {
    const game = await companyWithRig();
    expect(game.missions.accept('store_restock').ok).toBe(true);
    play(game, STEP_SECONDS);
    // Where a rigid truck would park: the tractor in the middle of the bay, the trailer behind it out of the bay.
    const pose = bayParkingPose(game.missions.target!.depot.bay, game.driving.definition.body);
    game.driving.placeTruck(pose.x, pose.z, pose.heading);

    play(game, DEFAULT_GAME_CONFIG.missions.loadingSeconds + 1);

    expect(game.missions.active!.state).not.toBe('loaded');
  });
});

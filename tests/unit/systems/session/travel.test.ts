import { describe, expect, it } from 'vitest';
import { bootGame, newCompany, play } from '../../../support/game';

describe('travelling between regions', () => {
  it('takes the ferry from Gull Point to Metropol: saved on the other map at its terminal, continued there', async () => {
    const game = await newCompany(3, 40_000);
    const gate = game.driving.world.gates.find((candidate) => candidate.id === 'gull_point_ferry')!;
    expect(game.driving.world.gateAt(gate.area.x, gate.area.z)).toBe(gate);

    const travelled = game.session.travel('gull_point_ferry');

    expect(travelled).toEqual({ ok: true, value: { mapId: 'metropol' } });
    expect(game.session.isActive).toBe(false);
    const next = await bootGame(game.storage, 5_000);
    expect(next.session.readSave()).toMatchObject({ ok: true, value: { mapId: 'metropol', companyName: 'Kuzey Lojistik' } });
    expect(next.session.continueGame()).toEqual({ ok: true, value: undefined });
    expect(next.driving.world.id).toBe('metropol');
    expect(next.driving.vehicle.x).toBeCloseTo(250, 6);
    expect(next.driving.vehicle.z).toBeCloseTo(2400, 6);
    expect(next.economy.credits).toBe(40_000);
    // And back.
    expect(next.session.travel('metropol_ferry')).toEqual({ ok: true, value: { mapId: 'north_valley' } });
  });

  it('does not set off with a contract under way, nor through a gate the map does not have', async () => {
    const game = await newCompany(3, 40_000);
    expect(game.session.travel('nowhere')).toEqual({ ok: false, error: 'unknownGate' });
    expect(game.missions.accept('first_package').ok).toBe(true);

    expect(game.session.travel('gull_point_ferry')).toEqual({ ok: false, error: 'contractUnderWay' });
    expect(game.session.isActive).toBe(true);
  });

  it('works on in Metropol: its own contracts on the board, the hired drivers and the rivals driving between its cities', async () => {
    const game = await newCompany(5, 200_000);
    expect(game.fleet.hire('driver_kemal').ok).toBe(true);
    expect(game.fleet.buyTruckFor('driver_kemal').ok).toBe(true);
    play(game, 120);
    expect(game.session.travel('gull_point_ferry').ok).toBe(true);

    const next = await bootGame(game.storage, 5_000);
    expect(next.session.continueGame().ok).toBe(true);
    const metropolCities = new Set(next.driving.world.depots.map((depot) => depot.cityId));
    const board = next.missions.jobBoard();
    expect(board.length).toBeGreaterThan(9);
    for (const offer of board) {
      expect(metropolCities.has(offer.mission.originCityId), offer.mission.id).toBe(true);
      expect(metropolCities.has(offer.mission.destinationCityId), offer.mission.id).toBe(true);
    }
    expect(board.some((offer) => offer.mission.id === 'city_lights' && offer.blockedBy === null)).toBe(true);

    play(next, 900);
    const jobs = next.fleet.hired.map((driver) => driver.job).filter((job) => job !== null);
    expect(jobs.length).toBeGreaterThan(0);
    for (const job of jobs) {
      expect(metropolCities.has(job!.originCityId)).toBe(true);
      expect(metropolCities.has(job!.destinationCityId)).toBe(true);
    }
    next.rivals.updateMarkers();
    for (const marker of next.rivals.markers) {
      expect(metropolCities.has(marker.destinationCityId)).toBe(true);
    }
  });
});

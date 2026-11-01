import type { EventBus, Unsubscribe } from '../../core/events/EventBus';
import type { ContentCatalog } from '../../data/ContentCatalog';
import { emptyCareer, mostCounted } from '../../domain/career/careerRecords';
import type { MissionState } from '../../domain/missions/MissionInstance';
import type { CareerSaveData } from '../../domain/save/SaveGameData';
import type { GameEvents } from '../GameEvents';

/** What the career reads of the truck: DrivingService's vehicle. */
export interface CareerTruck {
  readonly vehicle: { readonly speed: number };
}

/** What the career reads of the contract under way: MissionService. */
export interface CareerMissions {
  readonly active: { readonly state: MissionState } | null;
}

/** Faster than this is a glitch (a truck flung by a crash), not a speed driven: m/s (180 km/h). */
const FASTEST_BELIEVABLE_METERS_PER_SECOND = 50;

/** The career's records as the career page shows them: the save's, the favourite cargo and town worked out. */
export interface CareerRecords extends CareerSaveData {
  /** The cargo delivered most often (CargoDefinition id), or null before the first delivery. */
  readonly favouriteCargoId: string | null;
  /** The town delivered to most often (CityDefinition id), or null. */
  readonly favouriteCityId: string | null;
}

/**
 * The company's career (the career page): tons delivered, the longest haul
 * (driven loaded, pickup to delivery), the best pay for one delivery, the top
 * speed, the time on the road, the diesel bought and the repairs paid, the
 * knocks, the times it went over, the cars wrecked and the things knocked
 * down, the hired drivers' deliveries, and deliveries by cargo and by town.
 * Counted from the game's events and, every fixed step on the road, the
 * truck's speed (update). In the save from v18; the deliveries, the distance
 * and the earnings before then are CompanyService's statistics.
 */
export class CareerService {
  private record: Mutable<CareerSaveData> = mutableCopy(emptyCareer());
  private readonly unsubscribe: Unsubscribe[];

  constructor(
    private readonly content: ContentCatalog,
    private readonly truck: CareerTruck,
    private readonly missions: CareerMissions,
    events: EventBus<GameEvents>,
  ) {
    this.unsubscribe = [
      events.on('MissionStateChanged', ({ current }) => {
        // The haul is driven loaded: counted from the pickup.
        if (current === 'loaded' || current === 'accepted') {
          this.record.haulMeters = 0;
        }
      }),
      events.on('MissionCompleted', ({ mission, reward }) => {
        const record = this.record;
        record.tonsDelivered += mission.cargoWeightTons;
        record.longestHaulMeters = Math.max(record.longestHaulMeters, record.haulMeters);
        record.haulMeters = 0;
        record.bestPay = Math.max(record.bestPay, reward.total);
        record.cargo = { ...record.cargo, [mission.cargoId]: (record.cargo[mission.cargoId] ?? 0) + 1 };
        record.destinations = {
          ...record.destinations,
          [mission.destinationCityId]: (record.destinations[mission.destinationCityId] ?? 0) + 1,
        };
      }),
      events.on('MissionFailed', () => {
        this.record.haulMeters = 0;
      }),
      events.on('Refuelled', ({ liters, cost }) => {
        this.record.fuelLiters += liters;
        this.record.fuelSpent += cost;
      }),
      events.on('VehicleRepaired', ({ cost }) => {
        this.record.repairsSpent += cost;
      }),
      events.on('VehicleDamaged', () => {
        this.record.knocks++;
      }),
      events.on('TruckOverturned', () => {
        this.record.overturns++;
      }),
      events.on('VehicleWrecked', () => {
        this.record.carsWrecked++;
      }),
      events.on('PropKnockedOver', ({ byTruck }) => {
        if (byTruck) {
          this.record.propsKnocked++;
        }
      }),
      events.on('FleetJobCompleted', () => {
        this.record.fleetDeliveries++;
      }),
      events.on('SpeedingCaught', ({ fine, warning }) => {
        if (!warning) {
          this.record.fines++;
          this.record.finesPaid += fine;
        }
      }),
      events.on('RoadsideHelped', () => {
        this.record.roadsideHelps++;
      }),
    ];
  }

  /** The records, the favourite cargo and town worked out (by the content's order where tied). */
  get records(): CareerRecords {
    return {
      ...this.record,
      favouriteCargoId: mostCounted(this.record.cargo, this.content.cargo.all.map((cargo) => cargo.id)),
      favouriteCityId: mostCounted(this.record.destinations, this.content.cities.all.map((city) => city.id)),
    };
  }

  /**
   * A fixed step on the road, the truck in the player's hands: the time, the
   * top speed and, loaded, the haul. Allocation-free.
   */
  update(stepSeconds: number): void {
    const record = this.record;
    const speed = Math.abs(this.truck.vehicle.speed);
    record.drivingSeconds += stepSeconds;
    if (speed <= FASTEST_BELIEVABLE_METERS_PER_SECOND && speed * 3.6 > record.topSpeedKmh) {
      record.topSpeedKmh = speed * 3.6;
    }
    const state = this.missions.active?.state;
    if (state === 'loaded' || state === 'delivering') {
      record.haulMeters += speed * stepSeconds;
    }
  }

  snapshot(): CareerSaveData {
    return { ...this.record };
  }

  /** Takes up a loaded or new game's career. */
  restore(data: CareerSaveData): void {
    this.record = mutableCopy(data);
  }

  dispose(): void {
    for (const unsubscribe of this.unsubscribe) {
      unsubscribe();
    }
  }
}

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

function mutableCopy(data: CareerSaveData): Mutable<CareerSaveData> {
  return { ...data, cargo: { ...data.cargo }, destinations: { ...data.destinations } };
}

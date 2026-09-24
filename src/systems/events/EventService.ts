import type { EventBus, Unsubscribe } from '../../core/events/EventBus';
import type { Logger } from '../../core/logging/Logger';
import type { Clock } from '../../core/time/Clock';
import type { ContentCatalog } from '../../data/ContentCatalog';
import type { EventDefinition } from '../../data/definitions/EventDefinition';
import { cargoQualifies, deliveryQualifies, eventBonus, objectiveStep, type DeliveryFacts } from '../../domain/events/eventRules';
import { eventRunAt, isRunning, type EventRun } from '../../domain/events/eventSchedule';
import type { EventRunSaveData } from '../../domain/save/SaveGameData';
import type { CompanyService } from '../company/CompanyService';
import type { EconomyService } from '../economy/EconomyService';
import type { GameEvents } from '../GameEvents';

/** An event as the HQ shows it. */
export interface EventStatus {
  readonly definition: EventDefinition;
  /** The run going on, or else the next one; null when the event is over for good. */
  readonly run: EventRun | null;
  readonly running: boolean;
  /** The company's level is below the event's requirement. */
  readonly locked: boolean;
  /** Toward the objective in `run`; 0 before it starts. */
  readonly progress: number;
  /** The objective of `run` is met, and its reward paid. */
  readonly completed: boolean;
  /** Until `run` ends when it is running, or starts when it is not; 0 when the event is over. */
  readonly remainingMs: number;
}

/** Progress in one run of an event. */
interface RunRecord {
  edition: number;
  progress: number;
  rewarded: boolean;
}

/**
 * Runs the events (spec §22–23, §53): which are on, by the clock, and what
 * each delivery counts for. Events reuse the contracts: on MissionCompleted,
 * a delivery that meets a running event's conditions pays its bonus
 * (EconomyService) and advances its objective; meeting the objective pays the
 * reward once per run (credits, and XP through CompanyService). Emits
 * EventProgressed. It keeps the progress of each event's latest run, which
 * the save holds.
 */
export class EventService {
  private readonly records = new Map<string, RunRecord>();
  private readonly unsubscribe: Unsubscribe;

  constructor(
    private readonly content: ContentCatalog,
    private readonly company: CompanyService,
    private readonly economy: EconomyService,
    private readonly clock: Clock,
    private readonly events: EventBus<GameEvents>,
    private readonly logger: Logger,
  ) {
    // Subscribed after EconomyService and CompanyService: a delivery is paid before its event bonus.
    this.unsubscribe = events.on('MissionCompleted', (delivery) => this.countDelivery(delivery));
  }

  /** Every event, with its run, the company's progress and whether it may take part. For the HQ: allocates. */
  statuses(): EventStatus[] {
    const now = this.clock.now();
    return this.content.events.all.map((definition) => this.statusOf(definition, now));
  }

  /**
   * The running events the company takes part in that contract `missionId`
   * counts toward because of its cargo alone (the job board marks them).
   * Allocates.
   */
  eventsForContract(missionId: string): EventDefinition[] {
    const now = this.clock.now();
    const mission = this.content.missions.get(missionId);
    const category = this.content.cargo.get(mission.cargoId).category;
    return this.content.events.all.filter(
      (definition) =>
        this.mayTakePart(definition) &&
        isRunning(eventRunAt(definition.schedule, now), now) &&
        cargoQualifies(definition.qualifyingDelivery, mission.cargoWeightTons, category),
    );
  }

  /** Takes over the progress of a loaded or new game. */
  restore(runs: readonly EventRunSaveData[]): void {
    this.records.clear();
    for (const { eventId, edition, progress, rewarded } of runs) {
      this.records.set(eventId, { edition, progress, rewarded });
    }
  }

  /** The progress to save: each event's latest run the company took part in. */
  snapshot(): EventRunSaveData[] {
    return [...this.records].map(([eventId, { edition, progress, rewarded }]) => ({ eventId, edition, progress, rewarded }));
  }

  dispose(): void {
    this.unsubscribe();
  }

  private countDelivery(delivery: GameEvents['MissionCompleted']): void {
    const now = this.clock.now();
    const mission = this.content.missions.get(delivery.missionId);
    const facts: DeliveryFacts = {
      onTime: delivery.reward.onTime,
      timeLeft: 1 - delivery.deliverySeconds / mission.timeLimitSeconds,
      cargoDamage: delivery.cargoDamage,
      cargoWeightTons: mission.cargoWeightTons,
      cargoCategory: this.content.cargo.get(mission.cargoId).category,
      pay: delivery.reward.total,
    };
    for (const definition of this.content.events.all) {
      const run = eventRunAt(definition.schedule, now);
      if (
        run === null ||
        !isRunning(run, now) ||
        !this.mayTakePart(definition) ||
        !deliveryQualifies(definition.qualifyingDelivery, facts)
      ) {
        continue;
      }
      const record = this.recordFor(definition.id, run.edition);
      const bonus = eventBonus(definition.payBonus, facts.pay);
      this.economy.earn(bonus, 'event');
      const target = definition.objective.target;
      record.progress = Math.min(target, record.progress + objectiveStep(definition.objective, facts.pay + bonus));
      let reward = null;
      if (!record.rewarded && record.progress >= target) {
        record.rewarded = true;
        reward = definition.reward;
        this.economy.earn(reward.credits, 'event');
        this.company.award(reward.xp);
        this.logger.info(`Event ${definition.id} (run ${run.edition}) completed.`);
      }
      this.events.emit('EventProgressed', { eventId: definition.id, bonus, progress: record.progress, target, reward });
    }
  }

  private mayTakePart(definition: EventDefinition): boolean {
    return this.company.level >= (definition.requiredCompanyLevel ?? 1);
  }

  /** The progress of `eventId`'s run `edition`: a fresh record when the kept one belongs to an earlier run. */
  private recordFor(eventId: string, edition: number): RunRecord {
    let record = this.records.get(eventId);
    if (record === undefined || record.edition !== edition) {
      record = { edition, progress: 0, rewarded: false };
      this.records.set(eventId, record);
    }
    return record;
  }

  private statusOf(definition: EventDefinition, now: number): EventStatus {
    const run = eventRunAt(definition.schedule, now);
    const record = this.records.get(definition.id);
    const current = run !== null && record !== undefined && record.edition === run.edition ? record : null;
    const running = isRunning(run, now);
    return {
      definition,
      run,
      running,
      locked: !this.mayTakePart(definition),
      progress: current?.progress ?? 0,
      completed: current?.rewarded ?? false,
      remainingMs: run === null ? 0 : running ? run.endMs - now : run.startMs - now,
    };
  }
}

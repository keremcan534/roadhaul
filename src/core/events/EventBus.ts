import type { Logger } from '../logging/Logger';

export type EventHandler<TPayload> = (payload: TPayload) => void;
export type Unsubscribe = () => void;

interface Subscription<TPayload> {
  readonly handler: EventHandler<TPayload>;
  active: boolean;
}

interface QueuedEvent<TEvents> {
  readonly type: keyof TEvents;
  readonly payload: unknown;
}

/**
 * Typed publish/subscribe channel that keeps systems loosely coupled (spec §57).
 * `TEvents` maps event names to payload types, e.g. `{ MoneyChanged: { balance: number } }`.
 *
 * - Delivery is synchronous, in subscription order.
 * - Events emitted by a handler are queued and delivered right after the
 *   current event, so every handler sees events in the order they happened.
 * - Unsubscribing takes effect immediately, even for an event being delivered.
 *   Handlers added during delivery receive only later events.
 * - A throwing handler is logged and does not stop delivery to the others.
 * - Emitting outside a handler does not allocate. Handler lists are copied on
 *   subscribe/unsubscribe instead.
 */
export class EventBus<TEvents extends object> {
  private readonly subscriptions = new Map<keyof TEvents, readonly Subscription<never>[]>();
  private readonly queue: QueuedEvent<TEvents>[] = [];
  private delivering = false;

  constructor(private readonly logger: Logger) {}

  on<K extends keyof TEvents>(type: K, handler: EventHandler<TEvents[K]>): Unsubscribe {
    const subscription: Subscription<TEvents[K]> = { handler, active: true };
    this.subscriptions.set(type, [...(this.subscriptions.get(type) ?? []), subscription]);
    return () => {
      if (subscription.active) {
        subscription.active = false;
        this.remove(type, subscription);
      }
    };
  }

  emit<K extends keyof TEvents>(type: K, payload: TEvents[K]): void {
    if (this.delivering) {
      this.queue.push({ type, payload });
      return;
    }
    this.delivering = true;
    try {
      this.deliver(type, payload);
      // Handlers may queue further events while the queue drains.
      for (let i = 0; i < this.queue.length; i++) {
        const queued = this.queue[i]!;
        // The payload was queued by emit<K>() together with its matching type.
        this.deliver(queued.type, queued.payload as never);
      }
    } finally {
      this.queue.length = 0;
      this.delivering = false;
    }
  }

  listenerCount(type: keyof TEvents): number {
    return this.subscriptions.get(type)?.length ?? 0;
  }

  /** Removes every handler, including from a delivery in progress. Called by the service container on shutdown. */
  dispose(): void {
    for (const subscriptions of this.subscriptions.values()) {
      for (const subscription of subscriptions) {
        subscription.active = false;
      }
    }
    this.subscriptions.clear();
    this.queue.length = 0;
  }

  private deliver<K extends keyof TEvents>(type: K, payload: TEvents[K]): void {
    // Every subscription stored under `type` was registered through on<K>, so it accepts TEvents[K].
    const subscriptions = this.subscriptions.get(type) as readonly Subscription<TEvents[K]>[] | undefined;
    if (subscriptions === undefined) {
      return;
    }
    // Indexed loop: an array iterator would allocate before the JIT optimises it away.
    for (let i = 0; i < subscriptions.length; i++) {
      const subscription = subscriptions[i]!;
      if (!subscription.active) {
        continue;
      }
      try {
        subscription.handler(payload);
      } catch (error) {
        this.logger.error(`A handler for "${String(type)}" threw.`, error);
      }
    }
  }

  private remove(type: keyof TEvents, subscription: Subscription<never>): void {
    const current = this.subscriptions.get(type);
    const index = current?.indexOf(subscription) ?? -1;
    if (current === undefined || index === -1) {
      return;
    }
    if (current.length === 1) {
      this.subscriptions.delete(type);
    } else {
      this.subscriptions.set(type, [...current.slice(0, index), ...current.slice(index + 1)]);
    }
  }
}

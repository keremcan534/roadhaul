import type { Logger } from '../logging/Logger';

export type EventHandler<TPayload> = (payload: TPayload) => void;
export type Unsubscribe = () => void;

/**
 * Typed publish/subscribe channel that keeps systems loosely coupled (spec §57).
 * `TEvents` maps event names to payload types, e.g. `{ MoneyChanged: { balance: number } }`.
 *
 * - Emitting does not allocate. Handler lists are copied on subscribe/unsubscribe
 *   instead, so handlers may (un)subscribe while an event is being delivered.
 * - A throwing handler is logged and does not stop delivery to the others.
 * - Delivery is synchronous, in subscription order.
 */
export class EventBus<TEvents extends object> {
  private readonly handlers = new Map<keyof TEvents, readonly EventHandler<never>[]>();

  constructor(private readonly logger: Logger) {}

  on<K extends keyof TEvents>(type: K, handler: EventHandler<TEvents[K]>): Unsubscribe {
    this.handlers.set(type, [...(this.handlers.get(type) ?? []), handler]);
    let subscribed = true;
    return () => {
      if (subscribed) {
        subscribed = false;
        this.remove(type, handler);
      }
    };
  }

  emit<K extends keyof TEvents>(type: K, payload: TEvents[K]): void {
    // Every handler stored under `type` was registered through on<K>, so it accepts TEvents[K].
    const handlers = this.handlers.get(type) as readonly EventHandler<TEvents[K]>[] | undefined;
    if (handlers === undefined) {
      return;
    }
    // Indexed loop: an array iterator would allocate before the JIT optimises it away.
    for (let i = 0; i < handlers.length; i++) {
      try {
        handlers[i]!(payload);
      } catch (error) {
        this.logger.error(`A handler for "${String(type)}" threw.`, error);
      }
    }
  }

  listenerCount(type: keyof TEvents): number {
    return this.handlers.get(type)?.length ?? 0;
  }

  /** Removes every handler. Called by the service container on shutdown. */
  dispose(): void {
    this.handlers.clear();
  }

  private remove(type: keyof TEvents, handler: EventHandler<never>): void {
    const current = this.handlers.get(type);
    const index = current?.indexOf(handler) ?? -1;
    if (current === undefined || index === -1) {
      return;
    }
    if (current.length === 1) {
      this.handlers.delete(type);
    } else {
      this.handlers.set(type, [...current.slice(0, index), ...current.slice(index + 1)]);
    }
  }
}

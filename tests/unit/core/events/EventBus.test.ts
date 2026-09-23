import { describe, expect, it } from 'vitest';
import { EventBus } from '../../../../src/core/events/EventBus';
import { MemoryLogger } from '../../../support/MemoryLogger';

interface TestEvents {
  Ping: { readonly value: number };
  Pong: string;
}

function createBus() {
  const logger = new MemoryLogger();
  return { bus: new EventBus<TestEvents>(logger), logger };
}

describe('EventBus', () => {
  it('delivers a payload only to subscribers of that event', () => {
    const { bus } = createBus();
    const pings: number[] = [];
    const pongs: string[] = [];
    bus.on('Ping', (payload) => pings.push(payload.value));
    bus.on('Pong', (payload) => pongs.push(payload));

    bus.emit('Ping', { value: 1 });

    expect(pings).toEqual([1]);
    expect(pongs).toEqual([]);
  });

  it('calls handlers in subscription order', () => {
    const { bus } = createBus();
    const calls: string[] = [];
    bus.on('Pong', () => calls.push('first'));
    bus.on('Pong', () => calls.push('second'));

    bus.emit('Pong', 'x');

    expect(calls).toEqual(['first', 'second']);
  });

  it('ignores events nobody listens to', () => {
    const { bus, logger } = createBus();
    expect(() => bus.emit('Pong', 'nobody home')).not.toThrow();
    expect(logger.entries).toEqual([]);
  });

  it('stops delivering after unsubscribe, and a second unsubscribe is harmless', () => {
    const { bus } = createBus();
    const pings: number[] = [];
    const unsubscribe = bus.on('Ping', (payload) => pings.push(payload.value));

    unsubscribe();
    unsubscribe();
    bus.emit('Ping', { value: 1 });

    expect(pings).toEqual([]);
    expect(bus.listenerCount('Ping')).toBe(0);
  });

  it('removes one registration when the same handler was subscribed twice', () => {
    const { bus } = createBus();
    const pings: number[] = [];
    const handler = (payload: { readonly value: number }) => pings.push(payload.value);
    const unsubscribeFirst = bus.on('Ping', handler);
    bus.on('Ping', handler);

    unsubscribeFirst();
    bus.emit('Ping', { value: 3 });

    expect(pings).toEqual([3]);
    expect(bus.listenerCount('Ping')).toBe(1);
  });

  it('lets a handler unsubscribe itself during delivery without skipping the others', () => {
    const { bus } = createBus();
    const calls: string[] = [];
    const unsubscribeA = bus.on('Pong', () => {
      calls.push('a');
      unsubscribeA();
    });
    bus.on('Pong', () => calls.push('b'));

    bus.emit('Pong', '1');
    bus.emit('Pong', '2');

    expect(calls).toEqual(['a', 'b', 'b']);
  });

  it('delivers to handlers added during an emit only from the next emit on', () => {
    const { bus } = createBus();
    const calls: string[] = [];
    let added = false;
    bus.on('Pong', () => {
      calls.push('outer');
      if (!added) {
        added = true;
        bus.on('Pong', () => calls.push('inner'));
      }
    });

    bus.emit('Pong', '1');
    bus.emit('Pong', '2');

    expect(calls).toEqual(['outer', 'outer', 'inner']);
  });

  it('stops delivering to a handler that is unsubscribed while the event is in flight', () => {
    const { bus } = createBus();
    const calls: string[] = [];
    let unsubscribeB: () => void = () => {};
    bus.on('Pong', () => {
      calls.push('a');
      unsubscribeB();
    });
    unsubscribeB = bus.on('Pong', () => calls.push('b'));

    bus.emit('Pong', '1');

    expect(calls).toEqual(['a']);
  });

  it('delivers events emitted by a handler after the current event, keeping their order', () => {
    const { bus } = createBus();
    const seenByFirst: number[] = [];
    const seenBySecond: number[] = [];
    bus.on('Ping', ({ value }) => {
      seenByFirst.push(value);
      if (value === 1) {
        bus.emit('Ping', { value: 2 });
      }
    });
    bus.on('Ping', ({ value }) => seenBySecond.push(value));

    bus.emit('Ping', { value: 1 });

    expect(seenByFirst).toEqual([1, 2]);
    expect(seenBySecond).toEqual([1, 2]);
  });

  it('stops delivery immediately when disposed from inside a handler', () => {
    const { bus } = createBus();
    const calls: string[] = [];
    bus.on('Pong', () => {
      calls.push('first');
      bus.dispose();
    });
    bus.on('Pong', () => calls.push('second'));

    bus.emit('Pong', 'x');

    expect(calls).toEqual(['first']);
  });

  it('logs a throwing handler and still delivers to the rest', () => {
    const { bus, logger } = createBus();
    const pings: number[] = [];
    bus.on('Ping', () => {
      throw new Error('boom');
    });
    bus.on('Ping', (payload) => pings.push(payload.value));

    bus.emit('Ping', { value: 7 });

    expect(pings).toEqual([7]);
    expect(logger.entries).toHaveLength(1);
    expect(logger.entries[0]?.level).toBe('error');
    expect(logger.entries[0]?.message).toContain('Ping');
    expect(logger.entries[0]?.details[0]).toBeInstanceOf(Error);
  });

  it('removes every handler on dispose', () => {
    const { bus } = createBus();
    const pings: number[] = [];
    bus.on('Ping', (payload) => pings.push(payload.value));

    bus.dispose();
    bus.emit('Ping', { value: 1 });

    expect(pings).toEqual([]);
    expect(bus.listenerCount('Ping')).toBe(0);
  });
});

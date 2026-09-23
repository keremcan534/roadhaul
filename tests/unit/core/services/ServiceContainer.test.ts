import { describe, expect, it } from 'vitest';
import { ServiceContainer, serviceKey } from '../../../../src/core/services/ServiceContainer';

function recordingService(name: string, log: string[]) {
  return {
    initialize: () => {
      log.push(`init:${name}`);
    },
    dispose: () => {
      log.push(`dispose:${name}`);
    },
  };
}

describe('ServiceContainer', () => {
  it('resolves the instance registered under a key', () => {
    const container = new ServiceContainer();
    const key = serviceKey<{ value: number }>('Thing');
    const thing = { value: 1 };

    expect(container.register(key, thing)).toBe(thing);
    expect(container.resolve(key)).toBe(thing);
    expect(container.has(key)).toBe(true);
  });

  it('treats keys with the same name as different services', () => {
    const container = new ServiceContainer();
    const first = serviceKey<string>('Same');
    const second = serviceKey<string>('Same');
    container.register(first, 'a');
    container.register(second, 'b');

    expect(container.resolve(first)).toBe('a');
    expect(container.resolve(second)).toBe('b');
  });

  it('rejects registering a key twice', () => {
    const container = new ServiceContainer();
    const key = serviceKey<number>('Answer');
    container.register(key, 42);

    expect(() => container.register(key, 43)).toThrow('Service "Answer" is already registered.');
  });

  it('names the missing service when resolving fails', () => {
    const container = new ServiceContainer();
    const key = serviceKey<number>('Missing');

    expect(() => container.resolve(key)).toThrow('Service "Missing" is not registered.');
    expect(container.tryResolve(key)).toBeUndefined();
  });

  it('initializes services in registration order and awaits async ones', async () => {
    const container = new ServiceContainer();
    const log: string[] = [];
    container.register(serviceKey('Slow'), {
      initialize: async () => {
        await Promise.resolve();
        log.push('init:slow');
      },
    });
    container.register(serviceKey('Fast'), recordingService('fast', log));
    container.register(serviceKey('Plain'), { notAService: true });

    await container.initializeAll();

    expect(log).toEqual(['init:slow', 'init:fast']);
  });

  it('initializes only services registered since the previous call', async () => {
    const container = new ServiceContainer();
    const log: string[] = [];
    container.register(serviceKey('A'), recordingService('a', log));
    await container.initializeAll();
    container.register(serviceKey('B'), recordingService('b', log));

    await container.initializeAll();

    expect(log).toEqual(['init:a', 'init:b']);
  });

  it('disposes services in reverse registration order', () => {
    const container = new ServiceContainer();
    const log: string[] = [];
    container.register(serviceKey('A'), recordingService('a', log));
    container.register(serviceKey('B'), recordingService('b', log));
    container.register(serviceKey('C'), recordingService('c', log));

    container.disposeAll();

    expect(log).toEqual(['dispose:c', 'dispose:b', 'dispose:a']);
  });

  it('keeps disposing when one service fails, then reports every failure', () => {
    const container = new ServiceContainer();
    const log: string[] = [];
    container.register(serviceKey('A'), recordingService('a', log));
    container.register(serviceKey('Broken'), {
      dispose: () => {
        throw new Error('cannot release');
      },
    });
    container.register(serviceKey('C'), recordingService('c', log));

    let thrown: unknown;
    try {
      container.disposeAll();
    } catch (error) {
      thrown = error;
    }

    expect(log).toEqual(['dispose:c', 'dispose:a']);
    expect(thrown).toBeInstanceOf(AggregateError);
    expect((thrown as AggregateError).errors).toHaveLength(1);
  });

  it('cannot be used after disposal, but disposing again is a no-op', () => {
    const container = new ServiceContainer();
    const key = serviceKey<number>('Answer');
    container.register(key, 42);
    container.disposeAll();

    expect(() => container.resolve(key)).toThrow('disposed');
    expect(() => container.register(serviceKey('Late'), 1)).toThrow('disposed');
    expect(() => container.disposeAll()).not.toThrow();
  });
});

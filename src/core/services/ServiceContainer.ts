/**
 * Typed lookup key for a service. Keys are compared by identity, so two keys
 * with the same name are still different services.
 */
export interface ServiceKey<T> {
  readonly name: string;
  /** Compile-time only: carries the service type. Never set at runtime. */
  readonly __serviceType?: T;
}

export function serviceKey<T>(name: string): ServiceKey<T> {
  return Object.freeze({ name });
}

/** Implemented by services that need setup after every earlier service is registered. */
export interface Initializable {
  initialize(): void | Promise<void>;
}

/** Implemented by services that hold resources (listeners, GPU memory, timers). */
export interface Disposable {
  dispose(): void;
}

function isInitializable(value: unknown): value is Initializable {
  return typeof (value as Partial<Initializable> | null)?.initialize === 'function';
}

function isDisposable(value: unknown): value is Disposable {
  return typeof (value as Partial<Disposable> | null)?.dispose === 'function';
}

/**
 * Registry for the game's long-lived services, with an ordered lifecycle.
 *
 * Only the composition root (`src/app`, `src/main.ts`) registers and resolves
 * services. Everything else receives its dependencies as constructor
 * parameters. The container is not a global service locator.
 *
 * `initializeAll()` calls `initialize()` in registration order and
 * `disposeAll()` calls `dispose()` in reverse order, so a service can rely on
 * everything registered before it.
 */
export class ServiceContainer {
  private readonly instances = new Map<ServiceKey<unknown>, unknown>();
  private readonly registrationOrder: unknown[] = [];
  private initializedCount = 0;
  private disposed = false;

  register<T>(key: ServiceKey<T>, instance: T): T {
    this.assertNotDisposed();
    if (this.instances.has(key)) {
      throw new Error(`Service "${key.name}" is already registered.`);
    }
    this.instances.set(key, instance);
    this.registrationOrder.push(instance);
    return instance;
  }

  resolve<T>(key: ServiceKey<T>): T {
    this.assertNotDisposed();
    if (!this.instances.has(key)) {
      throw new Error(`Service "${key.name}" is not registered.`);
    }
    return this.instances.get(key) as T;
  }

  tryResolve<T>(key: ServiceKey<T>): T | undefined {
    this.assertNotDisposed();
    return this.instances.get(key) as T | undefined;
  }

  has(key: ServiceKey<unknown>): boolean {
    return this.instances.has(key);
  }

  /** Initializes every service registered since the previous call, in registration order. */
  async initializeAll(): Promise<void> {
    this.assertNotDisposed();
    while (this.initializedCount < this.registrationOrder.length) {
      const instance = this.registrationOrder[this.initializedCount];
      this.initializedCount++;
      if (isInitializable(instance)) {
        await instance.initialize();
      }
    }
  }

  /**
   * Disposes every service in reverse registration order. A failing dispose()
   * does not stop the others; all failures are rethrown together afterwards.
   * The container cannot be used afterwards.
   */
  disposeAll(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    const failures: unknown[] = [];
    for (let i = this.registrationOrder.length - 1; i >= 0; i--) {
      const instance = this.registrationOrder[i];
      if (isDisposable(instance)) {
        try {
          instance.dispose();
        } catch (error) {
          failures.push(error);
        }
      }
    }
    this.instances.clear();
    this.registrationOrder.length = 0;
    if (failures.length > 0) {
      throw new AggregateError(failures, `${failures.length} service(s) failed to dispose.`);
    }
  }

  private assertNotDisposed(): void {
    if (this.disposed) {
      throw new Error('The service container has been disposed.');
    }
  }
}

import type { LogLevel, Logger } from '../../src/core/logging/Logger';

export interface LogEntry {
  readonly level: LogLevel;
  readonly category: string | undefined;
  readonly message: string;
  readonly details: readonly unknown[];
}

/** Logger test double that records entries. Category loggers share their parent's entry list. */
export class MemoryLogger implements Logger {
  constructor(
    readonly entries: LogEntry[] = [],
    private readonly category: string | undefined = undefined,
  ) {}

  debug(message: string, ...details: unknown[]): void {
    this.record('debug', message, details);
  }

  info(message: string, ...details: unknown[]): void {
    this.record('info', message, details);
  }

  warn(message: string, ...details: unknown[]): void {
    this.record('warn', message, details);
  }

  error(message: string, ...details: unknown[]): void {
    this.record('error', message, details);
  }

  withCategory(category: string): Logger {
    return new MemoryLogger(this.entries, this.category === undefined ? category : `${this.category}/${category}`);
  }

  messages(level?: LogLevel): string[] {
    return this.entries.filter((entry) => level === undefined || entry.level === level).map((entry) => entry.message);
  }

  private record(level: LogLevel, message: string, details: unknown[]): void {
    this.entries.push({ level, category: this.category, message, details });
  }
}

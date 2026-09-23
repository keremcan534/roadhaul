import { LOG_LEVELS, type LogLevel, type Logger } from './Logger';

/**
 * Where log lines are written; in the browser this is `console`. Injected so
 * the core layer never touches platform globals.
 */
export type LogSink = Readonly<Record<LogLevel, (...args: unknown[]) => void>>;

export interface ConsoleLoggerOptions {
  readonly sink: LogSink;
  readonly minLevel: LogLevel;
  readonly category?: string;
}

/** Writes messages at or above `minLevel` to a console-like sink. */
export class ConsoleLogger implements Logger {
  private readonly minRank: number;
  private readonly prefix: string;

  constructor(private readonly options: ConsoleLoggerOptions) {
    this.minRank = LOG_LEVELS.indexOf(options.minLevel);
    this.prefix = options.category === undefined ? '' : `[${options.category}] `;
  }

  debug(message: string, ...details: unknown[]): void {
    this.write('debug', message, details);
  }

  info(message: string, ...details: unknown[]): void {
    this.write('info', message, details);
  }

  warn(message: string, ...details: unknown[]): void {
    this.write('warn', message, details);
  }

  error(message: string, ...details: unknown[]): void {
    this.write('error', message, details);
  }

  withCategory(category: string): Logger {
    const parent = this.options.category;
    return new ConsoleLogger({
      ...this.options,
      category: parent === undefined ? category : `${parent}/${category}`,
    });
  }

  private write(level: LogLevel, message: string, details: unknown[]): void {
    if (LOG_LEVELS.indexOf(level) < this.minRank) {
      return;
    }
    this.options.sink[level](this.prefix + message, ...details);
  }
}

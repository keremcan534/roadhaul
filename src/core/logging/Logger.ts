export const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

/**
 * Replaceable logging boundary. Game code logs through this interface, never
 * through `console` directly, so output can be filtered, captured in tests or
 * forwarded to a crash reporter later.
 *
 * Do not log from per-frame code: building the message allocates.
 */
export interface Logger {
  debug(message: string, ...details: unknown[]): void;
  info(message: string, ...details: unknown[]): void;
  warn(message: string, ...details: unknown[]): void;
  error(message: string, ...details: unknown[]): void;
  /** Returns a logger that prefixes every message with `[category]`. */
  withCategory(category: string): Logger;
}

export function isLogLevel(value: string): value is LogLevel {
  return (LOG_LEVELS as readonly string[]).includes(value);
}

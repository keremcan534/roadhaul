import { describe, expect, it } from 'vitest';
import { ConsoleLogger, type LogSink } from '../../../../src/core/logging/ConsoleLogger';
import { isLogLevel, type LogLevel } from '../../../../src/core/logging/Logger';

function createSink() {
  const lines: { level: LogLevel; args: unknown[] }[] = [];
  const write = (level: LogLevel) => (...args: unknown[]) => {
    lines.push({ level, args });
  };
  const sink: LogSink = { debug: write('debug'), info: write('info'), warn: write('warn'), error: write('error') };
  return { sink, lines };
}

describe('ConsoleLogger', () => {
  it('drops messages below the minimum level', () => {
    const { sink, lines } = createSink();
    const logger = new ConsoleLogger({ sink, minLevel: 'warn' });

    logger.debug('d');
    logger.info('i');
    logger.warn('w');
    logger.error('e');

    expect(lines.map((line) => line.level)).toEqual(['warn', 'error']);
  });

  it('prefixes messages with nested categories', () => {
    const { sink, lines } = createSink();
    const logger = new ConsoleLogger({ sink, minLevel: 'debug' }).withCategory('Boot').withCategory('Content');

    logger.info('loaded');

    expect(lines[0]?.args[0]).toBe('[Boot/Content] loaded');
  });

  it('passes extra details through unchanged', () => {
    const { sink, lines } = createSink();
    const error = new Error('broken');

    new ConsoleLogger({ sink, minLevel: 'debug' }).error('failed', error, 42);

    expect(lines[0]?.args).toEqual(['failed', error, 42]);
  });

  it('recognises valid log level names', () => {
    expect(isLogLevel('warn')).toBe(true);
    expect(isLogLevel('verbose')).toBe(false);
  });
});

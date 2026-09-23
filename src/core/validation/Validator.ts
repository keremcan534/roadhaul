export interface ValidationIssue {
  /** Where the problem is, e.g. `missions[2].cargoId`. */
  readonly path: string;
  readonly message: string;
}

export class ValidationError extends Error {
  constructor(
    readonly subject: string,
    readonly issues: readonly ValidationIssue[],
  ) {
    super(
      `${subject} is invalid (${issues.length} issue${issues.length === 1 ? '' : 's'}):\n` +
        issues.map((issue) => `  - ${issue.path}: ${issue.message}`).join('\n'),
    );
    this.name = 'ValidationError';
  }
}

/** Stable identifiers: lowercase snake_case, e.g. `rh_h1`, `frozen_food`. */
const ID_PATTERN = /^[a-z0-9]+(?:_[a-z0-9]+)*$/;

/**
 * Collects every validation problem instead of stopping at the first one, so
 * content authors see all mistakes at once. Values are typed `unknown` because
 * the same checks will guard untrusted input (JSON content packs, save files).
 */
export class Validator {
  private readonly collected: ValidationIssue[] = [];

  get issues(): readonly ValidationIssue[] {
    return this.collected;
  }

  get isValid(): boolean {
    return this.collected.length === 0;
  }

  report(path: string, message: string): void {
    this.collected.push({ path, message });
  }

  /** Records `message` when `condition` is false. Returns `condition`. */
  check(condition: boolean, path: string, message: string): boolean {
    if (!condition) {
      this.report(path, message);
    }
    return condition;
  }

  id(value: unknown, path: string): boolean {
    return this.check(
      typeof value === 'string' && ID_PATTERN.test(value),
      path,
      `must be a snake_case id, got ${describe(value)}`,
    );
  }

  positiveNumber(value: unknown, path: string): boolean {
    return this.check(isFiniteNumber(value) && value > 0, path, `must be a positive number, got ${describe(value)}`);
  }

  positiveInteger(value: unknown, path: string): boolean {
    return this.check(
      Number.isInteger(value) && (value as number) > 0,
      path,
      `must be a positive integer, got ${describe(value)}`,
    );
  }

  nonNegativeInteger(value: unknown, path: string): boolean {
    return this.check(
      Number.isInteger(value) && (value as number) >= 0,
      path,
      `must be a non-negative integer, got ${describe(value)}`,
    );
  }

  /** A ratio in the closed range 0..1. */
  fraction(value: unknown, path: string): boolean {
    return this.check(
      isFiniteNumber(value) && value >= 0 && value <= 1,
      path,
      `must be a number from 0 to 1, got ${describe(value)}`,
    );
  }

  oneOf(value: unknown, allowed: readonly string[], path: string): boolean {
    return this.check(
      typeof value === 'string' && allowed.includes(value),
      path,
      `must be one of ${allowed.join(', ')}, got ${describe(value)}`,
    );
  }

  boolean(value: unknown, path: string): boolean {
    return this.check(typeof value === 'boolean', path, `must be true or false, got ${describe(value)}`);
  }

  /** Throws a ValidationError describing every collected issue, if there are any. */
  throwIfInvalid(subject: string): void {
    if (!this.isValid) {
      throw new ValidationError(subject, this.collected);
    }
  }
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function describe(value: unknown): string {
  return typeof value === 'string' ? `"${value}"` : String(value);
}

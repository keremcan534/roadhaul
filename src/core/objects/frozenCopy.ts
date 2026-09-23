/**
 * Returns a deep copy of plain data (objects, arrays, primitives) in which
 * every level is frozen, so runtime code cannot mutate it by accident.
 * Class instances, Maps and Dates are not supported: they become plain objects.
 */
export function frozenCopy<T>(value: T): T {
  if (Array.isArray(value)) {
    return Object.freeze(value.map((item: unknown) => frozenCopy(item))) as T;
  }
  if (value !== null && typeof value === 'object') {
    // Object.fromEntries defines own data properties, so even a "__proto__" key
    // (possible in parsed JSON) stays data instead of replacing the prototype.
    const copy = Object.fromEntries(Object.entries(value).map(([key, item]) => [key, frozenCopy(item)]));
    return Object.freeze(copy) as T;
  }
  return value;
}

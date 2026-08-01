export function deepFreeze<T>(value: T): T {
  const seen = new WeakSet<object>();
  const visit = (current: unknown): void => {
    if (current === null || typeof current !== "object" || seen.has(current)) return;
    seen.add(current);
    for (const key of Reflect.ownKeys(current)) {
      visit((current as Record<PropertyKey, unknown>)[key]);
    }
    if (!Object.isFrozen(current)) Object.freeze(current);
  };
  visit(value);
  return value;
}

export function freezeMap<V>(source: Map<string, V>): ReadonlyMap<string, V> {
  const clone = new Map<string, V>();
  for (const [key, value] of source) clone.set(key, deepFreeze(value));
  return new Proxy(clone, {
    get(target, property: string | symbol) {
      if (property === "set" || property === "delete" || property === "clear") return () => { throw new TypeError("immutable"); };
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as ReadonlyMap<string, V>;
}

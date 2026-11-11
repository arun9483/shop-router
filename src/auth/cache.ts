/**
 * Remembers each key's value for `ttlMs`. Concurrent calls for the same key share one load, and a
 * failed load is not remembered, so the next call tries again.
 */
export class TtlCache<T> {
  readonly #entries = new Map<string, { until: number; value: Promise<T> }>();

  constructor(
    readonly ttlMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  get(key: string, load: () => Promise<T>): Promise<T> {
    const time = this.now();
    const hit = this.#entries.get(key);
    if (hit && hit.until > time) return hit.value;

    const value = load();
    this.#entries.set(key, { until: time + this.ttlMs, value });
    value.catch(() => {
      if (this.#entries.get(key)?.value === value) this.#entries.delete(key);
    });
    this.#sweep(time);
    return value;
  }

  delete(key: string): void {
    this.#entries.delete(key);
  }

  // Drops expired entries now and then, so the map does not grow with every session ever seen.
  #sweep(time: number): void {
    if (this.#entries.size < 1000) return;
    for (const [key, entry] of this.#entries) {
      if (entry.until <= time) this.#entries.delete(key);
    }
  }
}

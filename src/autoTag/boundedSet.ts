/**
 * Insertion-ordered bounded set for long-lived chat sessions.
 * Re-adding an item refreshes its recency; the oldest identities are evicted first.
 */
export class BoundedSet<T> {
  private readonly values = new Map<T, true>();

  constructor(private readonly capacity: number) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new RangeError('BoundedSet capacity must be a positive integer');
    }
  }

  get size(): number {
    return this.values.size;
  }

  has(value: T): boolean {
    return this.values.has(value);
  }

  add(value: T): this {
    this.values.delete(value);
    this.values.set(value, true);
    if (this.values.size > this.capacity) {
      const oldest = this.values.keys().next().value as T | undefined;
      if (oldest !== undefined) this.values.delete(oldest);
    }
    return this;
  }

  delete(value: T): boolean {
    return this.values.delete(value);
  }

  clear(): void {
    this.values.clear();
  }
}

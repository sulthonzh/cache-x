/**
 * cache-x — Zero-dependency caching primitives
 *
 * LRU, LFU, TTL, and Hybrid cache implementations with clean APIs.
 */

// ─── Shared Types ────────────────────────────────────────────────

export interface CacheStats {
  hits: number;
  misses: number;
  size: number;
  capacity: number;
  hitRate: number;
}

export interface CacheEntry<V> {
  value: V;
  // LRU bookkeeping
  lastAccessed: number;
  // LFU bookkeeping
  frequency: number;
  // TTL bookkeeping (0 = no expiry)
  expiresAt: number;
}

// ─── LRU Cache ───────────────────────────────────────────────────

/**
 * Least Recently Used cache.
 * Evicts the item that was accessed longest ago when capacity is reached.
 * O(1) get/set operations using a Map (insertion-order = access-order).
 */
export class LRUCache<K, V> {
  protected store = new Map<K, CacheEntry<V>>();
  protected hits = 0;
  protected misses = 0;
  public readonly capacity: number;

  constructor(capacity: number = 100) {
    if (capacity < 1) throw new RangeError('capacity must be >= 1');
    this.capacity = capacity;
  }

  get(key: K): V | undefined {
    const entry = this.store.get(key);
    if (entry === undefined) {
      this.misses++;
      return undefined;
    }
    this.hits++;
    // Move to end (most recently used) by re-inserting
    this.store.delete(key);
    entry.lastAccessed = Date.now();
    this.store.set(key, entry);
    return entry.value;
  }

  set(key: K, value: V, ttl?: number): void {
    if (this.store.has(key)) {
      this.store.delete(key);
    } else if (this.store.size >= this.capacity) {
      // Evict oldest (first entry in Map)
      const oldest = this.store.keys().next().value;
      if (oldest !== undefined) this.store.delete(oldest);
    }
    this.store.set(key, {
      value,
      lastAccessed: Date.now(),
      frequency: 0,
      expiresAt: ttl ? Date.now() + ttl : 0,
    });
  }

  has(key: K): boolean {
    return this.store.has(key);
  }

  delete(key: K): boolean {
    return this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
    this.hits = 0;
    this.misses = 0;
  }

  get size(): number {
    return this.store.size;
  }

  keys(): IterableIterator<K> {
    return this.store.keys();
  }

  *values(): IterableIterator<V> {
    for (const entry of this.store.values()) yield entry.value;
  }

  *entries(): IterableIterator<[K, V]> {
    for (const [key, entry] of this.store) yield [key, entry.value];
  }

  [Symbol.iterator](): IterableIterator<[K, V]> {
    return this.entries();
  }

  stats(): CacheStats {
    const total = this.hits + this.misses;
    return {
      hits: this.hits,
      misses: this.misses,
      size: this.store.size,
      capacity: this.capacity,
      hitRate: total === 0 ? 0 : this.hits / total,
    };
  }

  toJSON(): Array<[K, V]> {
    return [...this.store.entries()].map(([k, e]) => [k, e.value]);
  }
}

// ─── LFU Cache ───────────────────────────────────────────────────

/**
 * Least Frequently Used cache.
 * Evicts the item with the lowest access frequency when capacity is reached.
 */
export class LFUCache<K, V> {
  protected store = new Map<K, CacheEntry<V>>();
  protected hits = 0;
  protected misses = 0;
  public readonly capacity: number;

  constructor(capacity: number = 100) {
    if (capacity < 1) throw new RangeError('capacity must be >= 1');
    this.capacity = capacity;
  }

  get(key: K): V | undefined {
    const entry = this.store.get(key);
    if (entry === undefined) {
      this.misses++;
      return undefined;
    }
    this.hits++;
    entry.frequency++;
    entry.lastAccessed = Date.now();
    return entry.value;
  }

  set(key: K, value: V, ttl?: number): void {
    const existing = this.store.get(key);
    if (existing) {
      existing.value = value;
      existing.frequency++;
      existing.lastAccessed = Date.now();
      return;
    }

    if (this.store.size >= this.capacity) {
      this.evict();
    }

    this.store.set(key, {
      value,
      lastAccessed: Date.now(),
      frequency: 1,
      expiresAt: ttl ? Date.now() + ttl : 0,
    });
  }

  protected evict(): void {
    let minKey: K | undefined;
    let minFreq = Infinity;
    let minTime = Infinity;

    for (const [key, entry] of this.store) {
      if (entry.frequency < minFreq ||
          (entry.frequency === minFreq && entry.lastAccessed < minTime)) {
        minFreq = entry.frequency;
        minTime = entry.lastAccessed;
        minKey = key;
      }
    }

    if (minKey !== undefined) this.store.delete(minKey);
  }

  has(key: K): boolean { return this.store.has(key); }
  delete(key: K): boolean { return this.store.delete(key); }
  clear(): void { this.store.clear(); this.hits = 0; this.misses = 0; }
  get size(): number { return this.store.size; }

  keys(): IterableIterator<K> { return this.store.keys(); }

  *values(): IterableIterator<V> {
    for (const entry of this.store.values()) yield entry.value;
  }

  stats(): CacheStats {
    const total = this.hits + this.misses;
    return {
      hits: this.hits, misses: this.misses,
      size: this.store.size, capacity: this.capacity,
      hitRate: total === 0 ? 0 : this.hits / total,
    };
  }
}

// ─── TTL Cache ───────────────────────────────────────────────────

/**
 * Time-To-Live cache.
 * Entries automatically expire after a configured duration.
 * Lazy expiration on access + periodic cleanup.
 */
export class TTLCache<K, V> {
  protected store = new Map<K, CacheEntry<V>>();
  protected hits = 0;
  protected misses = 0;
  public readonly capacity: number;
  public readonly defaultTTL: number;
  protected cleanupInterval: ReturnType<typeof setInterval> | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _unref(t: any) { t?.unref?.(); }

  constructor(options: { capacity?: number; ttl: number; cleanupInterval?: number } | number) {
    const opts = typeof options === 'number' ? { ttl: options } : options;
    if (opts.ttl <= 0) throw new RangeError('ttl must be > 0');
    this.defaultTTL = opts.ttl;
    this.capacity = opts.capacity ?? 1000;

    if (opts.cleanupInterval && opts.cleanupInterval > 0) {
      this.cleanupInterval = setInterval(() => this.cleanup(), opts.cleanupInterval);
      this._unref(this.cleanupInterval);
    }
  }

  get(key: K): V | undefined {
    const entry = this.store.get(key);
    if (entry === undefined) { this.misses++; return undefined; }
    if (this.isExpired(entry)) {
      this.store.delete(key);
      this.misses++;
      return undefined;
    }
    this.hits++;
    entry.lastAccessed = Date.now();
    return entry.value;
  }

  set(key: K, value: V, ttl?: number): void {
    const effectiveTTL = ttl ?? this.defaultTTL;
    if (this.store.size >= this.capacity && !this.store.has(key)) {
      this.cleanup();
      if (this.store.size >= this.capacity) {
        const oldest = this.store.keys().next().value;
        if (oldest !== undefined) this.store.delete(oldest);
      }
    }
    this.store.set(key, {
      value, lastAccessed: Date.now(), frequency: 0,
      expiresAt: Date.now() + effectiveTTL,
    });
  }

  protected isExpired(entry: CacheEntry<V>): boolean {
    return entry.expiresAt > 0 && Date.now() >= entry.expiresAt;
  }

  cleanup(): number {
    let removed = 0;
    const now = Date.now();
    for (const [key, entry] of this.store) {
      if (entry.expiresAt > 0 && now >= entry.expiresAt) {
        this.store.delete(key);
        removed++;
      }
    }
    return removed;
  }

  has(key: K): boolean {
    const entry = this.store.get(key);
    if (entry === undefined) return false;
    if (this.isExpired(entry)) { this.store.delete(key); return false; }
    return true;
  }

  delete(key: K): boolean { return this.store.delete(key); }
  clear(): void { this.store.clear(); this.hits = 0; this.misses = 0; }
  get size(): number { return this.store.size; }
  keys(): IterableIterator<K> { return this.store.keys(); }

  *values(): IterableIterator<V> {
    for (const [_, entry] of this.store) {
      if (!this.isExpired(entry)) yield entry.value;
    }
  }

  *entries(): IterableIterator<[K, V]> {
    for (const [key, entry] of this.store) {
      if (!this.isExpired(entry)) yield [key, entry.value];
    }
  }

  stats(): CacheStats {
    const total = this.hits + this.misses;
    return {
      hits: this.hits, misses: this.misses,
      size: this.store.size, capacity: this.capacity,
      hitRate: total === 0 ? 0 : this.hits / total,
    };
  }

  destroy(): void {
    if (this.cleanupInterval) { clearInterval(this.cleanupInterval); this.cleanupInterval = null; }
    this.clear();
  }
}

// ─── Hybrid Cache (LRU + TTL) ────────────────────────────────────

/**
 * Hybrid cache combining LRU eviction with TTL expiration.
 * Uses a doubly-linked list for O(1) LRU updates.
 */
export class HybridCache<K, V> {
  protected map = new Map<K, CacheEntry<V>>();
  protected hits = 0;
  protected misses = 0;
  public readonly capacity: number;
  public readonly defaultTTL: number;
  protected cleanupTimer: ReturnType<typeof setInterval> | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _unref(t: any) { t?.unref?.(); }

  constructor(options: { capacity?: number; ttl?: number; cleanupInterval?: number } = {}) {
    this.capacity = options.capacity ?? 100;
    this.defaultTTL = options.ttl ?? 0; // 0 = no TTL

    if (options.cleanupInterval && options.cleanupInterval > 0) {
      this.cleanupTimer = setInterval(() => this.cleanup(), options.cleanupInterval);
      this._unref(this.cleanupTimer);
    }
  }

  get(key: K): V | undefined {
    const entry = this.map.get(key);
    if (entry === undefined) { this.misses++; return undefined; }

    // Check TTL expiry
    if (entry.expiresAt > 0 && Date.now() >= entry.expiresAt) {
      this.map.delete(key);
      this.misses++;
      return undefined;
    }

    this.hits++;
    // Move to MRU position
    this.map.delete(key);
    entry.lastAccessed = Date.now();
    this.map.set(key, entry);
    return entry.value;
  }

  set(key: K, value: V, ttl?: number): void {
    const effectiveTTL = ttl ?? this.defaultTTL;

    if (this.map.has(key)) {
      this.map.delete(key);
    } else if (this.map.size >= this.capacity) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }

    this.map.set(key, {
      value,
      lastAccessed: Date.now(),
      frequency: 0,
      expiresAt: effectiveTTL > 0 ? Date.now() + effectiveTTL : 0,
    });
  }

  has(key: K): boolean {
    const entry = this.map.get(key);
    if (!entry) return false;
    if (entry.expiresAt > 0 && Date.now() >= entry.expiresAt) {
      this.map.delete(key);
      return false;
    }
    return true;
  }

  delete(key: K): boolean { return this.map.delete(key); }

  cleanup(): number {
    let removed = 0;
    const now = Date.now();
    for (const [key, entry] of this.map) {
      if (entry.expiresAt > 0 && now >= entry.expiresAt) {
        this.map.delete(key);
        removed++;
      }
    }
    return removed;
  }

  clear(): void { this.map.clear(); this.hits = 0; this.misses = 0; }
  get size(): number { return this.map.size; }

  keys(): IterableIterator<K> { return this.map.keys(); }

  *values(): IterableIterator<V> {
    for (const [_, entry] of this.map) yield entry.value;
  }

  *entries(): IterableIterator<[K, V]> {
    for (const [key, entry] of this.map) yield [key, entry.value];
  }

  [Symbol.iterator](): IterableIterator<[K, V]> { return this.entries(); }

  stats(): CacheStats {
    const total = this.hits + this.misses;
    return {
      hits: this.hits, misses: this.misses,
      size: this.map.size, capacity: this.capacity,
      hitRate: total === 0 ? 0 : this.hits / total,
    };
  }

  toJSON(): Record<string, V> {
    const obj: Record<string, V> = {};
    for (const [key, entry] of this.map) {
      obj[String(key)] = entry.value;
    }
    return obj;
  }

  destroy(): void {
    if (this.cleanupTimer) { clearInterval(this.cleanupTimer); this.cleanupTimer = null; }
    this.clear();
  }
}

// ─── Factory ─────────────────────────────────────────────────────

export type CacheType = 'lru' | 'lfu' | 'ttl' | 'hybrid';

export interface CacheOptions {
  capacity?: number;
  ttl?: number;
  cleanupInterval?: number;
}

export function createCache<K, V>(
  type: CacheType,
  options: CacheOptions = {}
): LRUCache<K, V> | LFUCache<K, V> | TTLCache<K, V> | HybridCache<K, V> {
  switch (type) {
    case 'lru':
      return new LRUCache<K, V>(options.capacity ?? 100);
    case 'lfu':
      return new LFUCache<K, V>(options.capacity ?? 100);
    case 'ttl':
      if (!options.ttl) throw new Error('ttl is required for TTLCache');
      return new TTLCache<K, V>({ ttl: options.ttl, capacity: options.capacity, cleanupInterval: options.cleanupInterval });
    case 'hybrid':
      return new HybridCache<K, V>(options);
    default:
      throw new Error(`Unknown cache type: ${type}`);
  }
}

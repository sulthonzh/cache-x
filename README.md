# cache-x

Zero-dependency caching primitives for JavaScript/TypeScript.

Four cache strategies in one tiny package: **LRU**, **LFU**, **TTL**, and **Hybrid** (LRU + TTL).

## Install

```bash
npm install cache-x
```

## Why?

Every project needs caching. Most reach for `lru-cache` (great library, but 30KB minified) or roll their own broken implementation. `cache-x` gives you four production-ready cache strategies in ~5KB with zero dependencies.

## Quick Start

```typescript
import { LRUCache, TTLCache, createCache } from 'cache-x';

// LRU — evicts least recently accessed
const lru = new LRUCache<string, User>(100);
lru.set('user:1', fetchUser());
lru.get('user:1'); // moves to most-recently-used

// TTL — entries auto-expire
const ttl = new TTLCache({ ttl: 60_000 }); // 60 second entries
ttl.set('token', 'abc123');
setTimeout(() => ttl.get('token'), 65_000); // → undefined (expired)

// Factory
const cache = createCache('hybrid', { capacity: 500, ttl: 30_000 });
```

## Cache Types

### LRUCache

Least Recently Used. When full, evicts the entry accessed longest ago.

```typescript
const cache = new LRUCache<string, number>(3);
cache.set('a', 1);
cache.set('b', 2);
cache.set('c', 3);
cache.get('a');     // 'a' is now most recently used
cache.set('d', 4);  // evicts 'b' (least recently used)
```

### LFUCache

Least Frequently Used. Evicts entries with the lowest access count. Ties broken by recency.

```typescript
const cache = new LFUCache(3);
cache.set('a', 1);
cache.set('b', 2);
cache.set('c', 3);
cache.get('a'); cache.get('a');  // freq: 3
cache.get('b');                   // freq: 2
cache.set('d', 4);                // evicts 'c' (freq: 1)
```

### TTLCache

Time-To-Live. Entries expire after a configured duration. Supports periodic cleanup.

```typescript
const cache = new TTLCache({
  ttl: 5000,              // 5s default TTL
  capacity: 1000,         // max entries
  cleanupInterval: 10000  // purge expired every 10s
});

cache.set('session', data);       // expires in 5s
cache.set('temp', data, 1000);    // custom 1s TTL

const removed = cache.cleanup();  // manual purge, returns count
```

### HybridCache (LRU + TTL)

Best of both worlds. LRU eviction + optional TTL per entry.

```typescript
const cache = new HybridCache({
  capacity: 500,
  ttl: 30_000,           // default TTL for all entries
  cleanupInterval: 60_000
});

cache.set('a', value);          // uses default TTL
cache.set('b', value, 5000);    // custom 5s TTL
cache.set('c', value);          // uses default TTL

// Eviction is LRU among non-expired entries
```

## API

All caches share a common interface:

| Method | Description |
|--------|-------------|
| `get(key)` | Returns value or `undefined` |
| `set(key, value, ttl?)` | Insert/update entry (optional TTL override) |
| `has(key)` | Check existence (respects expiry) |
| `delete(key)` | Remove entry, returns boolean |
| `clear()` | Remove all entries |
| `size` | Number of entries |
| `keys()` | Iterable of keys |
| `values()` | Iterable of values |
| `stats()` | `{ hits, misses, size, capacity, hitRate }` |

### Factory

```typescript
import { createCache } from 'cache-x';

const cache = createCache('lru', { capacity: 100 });
const cache = createCache('lfu', { capacity: 100 });
const cache = createCache('ttl', { ttl: 5000, capacity: 100 });
const cache = createCache('hybrid', { capacity: 100, ttl: 5000 });
```

## When to Use Which

- **LRU**: General-purpose. Best when access patterns have temporal locality (recently-used items likely reused).
- **LFU**: When some items are perennially popular. Good for lookup tables, config caches.
- **TTL**: When data goes stale after fixed time. Session tokens, API responses, rate limiting.
- **Hybrid**: When you need bounded memory + time-based expiry. The safest default for production.

## Stats

Track cache effectiveness to tune capacity and strategy:

```typescript
const stats = cache.stats();
// { hits: 842, misses: 158, size: 87, capacity: 100, hitRate: 0.842 }
```

If hitRate < 0.7, consider increasing capacity or switching strategies.

## License

MIT

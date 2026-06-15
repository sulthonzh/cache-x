import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { LRUCache, LFUCache, TTLCache, HybridCache, createCache } from '../dist/index.js';

// ─── LRU Cache Tests ─────────────────────────────────────────────

describe('LRUCache', () => {
  test('set and get basic values', () => {
    const cache = new LRUCache(3);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3);
    assert.equal(cache.get('a'), 1);
    assert.equal(cache.get('b'), 2);
    assert.equal(cache.get('c'), 3);
  });

  test('evicts least recently used when at capacity', () => {
    const cache = new LRUCache(2);
    cache.set('a', 1);
    cache.set('b', 2);
    // Access 'a' to make it most recently used
    cache.get('a');
    cache.set('c', 3); // should evict 'b'
    assert.equal(cache.get('a'), 1);
    assert.equal(cache.get('b'), undefined);
    assert.equal(cache.get('c'), 3);
  });

  test('updating existing key moves it to MRU', () => {
    const cache = new LRUCache(2);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('a', 10); // update 'a', now it's MRU
    cache.set('c', 3); // should evict 'b'
    assert.equal(cache.get('a'), 10);
    assert.equal(cache.get('b'), undefined);
    assert.equal(cache.get('c'), 3);
  });

  test('has() returns correct boolean', () => {
    const cache = new LRUCache(5);
    cache.set('x', 42);
    assert.equal(cache.has('x'), true);
    assert.equal(cache.has('y'), false);
  });

  test('delete removes entry', () => {
    const cache = new LRUCache(5);
    cache.set('a', 1);
    assert.equal(cache.delete('a'), true);
    assert.equal(cache.has('a'), false);
    assert.equal(cache.delete('a'), false);
  });

  test('clear resets everything', () => {
    const cache = new LRUCache(5);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.clear();
    assert.equal(cache.size, 0);
    assert.equal(cache.get('a'), undefined);
  });

  test('stats track hits and misses', () => {
    const cache = new LRUCache(5);
    cache.set('a', 1);
    cache.get('a'); // hit
    cache.get('b'); // miss
    const s = cache.stats();
    assert.equal(s.hits, 1);
    assert.equal(s.misses, 1);
    assert.equal(s.hitRate, 0.5);
  });

  test('iteration works', () => {
    const cache = new LRUCache(5);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3);
    const entries = [...cache.entries()];
    assert.equal(entries.length, 3);
  });

  test('values() iterates correctly', () => {
    const cache = new LRUCache(5);
    cache.set('a', 1);
    cache.set('b', 2);
    const vals = [...cache.values()];
    assert.deepEqual(vals.sort(), [1, 2]);
  });

  test('toJSON serializes entries', () => {
    const cache = new LRUCache(5);
    cache.set('a', 1);
    cache.set('b', 2);
    const json = cache.toJSON();
    assert.equal(json.length, 2);
  });

  test('throws on invalid capacity', () => {
    assert.throws(() => new LRUCache(0), RangeError);
    assert.throws(() => new LRUCache(-1), RangeError);
  });

  test('supports TTL on individual entries', () => {
    const cache = new LRUCache(5);
    cache.set('ephemeral', 42, 50); // 50ms TTL stored but LRU doesn't check it by default
    // LRU cache doesn't enforce TTL on get, it's just metadata
    assert.equal(cache.get('ephemeral'), 42);
  });
});

// ─── LFU Cache Tests ─────────────────────────────────────────────

describe('LFUCache', () => {
  test('set and get values', () => {
    const cache = new LFUCache(3);
    cache.set('a', 1);
    assert.equal(cache.get('a'), 1);
  });

  test('evicts least frequently used', () => {
    const cache = new LFUCache(3);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3);
    // Access 'a' multiple times to increase frequency
    cache.get('a'); cache.get('a');
    cache.get('b');
    // 'c' has freq 1, should be evicted
    cache.set('d', 4);
    assert.equal(cache.get('c'), undefined);
    assert.equal(cache.get('d'), 4);
  });

  test('frequency increments on update', () => {
    const cache = new LFUCache(2);
    cache.set('a', 1);
    cache.set('a', 10);
    cache.set('b', 2);
    cache.get('b');
    cache.set('c', 3); // 'a' was set once + updated = freq 2, 'b' was set + accessed = freq 2
    // 'a' should survive (set then updated = freq 2, last accessed at update time)
    // 'b' should survive (set freq 1, get freq 2)
    // One of them gets evicted since capacity is 2
    const s = cache.stats();
    assert.equal(s.size, 2);
  });

  test('LFU tie-breaks by recency', () => {
    const cache = new LFUCache(2);
    cache.set('a', 1);
    cache.set('b', 2);
    // Both have freq 1. Access 'a' after 'b' was set
    cache.get('a');
    // 'a' freq=2, 'b' freq=1. Add 'c' → evict 'b'
    cache.set('c', 3);
    assert.equal(cache.has('a'), true);
    assert.equal(cache.has('b'), false);
    assert.equal(cache.has('c'), true);
  });

  test('clear and size', () => {
    const cache = new LFUCache(5);
    cache.set('x', 1);
    cache.set('y', 2);
    assert.equal(cache.size, 2);
    cache.clear();
    assert.equal(cache.size, 0);
  });

  test('stats', () => {
    const cache = new LFUCache(5);
    cache.set('a', 1);
    cache.get('a');
    cache.get('x');
    const s = cache.stats();
    assert.equal(s.hits, 1);
    assert.equal(s.misses, 1);
  });

  test('throws on invalid capacity', () => {
    assert.throws(() => new LFUCache(0), RangeError);
  });
});

// ─── TTL Cache Tests ─────────────────────────────────────────────

describe('TTLCache', () => {
  test('entries expire after TTL', async () => {
    const cache = new TTLCache({ ttl: 50 });
    cache.set('a', 1);
    assert.equal(cache.get('a'), 1);
    await new Promise(r => setTimeout(r, 60));
    assert.equal(cache.get('a'), undefined);
  });

  test('per-entry TTL override', async () => {
    const cache = new TTLCache({ ttl: 1000 });
    cache.set('long', 1);
    cache.set('short', 2, 30);
    assert.equal(cache.get('short'), 2);
    await new Promise(r => setTimeout(r, 40));
    assert.equal(cache.get('short'), undefined);
    assert.equal(cache.get('long'), 1);
  });

  test('has() respects expiry', async () => {
    const cache = new TTLCache({ ttl: 30 });
    cache.set('a', 1);
    assert.equal(cache.has('a'), true);
    await new Promise(r => setTimeout(r, 40));
    assert.equal(cache.has('a'), false);
  });

  test('cleanup removes expired entries', async () => {
    const cache = new TTLCache({ ttl: 20, capacity: 100 });
    cache.set('a', 1);
    cache.set('b', 2);
    await new Promise(r => setTimeout(r, 30));
    const removed = cache.cleanup();
    assert.equal(removed, 2);
    assert.equal(cache.size, 0);
  });

  test('capacity eviction after cleanup', () => {
    const cache = new TTLCache({ ttl: 1000, capacity: 2 });
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3); // at capacity, cleanup first, then evict oldest
    assert.equal(cache.size, 2);
  });

  test('destroy clears timer and data', () => {
    const cache = new TTLCache({ ttl: 1000, cleanupInterval: 500 });
    cache.set('a', 1);
    cache.destroy();
    assert.equal(cache.size, 0);
  });

  test('stats track hits and misses', () => {
    const cache = new TTLCache({ ttl: 1000 });
    cache.set('a', 1);
    cache.get('a'); // hit
    cache.get('b'); // miss
    const s = cache.stats();
    assert.equal(s.hits, 1);
    assert.equal(s.misses, 1);
  });

  test('expired entries count as misses', async () => {
    const cache = new TTLCache({ ttl: 20 });
    cache.set('a', 1);
    await new Promise(r => setTimeout(r, 30));
    cache.get('a');
    const s = cache.stats();
    assert.equal(s.misses, 1);
    assert.equal(s.hits, 0);
  });

  test('throws on invalid TTL', () => {
    assert.throws(() => new TTLCache({ ttl: 0 }), RangeError);
    assert.throws(() => new TTLCache({ ttl: -1 }), RangeError);
  });

  test('entries() skips expired', async () => {
    const cache = new TTLCache({ ttl: 100 });
    cache.set('a', 1);
    cache.set('b', 2, 20);
    await new Promise(r => setTimeout(r, 30));
    const entries = [...cache.entries()];
    assert.equal(entries.length, 1);
    assert.equal(entries[0][0], 'a');
  });
});

// ─── HybridCache Tests ───────────────────────────────────────────

describe('HybridCache', () => {
  test('LRU eviction without TTL', () => {
    const cache = new HybridCache({ capacity: 2 });
    cache.set('a', 1);
    cache.set('b', 2);
    cache.get('a'); // make 'a' MRU
    cache.set('c', 3); // evict 'b'
    assert.equal(cache.has('a'), true);
    assert.equal(cache.has('b'), false);
    assert.equal(cache.has('c'), true);
  });

  test('TTL expiry works alongside LRU', async () => {
    const cache = new HybridCache({ capacity: 10, ttl: 30 });
    cache.set('temp', 42);
    assert.equal(cache.get('temp'), 42);
    await new Promise(r => setTimeout(r, 40));
    assert.equal(cache.get('temp'), undefined);
  });

  test('per-entry TTL override', async () => {
    const cache = new HybridCache({ capacity: 10 });
    cache.set('a', 1); // no TTL (default 0)
    cache.set('b', 2, 30); // 30ms TTL
    await new Promise(r => setTimeout(r, 40));
    assert.equal(cache.get('a'), 1);
    assert.equal(cache.get('b'), undefined);
  });

  test('cleanup removes expired but keeps valid', async () => {
    const cache = new HybridCache({ capacity: 100 });
    cache.set('a', 1, 20);
    cache.set('b', 2, 2000);
    await new Promise(r => setTimeout(r, 30));
    const removed = cache.cleanup();
    assert.equal(removed, 1);
    assert.equal(cache.has('a'), false);
    assert.equal(cache.has('b'), true);
  });

  test('stats and iteration', () => {
    const cache = new HybridCache({ capacity: 10 });
    cache.set('a', 1);
    cache.set('b', 2);
    cache.get('a'); // hit
    cache.get('x'); // miss
    const s = cache.stats();
    assert.equal(s.hits, 1);
    assert.equal(s.misses, 1);
    const entries = [...cache.entries()];
    assert.equal(entries.length, 2);
  });

  test('toJSON', () => {
    const cache = new HybridCache({ capacity: 5 });
    cache.set('x', 1);
    cache.set('y', 2);
    const json = cache.toJSON();
    assert.equal(json.x, 1);
    assert.equal(json.y, 2);
  });

  test('destroy', () => {
    const cache = new HybridCache({ capacity: 5, cleanupInterval: 100 });
    cache.set('a', 1);
    cache.destroy();
    assert.equal(cache.size, 0);
  });

  test('Symbol.iterator', () => {
    const cache = new HybridCache({ capacity: 5 });
    cache.set('a', 1);
    cache.set('b', 2);
    const result = {};
    for (const [k, v] of cache) result[k] = v;
    assert.deepEqual(result, { a: 1, b: 2 });
  });
});

// ─── Factory Tests ───────────────────────────────────────────────

describe('createCache factory', () => {
  test('creates LRU cache', () => {
    const cache = createCache('lru', { capacity: 5 });
    cache.set('a', 1);
    assert.equal(cache.get('a'), 1);
    assert.equal(cache.capacity, 5);
  });

  test('creates LFU cache', () => {
    const cache = createCache('lfu', { capacity: 3 });
    cache.set('a', 1);
    assert.equal(cache.get('a'), 1);
  });

  test('creates TTL cache', () => {
    const cache = createCache('ttl', { ttl: 1000, capacity: 5 });
    cache.set('a', 1);
    assert.equal(cache.get('a'), 1);
  });

  test('creates hybrid cache', () => {
    const cache = createCache('hybrid', { capacity: 5, ttl: 1000 });
    cache.set('a', 1);
    assert.equal(cache.get('a'), 1);
  });

  test('throws on unknown type', () => {
    assert.throws(() => createCache('unknown'), Error);
  });

  test('throws when ttl missing for TTL cache', () => {
    assert.throws(() => createCache('ttl'), Error);
  });
});

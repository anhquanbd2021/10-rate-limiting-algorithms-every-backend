// Rate limiter mechanics — every limiter takes `now` (ms) explicitly so a
// request stream replays deterministically. Each `allow(now, cost)` returns
// `{ allowed, ... }`; denials carry `retryAfterMs` where it is computable.
//
// The honest taxonomy from the article:
//   mechanisms    — fixedWindow, slidingWindow, slidingLog, tokenBucket,
//                   leakyBucket, concurrency
//   deployment    — the same counters shared across nodes (distributed)
//   policy        — perKey(): any mechanism keyed by identity
//   knob          — "burst allowance" is tokenBucket's `capacity`
//   client        — backoffSchedule(): what a rejected client should do

/* --- Mechanisms ---------------------------------------------------------- */

// Fixed window: one counter per clock-aligned window. O(1) memory, and the
// boundary-burst bug — nothing stops `limit` requests at the end of one
// window and `limit` more at the start of the next.
export function fixedWindow({ limit, windowMs }) {
  let windowStart = -1;
  let count = 0;
  return {
    name: 'fixed window',
    state: () => ({ windowStart, count }),
    allow(now, cost = 1) {
      const w = Math.floor(now / windowMs) * windowMs;
      if (w !== windowStart) { windowStart = w; count = 0; }
      if (count + cost <= limit) {
        count += cost;
        return { allowed: true, remaining: limit - count };
      }
      return { allowed: false, remaining: 0, retryAfterMs: windowStart + windowMs - now };
    },
  };
}

// Sliding window counter: weight the previous window by how much of it is
// still inside the rolling span. Still O(1), approximate — it assumes the
// previous window's traffic was spread evenly.
export function slidingWindow({ limit, windowMs }) {
  let currStart = -windowMs; // windows before the first request weigh 0
  let prevCount = 0;
  let currCount = 0;
  return {
    name: 'sliding window',
    state: () => ({ currStart, prevCount, currCount }),
    allow(now, cost = 1) {
      const w = Math.floor(now / windowMs) * windowMs;
      if (w === currStart + windowMs) { prevCount = currCount; currCount = 0; currStart = w; }
      else if (w !== currStart) { prevCount = 0; currCount = 0; currStart = w; }
      const elapsed = (now - currStart) / windowMs;
      const estimate = prevCount * (1 - elapsed) + currCount;
      if (estimate + cost <= limit) {
        currCount += cost;
        return { allowed: true, estimate };
      }
      // Time until the estimate decays enough to fit `cost` more.
      let retryAfterMs;
      if (prevCount <= 0) {
        retryAfterMs = currStart + windowMs - now;
      } else {
        const decayNeeded = estimate + cost - limit; // how much prev must shrink
        const tNeeded = decayNeeded / prevCount;     // fraction of window
        retryAfterMs = Math.max(1, Math.ceil(tNeeded * windowMs - (now - currStart)));
      }
      return { allowed: false, estimate, retryAfterMs };
    },
  };
}

// Sliding log: a timestamp per admitted request. Exact — the rolling window
// is computed from real history — at O(n) memory and an O(n) prune per call.
export function slidingLog({ limit, windowMs }) {
  const log = [];
  return {
    name: 'sliding log',
    state: () => ({ stored: log.length }),
    allow(now, cost = 1) {
      while (log.length && log[0] <= now - windowMs) log.shift();
      if (log.length + cost <= limit) {
        for (let i = 0; i < cost; i += 1) log.push(now);
        return { allowed: true, stored: log.length };
      }
      const mustExpire = log.length - (limit - cost); // entries that must age out
      const retryAfterMs = mustExpire > 0 ? log[mustExpire - 1] + windowMs - now : 1;
      return { allowed: false, stored: log.length, retryAfterMs };
    },
  };
}

// Token bucket: tokens refill at `ratePerSec`, capped at `capacity`.
// Rate and burst are different dials — `capacity` IS the "burst allowance"
// the listicles call a separate algorithm.
export function tokenBucket({ ratePerSec, capacity }) {
  let tokens = capacity;
  let last = null;
  return {
    name: 'token bucket',
    state: () => ({ tokens, last }),
    allow(now, cost = 1) {
      if (last === null) last = now;
      tokens = Math.min(capacity, tokens + ((now - last) * ratePerSec) / 1000);
      last = now;
      if (tokens >= cost) {
        tokens -= cost;
        return { allowed: true, tokens };
      }
      return {
        allowed: false,
        tokens,
        retryAfterMs: Math.ceil(((cost - tokens) / ratePerSec) * 1000),
      };
    },
  };
}

// Leaky bucket: a metered queue. Requests enter (bounded by `capacity`) and
// leave at exactly `ratePerSec` — the output stream is jitter-free no matter
// how bursty the input was. `emitsAt` shows when each request exits.
export function leakyBucket({ ratePerSec, capacity }) {
  const interval = 1000 / ratePerSec;
  const pending = []; // emission times, sorted
  let lastEmit = -Infinity;
  return {
    name: 'leaky bucket',
    state: () => ({ queued: pending.length }),
    allow(now, cost = 1) {
      while (pending.length && pending[0] <= now) pending.shift();
      if (pending.length + cost > capacity) {
        return { allowed: false, queued: pending.length, retryAfterMs: Math.ceil(pending[0] - now) };
      }
      const emitsAt = [];
      for (let i = 0; i < cost; i += 1) {
        // Idle pump emits immediately; a busy pump spaces exits by interval.
        const emitAt = Math.max(now, lastEmit + interval);
        pending.push(emitAt);
        emitsAt.push(emitAt);
        lastEmit = emitAt;
      }
      return { allowed: true, queued: pending.length, emitsAt };
    },
  };
}

// Concurrency limit: counts in-flight requests, not requests-per-window.
// A different axis — it is the only limiter here that sees a slow client
// holding a connection open.
export function concurrency({ limit }) {
  const holds = []; // release times, sorted
  return {
    name: 'concurrency limit',
    state: () => ({ inFlight: holds.length }),
    // holdMs is how long the request occupies its slot.
    allow(now, holdMs = 0) {
      while (holds.length && holds[0] <= now) holds.shift();
      if (holds.length >= limit) {
        return { allowed: false, inFlight: holds.length, retryAfterMs: Math.ceil(holds[0] - now) };
      }
      holds.push(now + holdMs);
      holds.sort((a, b) => a - b);
      return { allowed: true, inFlight: holds.length, releasesAt: now + holdMs };
    },
  };
}

/* --- Not algorithms: policy, knob, client -------------------------------- */

// Per-user quota is a policy: wrap ANY mechanism in a key→limiter map.
// The cost is one limiter per distinct key — the memory bill moves with the
// cardinality of your identity space.
export function perKey(factory) {
  const limiters = new Map();
  return {
    name: 'per-key quota',
    size: () => limiters.size,
    allow(key, now, ...args) {
      if (!limiters.has(key)) limiters.set(key, factory());
      return limiters.get(key).allow(now, ...args);
    },
  };
}

// Backoff is client-side: it never limits the server, it keeps rejected
// clients from hammering. Exponential delay, capped at maxMs. `jitter` is a
// fraction: delay lands in [exp·(1−jitter), exp] — "equal jitter" style, the
// cap always holds and retries decorrelate without collapsing to zero.
// `frac` hashes attempt+seed into [0,1) so runs replay deterministically.
export function backoffSchedule({ attempts, baseMs = 200, maxMs = 2000, jitter = 0, seed = 1 }) {
  const frac = (a) => (((seed * 2654435761 + a * 40503) % 1000) / 1000); // demo hash, not crypto
  const delays = [];
  for (let a = 0; a < attempts; a += 1) {
    const exp = Math.min(maxMs, baseMs * 2 ** a);
    delays.push(Math.max(1, Math.round(exp * (1 - jitter + jitter * frac(a)))));
  }
  return delays;
}

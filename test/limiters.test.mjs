import test from 'node:test';
import assert from 'node:assert/strict';
import {
  fixedWindow, slidingWindow, slidingLog, tokenBucket, leakyBucket,
  concurrency, perKey, backoffSchedule,
} from '../public/limiters.mjs';

test('fixed window resets on rollover and reports retryAfterMs', () => {
  const lim = fixedWindow({ limit: 2, windowMs: 1000 });
  assert.equal(lim.allow(100).allowed, true);
  assert.equal(lim.allow(200).allowed, true);
  const denied = lim.allow(300);
  assert.equal(denied.allowed, false);
  assert.equal(denied.retryAfterMs, 700);
  assert.equal(lim.allow(1000).allowed, true); // new window, fresh counter
});

test('sliding window weights the previous window — packs the edge, not the middle', () => {
  const lim = slidingWindow({ limit: 4, windowMs: 1000 });
  for (const t of [500, 600, 700, 800]) assert.equal(lim.allow(t).allowed, true);
  // t=1100: 900ms of window 0 still inside the rolling span → estimate 4*0.9=3.6
  assert.equal(lim.allow(1100).allowed, false);
  // t=1900: prev decays to 4*0.1=0.4 → one slot frees
  assert.equal(lim.allow(1900).allowed, true);
});

test('sliding log is exact and prunes old timestamps', () => {
  const lim = slidingLog({ limit: 3, windowMs: 1000 });
  assert.equal(lim.allow(100).allowed, true);
  assert.equal(lim.allow(200).allowed, true);
  assert.equal(lim.allow(300).allowed, true);
  assert.equal(lim.allow(400).allowed, false);
  assert.equal(lim.allow(1100).allowed, true);  // t=100 is exactly at the edge: pruned (<= now-windowMs)
});

test('sliding log keeps a timestamp per request — the memory bill', () => {
  const lim = slidingLog({ limit: 3, windowMs: 1000 });
  lim.allow(100); lim.allow(200);
  assert.equal(lim.state().stored, 2);
  lim.allow(250); // 100 and 200 still inside → 3 stored
  assert.equal(lim.state().stored, 3);
  lim.allow(1249); // 100 and 200 aged out, 250 survives → back to 2 stored
  assert.equal(lim.state().stored, 2);
});

test('token bucket: capacity banks idle time, rate refills', () => {
  const lim = tokenBucket({ ratePerSec: 2, capacity: 4 });
  for (const t of [0, 10, 20, 30]) assert.equal(lim.allow(t).allowed, true); // 4 tokens spent
  assert.equal(lim.allow(40).allowed, false);      // ~0.08 tokens banked — not enough
  assert.equal(lim.allow(1040).allowed, true);     // 1s of refill = 2 tokens
});

test('token bucket capacity=1 removes the burst entirely', () => {
  const lim = tokenBucket({ ratePerSec: 2, capacity: 1 });
  assert.equal(lim.allow(0).allowed, true);
  assert.equal(lim.allow(10).allowed, false);
  assert.equal(lim.allow(510).allowed, true); // half a second = 1 token
});

test('leaky bucket emits at a constant cadence and caps the queue', () => {
  const lim = leakyBucket({ ratePerSec: 2, capacity: 3 });
  const a = lim.allow(0);
  const b = lim.allow(10);
  const c = lim.allow(20);
  const d = lim.allow(25); // fills the queue: 500, 1000, 1500 pending
  assert.deepEqual([...a.emitsAt, ...b.emitsAt, ...c.emitsAt, ...d.emitsAt], [0, 500, 1000, 1500]);
  assert.equal(lim.allow(30).allowed, false);  // queue full: 3 pending
  assert.equal(lim.allow(600).allowed, true);  // t=0 emit drained; one slot free
});

test('concurrency counts in-flight, not per-second', () => {
  const lim = concurrency({ limit: 2 });
  assert.equal(lim.allow(0, 5000).allowed, true);   // holds to t=5000
  assert.equal(lim.allow(10, 5000).allowed, true);  // holds to t=5010
  assert.equal(lim.allow(20, 100).allowed, false);  // both slots held
  assert.equal(lim.allow(5000).allowed, true);      // first hold released
});

test('perKey wraps any mechanism in an identity-keyed policy', () => {
  const q = perKey(() => fixedWindow({ limit: 1, windowMs: 1000 }));
  assert.equal(q.allow('alice', 0).allowed, true);
  assert.equal(q.allow('alice', 10).allowed, false);
  assert.equal(q.allow('bob', 10).allowed, true); // bob's budget is his own
  assert.equal(q.size(), 2);
});

test('backoffSchedule is exponential, capped, jittered, deterministic', () => {
  const dry = backoffSchedule({ attempts: 5, baseMs: 100, maxMs: 1000, jitter: false });
  assert.deepEqual(dry, [100, 200, 400, 800, 1000]);
  const jit = backoffSchedule({ attempts: 5, baseMs: 100, maxMs: 1000, jitter: 0.5, seed: 7 });
  assert.equal(jit.length, 5);
  // Equal jitter: every delay lands inside [exp·0.5, exp] — the cap always holds.
  assert.ok(jit.every((d, i) => d >= dry[i] * 0.5 && d <= dry[i]));
  assert.deepEqual(jit, backoffSchedule({ attempts: 5, baseMs: 100, maxMs: 1000, jitter: 0.5, seed: 7 }));
});

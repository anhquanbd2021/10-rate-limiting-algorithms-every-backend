import test from 'node:test';
import assert from 'node:assert/strict';
import { tokenVsLeaky } from '../public/scenarios.mjs';
import { STEADY } from '../public/examples.mjs';

test('both buckets admit the same burst — admission is not the difference', () => {
  const r = tokenVsLeaky(STEADY);
  assert.equal(r.token.admitted, 8);
  assert.equal(r.leaky.admitted, 8);
});

test('token bucket emits the burst instantly — it absorbed it', () => {
  const r = tokenVsLeaky(STEADY);
  assert.equal(r.token.lastEmit, 70); // all 8 requests through in 70ms
});

test('leaky bucket meters the same burst to a jitter-free cadence', () => {
  const r = tokenVsLeaky(STEADY);
  assert.deepEqual(r.leaky.emittedAt, [0, 500, 1000, 1500, 2000, 2500, 3000, 3500]);
  assert.equal(r.leaky.jitterFree, true);
  assert.equal(r.leaky.lastEmit, 3500); // smoothness paid in latency
});

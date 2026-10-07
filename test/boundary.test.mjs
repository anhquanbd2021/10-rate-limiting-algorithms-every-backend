import test from 'node:test';
import assert from 'node:assert/strict';
import { boundaryBurst } from '../public/scenarios.mjs';
import { BURST } from '../public/examples.mjs';

test('fixed window admits the whole edge-packed burst — 2× the quota', () => {
  const r = boundaryBurst(BURST);
  assert.equal(r.fixed.admitted, 10); // limit is 5 — twice the quota in ~100ms
  assert.equal(r.span, 100);
});

test('sliding window counter holds the burst to the limit', () => {
  const r = boundaryBurst(BURST);
  assert.equal(r.sliding.admitted, 5);
  // All denials land in the second half — after the rollover.
  assert.ok(r.sliding.run.slice(5).every((x) => !x.allowed));
});

test('sliding log matches the counter here — exact where fixed is wrong', () => {
  const r = boundaryBurst(BURST);
  assert.equal(r.log.admitted, 5);
  assert.deepEqual(
    r.log.run.map((x) => x.allowed),
    r.sliding.run.map((x) => x.allowed),
  );
});

test('denied requests carry a computable retryAfterMs', () => {
  const r = boundaryBurst(BURST);
  for (const x of r.log.run.filter((v) => !v.allowed)) {
    assert.ok(x.retryAfterMs > 0);
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { twoNodeDrift, noisyNeighbor, retryStorm } from '../public/scenarios.mjs';
import { SCENARIOS } from '../public/examples.mjs';

test('two nodes with local counters silently double the quota', () => {
  const r = twoNodeDrift(SCENARIOS.twoNode);
  assert.equal(r.perNodeTotal, 20);   // "limit 10" became 20
  assert.equal(r.sharedAdmitted, 10); // one shared counter keeps the promise
});

test('a global quota lets the hog starve the victim; per-key gives each a budget', () => {
  const r = noisyNeighbor(SCENARIOS.quota);
  assert.equal(r.global.hog, 10);
  assert.equal(r.global.victim, 0);
  assert.equal(r.keyed.hog, 5);   // capped at perUserLimit
  assert.equal(r.keyed.victim, 3); // untouched
  assert.equal(r.limitersCreated, 2); // the policy's real cost
});

test('synchronized retries are the storm; backoff+jitter shrinks and spreads it', () => {
  const r = retryStorm(SCENARIOS.retryStorm);
  assert.equal(r.naiveTotal, 152);          // 8 clients × 19 retries
  assert.equal(r.naivePeakPerBucket, 20);   // all clients, every bucket
  assert.equal(r.backTotal, 46);
  assert.ok(r.backPeakPerBucket < r.naivePeakPerBucket);
});

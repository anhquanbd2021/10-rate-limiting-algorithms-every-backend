// Side-by-side CLI report: runs every claim the article makes end-to-end
// and asserts it — exit 1 on any broken claim so `npm run check` gates a
// deploy on the story being true.

import {
  boundaryBurst, tokenVsLeaky, heldConnections,
  twoNodeDrift, noisyNeighbor, retryStorm,
} from '../public/scenarios.mjs';
import { tokenBucket } from '../public/limiters.mjs';
import { BURST, STEADY, ATTACK, SCENARIOS } from '../public/examples.mjs';

const failures = [];
const check = (label, cond, detail) => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label} ${detail ? `(${detail})` : ''}`);
  if (!cond) failures.push(label);
};

/* 1 — Boundary: fixed window doubles the quota at the rollover ---------- */
console.log(`\n== Boundary: limit ${BURST.limit}/${BURST.windowMs}ms, ${BURST.events.length} requests packed in ${Math.max(...BURST.events) - Math.min(...BURST.events)}ms around the rollover ==`);
{
  const r = boundaryBurst(BURST);
  console.log(`  admitted: fixed=${r.fixed.admitted} sliding=${r.sliding.admitted} log=${r.log.admitted}`);
  check('fixed window admits all 10 — 2× the limit inside ~100ms',
    r.fixed.admitted === r.events, `${r.fixed.admitted}/${r.events}`);
  check('sliding window counter holds the edge burst to the limit',
    r.sliding.admitted === BURST.limit, `${r.sliding.admitted}/${r.events}`);
  check('sliding log holds it exactly — same count, more memory',
    r.log.admitted === BURST.limit, `${r.log.admitted}/${r.events}`);
  check('every denied request carries a retryAfterMs hint',
    r.log.run.filter((x) => !x.allowed).every((x) => x.retryAfterMs > 0));
}

/* 2 — Buckets: same burst in, different stream out ---------------------- */
console.log(`\n== Buckets: ${STEADY.events.length} requests in 70ms through ${STEADY.ratePerSec}/s buckets (capacity ${STEADY.capacity}) ==`);
{
  const r = tokenVsLeaky(STEADY);
  console.log(`  token: admitted=${r.token.admitted} lastEmit=t=${r.token.lastEmit}ms`);
  console.log(`  leaky: admitted=${r.leaky.admitted} emits=${r.leaky.emittedAt.join(',')}ms`);
  check('both buckets admit the whole burst — admission is not the difference',
    r.token.admitted === STEADY.events.length && r.leaky.admitted === STEADY.events.length);
  check('token bucket emits the burst instantly — capacity IS the burst knob',
    r.token.lastEmit === 70, `last emit t=${r.token.lastEmit}ms`);
  check('leaky emits jitter-free: every gap exactly 500ms',
    r.leaky.jitterFree && r.leaky.gaps[0] === 500, `gaps ${r.leaky.gaps.join(',')}`);
  check('leaky spreads the same work to t=3500ms — smoothness is paid in latency',
    r.leaky.lastEmit === 3500);

  // And burst is capacity, not rate: capacity 1 kills the burst entirely.
  const tight = tokenBucket({ ratePerSec: STEADY.ratePerSec, capacity: 1 });
  const tightRun = STEADY.events.map((t) => tight.allow(t));
  check('token bucket with capacity=1 absorbs nothing — burst allowance is a parameter',
    tightRun.filter((x) => x.allowed).length === 1);
}

/* 3 — Concurrency: the axis per-second limiters can't see --------------- */
console.log(`\n== Concurrency: ${ATTACK.attack.length} held connections + ${ATTACK.legit.length} legit requests, limit ${ATTACK.limit} ==`);
{
  const r = heldConnections(ATTACK);
  console.log(`  attack admitted=${r.attackAdmitted} denied=${r.attackDenied} · legit admitted=${r.legitAdmitted} denied=${r.legitDenied}`);
  check('held connections fill every slot — the 7th+ requests are rejected',
    r.attackAdmitted === ATTACK.limit && r.attackDenied === ATTACK.attack.length - ATTACK.limit);
  check('legit short requests are denied while slots are held',
    r.legitDenied === 4 && r.legitAdmitted === 1);
  check('a per-second limiter admits the entire attack — wrong axis',
    r.fixedWouldAdmitAll === true);
}

/* 4 — Deployment & policy ------------------------------------------------ */
console.log(`\n== Distributed: ${SCENARIOS.twoNode.requests} requests across 2 nodes, "limit ${SCENARIOS.twoNode.limit}" ==`);
{
  const r = twoNodeDrift(SCENARIOS.twoNode);
  console.log(`  per-node: ${r.perNode[0]} + ${r.perNode[1]} = ${r.perNodeTotal} · shared: ${r.sharedAdmitted}`);
  check('two local counters silently double the quota',
    r.perNodeTotal === 2 * SCENARIOS.twoNode.limit, `${r.perNodeTotal} admitted`);
  check('one shared atomic counter admits exactly the limit',
    r.sharedAdmitted === SCENARIOS.twoNode.limit);
}

console.log(`\n== Quota: global limit ${SCENARIOS.quota.globalLimit} vs per-key ${SCENARIOS.quota.perUserLimit} — one hog, one victim ==`);
{
  const r = noisyNeighbor(SCENARIOS.quota);
  console.log(`  global: hog=${r.global.hog} victim=${r.global.victim} · per-key: hog=${r.keyed.hog} victim=${r.keyed.victim}`);
  check('under one global counter the hog starves the victim completely',
    r.global.hog === SCENARIOS.quota.hog.count && r.global.victim === 0);
  check('per-key quota gives each identity its own budget',
    r.keyed.hog === SCENARIOS.quota.perUserLimit && r.keyed.victim === SCENARIOS.quota.victim.count);
  check('the cost of the policy: one limiter per identity',
    r.limitersCreated === 2);
}

console.log(`\n== Backoff: ${SCENARIOS.retryStorm.clients} rejected clients during a ${SCENARIOS.retryStorm.outageMs / 1000}s outage ==`);
{
  const r = retryStorm(SCENARIOS.retryStorm);
  console.log(`  no backoff: ${r.naiveTotal} hits, peak ${r.naivePeakPerBucket}/500ms · backoff+jitter: ${r.backTotal} hits, peak ${r.backPeakPerBucket}/500ms`);
  check('synchronized retries are the storm — 152 hits in the outage',
    r.naiveTotal === 152);
  check('exponential backoff + jitter cuts hits to a third and lowers the peak',
    r.backTotal === 46 && r.backPeakPerBucket < r.naivePeakPerBucket,
    `${r.backTotal} hits, peak ${r.backPeakPerBucket} vs ${r.naivePeakPerBucket}`);
}

console.log(failures.length
  ? `\n${failures.length} claim(s) FAILED`
  : '\nAll claims verified.');
process.exit(failures.length ? 1 : 0);

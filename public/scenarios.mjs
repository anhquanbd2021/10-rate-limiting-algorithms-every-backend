// Scenario runners — each replay a request stream through the limiters and
// returns the numbers the article quotes. `scripts/lab-report.mjs` asserts
// them, `app.js` renders them, `test/` pins them.

import {
  fixedWindow, slidingWindow, slidingLog, tokenBucket, leakyBucket,
  concurrency, perKey, backoffSchedule,
} from './limiters.mjs';

// Replay one stream of arrival times (ms) through one limiter.
export function runStream(limiter, events, argOf = () => 1) {
  return events.map((t) => ({ t, ...limiter.allow(t, argOf(t)) }));
}
const admitted = (results) => results.filter((r) => r.allowed).length;

/* --- 1. Boundary: the fixed-window 2x bug ---------------------------------- */
// The same edge-packed stream through the three window mechanisms.
// `windowMs` is bucket-aligned (e.g. 1000), so requests just before and just
// after a rollover land in different fixed windows.
export function boundaryBurst({ limit, windowMs, events }) {
  const limiters = {
    fixed: fixedWindow({ limit, windowMs }),
    sliding: slidingWindow({ limit, windowMs }),
    log: slidingLog({ limit, windowMs }),
  };
  const runs = {};
  for (const [name, lim] of Object.entries(limiters)) {
    runs[name] = runStream(lim, events);
  }
  const span = Math.max(...events) - Math.min(...events);
  return {
    span,
    events: events.length,
    fixed: { run: runs.fixed, admitted: admitted(runs.fixed) },
    sliding: { run: runs.sliding, admitted: admitted(runs.sliding) },
    log: { run: runs.log, admitted: admitted(runs.log) },
  };
}

/* --- 2. Buckets: same burst in, different stream out ----------------------- */
// Token bucket emits at arrival (allow = emit); leaky emits at the drain
// cadence. Same input, same admit count — completely different output shape.
export function tokenVsLeaky({ ratePerSec, capacity, events }) {
  const token = tokenBucket({ ratePerSec, capacity });
  const leaky = leakyBucket({ ratePerSec, capacity });
  const tokenRun = runStream(token, events);
  const leakyRun = runStream(leaky, events);
  const emittedAt = leakyRun.flatMap((r) => r.emitsAt ?? []);
  const tokenDoneAt = Math.max(...tokenRun.filter((r) => r.allowed).map((r) => r.t));
  const leakyDoneAt = emittedAt.length ? Math.max(...emittedAt) : null;
  const gaps = emittedAt.slice(1).map((e, i) => Math.round(e - emittedAt[i]));
  return {
    token: { run: tokenRun, admitted: admitted(tokenRun), lastEmit: tokenDoneAt },
    leaky: {
      run: leakyRun,
      admitted: admitted(leakyRun),
      emittedAt,
      lastEmit: leakyDoneAt,
      gaps,
      jitterFree: gaps.length > 1 && gaps.every((g) => g === gaps[0]),
    },
  };
}

/* --- 3. Concurrency: the axis rate limiters miss ---------------------------- */
// Attack events hold a slot for holdMs; legit events are short. A per-second
// limiter never trips (the rate is tiny) while the concurrency cap exhausts.
export function heldConnections({ limit, attack, legit }) {
  const lim = concurrency({ limit });
  const fixed = fixedWindow({ limit: 10, windowMs: 1000 }); // generous per-second limit
  const all = [
    ...attack.map((e) => ({ ...e, kind: 'attack' })),
    ...legit.map((e) => ({ ...e, kind: 'legit' })),
  ].sort((a, b) => a.t - b.t);
  const run = all.map((e) => ({
    ...e,
    verdict: lim.allow(e.t, e.holdMs),
    fixedWouldAdmit: fixed.allow(e.t).allowed,
  }));
  return {
    run,
    attackAdmitted: run.filter((r) => r.kind === 'attack' && r.verdict.allowed).length,
    attackDenied: run.filter((r) => r.kind === 'attack' && !r.verdict.allowed).length,
    legitDenied: run.filter((r) => r.kind === 'legit' && !r.verdict.allowed).length,
    legitAdmitted: run.filter((r) => r.kind === 'legit' && r.verdict.allowed).length,
    fixedWouldAdmitAll: run.every((r) => r.fixedWouldAdmit),
    totalAdmitted: run.filter((r) => r.verdict.allowed).length,
  };
}

/* --- 4. Deployment & policy ------------------------------------------------ */
// Two nodes, one logical limit. Per-node counters silently multiply it.
export function twoNodeDrift({ limit, requests }) {
  const nodes = [fixedWindow({ limit, windowMs: 60000 }), fixedWindow({ limit, windowMs: 60000 })];
  const shared = { count: 0 };
  const perNode = [0, 0];
  let sharedAdmitted = 0;
  for (let i = 0; i < requests; i += 1) {
    const node = i % 2;
    if (nodes[node].allow(i * 10).allowed) perNode[node] += 1;
    if (shared.count < limit) { shared.count += 1; sharedAdmitted += 1; }
  }
  const perNodeTotal = perNode[0] + perNode[1];
  return { perNode, perNodeTotal, sharedAdmitted, requests, limit };
}

// Per-user quota: a global limiter lets one noisy client starve the rest;
// per-key limiters give each identity its own budget.
export function noisyNeighbor({ globalLimit, perUserLimit, hog, victim }) {
  const hogEvents = Array.from({ length: hog.count }, (_, i) => ({ t: hog.start + i * hog.every, key: 'hog' }));
  const victimEvents = Array.from({ length: victim.count }, (_, i) => ({ t: victim.start + i * victim.every, key: 'victim' }));
  const stream = [...hogEvents, ...victimEvents].sort((a, b) => a.t - b.t);
  const global = fixedWindow({ limit: globalLimit, windowMs: 1000 });
  const keyed = perKey(() => fixedWindow({ limit: perUserLimit, windowMs: 1000 }));
  const run = stream.map((e) => ({
    ...e,
    global: global.allow(e.t).allowed,
    keyed: keyed.allow(e.key, e.t).allowed,
  }));
  const count = (key, field, v) => run.filter((r) => r.key === key && r[field] === v).length;
  return {
    run,
    global: { hog: count('hog', 'global', true), victim: count('victim', 'global', true) },
    keyed: { hog: count('hog', 'keyed', true), victim: count('victim', 'keyed', true) },
    limitersCreated: keyed.size(),
  };
}

// Backoff is client behavior: N rejected clients during an outage. Without
// backoff all of them retry on the same tick forever; with exponential +
// jitter the retries spread.
export function retryStorm({ clients, outageMs, fixedMs, baseMs, maxMs, jitter }) {
  const hitsPer = (delays) => {
    // Retry times for one client during the outage, then count per 500ms bucket.
    const times = [];
    let t = delays[0];
    for (const d of delays) {
      if (t >= outageMs) break;
      times.push(t);
      t += d;
    }
    return times;
  };
  // No backoff: every client retries every fixedMs starting at fixedMs.
  const naiveTimes = [];
  for (let t = fixedMs; t < outageMs; t += fixedMs) naiveTimes.push(t);
  const naivePeak = clients; // every client lands in every window
  // Backoff: each client gets its own jittered schedule (seeded per client).
  const schedules = Array.from({ length: clients }, (_, c) =>
    backoffSchedule({ attempts: 8, baseMs, maxMs, jitter, seed: c + 1 }));
  const backTimes = schedules.flatMap((s) => hitsPer(s));
  const bucket = 500;
  const bucketize = (times) => {
    const m = new Map();
    for (const t of times) m.set(Math.floor(t / bucket), (m.get(Math.floor(t / bucket)) ?? 0) + 1);
    return Math.max(0, ...m.values());
  };
  return {
    naiveTotal: naiveTimes.length * clients,
    naivePeakPerBucket: naivePeak * (bucket / fixedMs),
    backTotal: backTimes.length,
    backPeakPerBucket: bucketize(backTimes),
    schedules,
  };
}

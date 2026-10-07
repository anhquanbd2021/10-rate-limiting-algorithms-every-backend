# Rate Limiter Lab — companion demo

Interactive lab for the article *The 10 "Rate Limiting Algorithms" Are
Really Four Mechanisms and Some Knobs*. Replay one request stream through
every limiter on the listicle and watch the differences stop being
vocabulary: a fixed window doubles the quota at a rollover, sliding
variants pay memory to hold the line, token and leaky buckets emit the
same admitted burst in completely different shapes, and the concurrency
cap catches the attack every per-second limiter sails past.

Zero dependencies — Node 20+ only. The limiters and scenario runners are
plain ES modules shared by the browser UI, the CLI report, and the test
suite. The clock is injected (`now` in ms), so every run replays exactly.

## Four labs

| Lab | What it proves |
|---|---|
| **Boundary** | Ten requests packed against a 1s rollover (limit 5): fixed window admits all 10 — 2× the quota inside ~100ms. Sliding counter and sliding log both hold it to 5; the counter is O(1) and approximate, the log is exact and O(n). |
| **Buckets** | Eight requests in 70ms through 2/s buckets (capacity 8): token emits all eight instantly — capacity banked during idle IS the "burst allowance." Leaky admits the same eight and emits at a perfect 500ms cadence until t=3500ms. Same input, different output product. |
| **Concurrency** | Six slow clients hold slots for 5s against a limit of 4: two are denied and four legit short requests are rejected — while a generous 10/s fixed window admits all eleven. In-flight is a different axis than per-second. |
| **Deployment & clients** | Two nodes with local counters admit 20 against a "limit 10"; one shared counter admits exactly 10. A global quota lets a hog starve the victim (10/0); per-key gives each a budget (5/3). Eight rejected clients retrying every 200ms generate 152 hits in a 4s outage — backoff+jitter cuts it to 46. |

## Run it

```text
npm start        # serve the lab on :3000
npm test         # limiter semantics + scenario assertions + server
npm run report   # side-by-side CLI report asserting every article claim
npm run check    # both
```

## Files

- `public/limiters.mjs` — the four mechanisms + the concurrency cap +
  `perKey` (quota as policy) + `backoffSchedule` (client behavior).
- `public/scenarios.mjs` — `boundaryBurst`, `tokenVsLeaky`,
  `heldConnections`, `twoNodeDrift`, `noisyNeighbor`, `retryStorm`.
- `examples/` — the request streams and scenario parameters the labs run.
- `test/` — 29 tests pinning every number the article quotes.

## Honest limits

- Single-node, in-memory, deterministic-clock models — no Redis, no
  network, no real clock skew beyond the scripted kind.
- The "distributed counter" lab simulates shared vs per-node state; it
  does not run an atomic store or model its latency and failure modes.
- The sliding-window counter uses the standard weighted estimate —
  real implementations vary in the details.
- The leaky bucket models a metered queue that emits immediately when
  idle; GCRA-style variants make different trade-offs.
- Backoff jitter uses a deterministic demo hash, not randomness —
  repeatability beats realism here.
- Nothing here shapes real traffic; production limiting belongs at the
  edge/gateway, keyed deliberately, with `429` + `Retry-After` responses.

This is an educational demo, not production infrastructure.

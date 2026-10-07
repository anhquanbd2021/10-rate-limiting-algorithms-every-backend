// Fixtures mirrored from examples/*.json — the browser can't read files, so
// these literals must stay in sync. test/examples.test.mjs asserts it.

export const BURST = {
  name: 'edge-packed burst',
  limit: 5,
  windowMs: 1000,
  events: [950, 960, 970, 980, 990, 1010, 1020, 1030, 1040, 1050],
};

export const STEADY = {
  name: 'burst then idle',
  ratePerSec: 2,
  capacity: 8,
  events: [0, 10, 20, 30, 40, 50, 60, 70],
};

export const ATTACK = {
  name: 'held connections',
  limit: 4,
  attack: [
    { t: 0, holdMs: 5000 },
    { t: 10, holdMs: 5000 },
    { t: 20, holdMs: 5000 },
    { t: 30, holdMs: 5000 },
    { t: 40, holdMs: 5000 },
    { t: 50, holdMs: 5000 },
  ],
  legit: [
    { t: 500, holdMs: 100 },
    { t: 800, holdMs: 100 },
    { t: 1100, holdMs: 100 },
    { t: 1400, holdMs: 100 },
    { t: 5100, holdMs: 100 },
  ],
};

export const SCENARIOS = {
  twoNode: { limit: 10, requests: 24 },
  quota: {
    globalLimit: 10,
    perUserLimit: 5,
    hog: { count: 10, start: 0, every: 10 },
    victim: { count: 3, start: 100, every: 10 },
  },
  retryStorm: {
    clients: 8,
    outageMs: 4000,
    fixedMs: 200,
    baseMs: 200,
    maxMs: 2000,
    jitter: 0.5,
  },
};

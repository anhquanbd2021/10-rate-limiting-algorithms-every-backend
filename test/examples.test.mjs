// Keeps public/examples.mjs mirrored to examples/*.json — the UI, CLI and
// tests must tell the same story as the shipped fixtures.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { BURST, STEADY, ATTACK, SCENARIOS } from '../public/examples.mjs';

const load = (name) => JSON.parse(
  readFileSync(fileURLToPath(new URL(`../examples/${name}`, import.meta.url)), 'utf8'),
);
const pick = (obj, keys) => Object.fromEntries(keys.map((k) => [k, obj[k]]));

test('burst fixture mirrors examples/burst.json', () => {
  assert.deepEqual(pick(BURST, ['name', 'limit', 'windowMs', 'events']), pick(load('burst.json'), ['name', 'limit', 'windowMs', 'events']));
});

test('steady fixture mirrors examples/steady.json', () => {
  assert.deepEqual(pick(STEADY, ['name', 'ratePerSec', 'capacity', 'events']), pick(load('steady.json'), ['name', 'ratePerSec', 'capacity', 'events']));
});

test('attack fixture mirrors examples/attack.json', () => {
  assert.deepEqual(pick(ATTACK, ['name', 'limit', 'attack', 'legit']), pick(load('attack.json'), ['name', 'limit', 'attack', 'legit']));
});

test('scenario parameters mirror examples/scenarios.json', () => {
  const disk = load('scenarios.json');
  for (const key of Object.keys(SCENARIOS)) {
    assert.deepEqual(SCENARIOS[key], disk[key], key);
  }
});

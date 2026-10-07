import test from 'node:test';
import assert from 'node:assert/strict';
import { heldConnections } from '../public/scenarios.mjs';
import { ATTACK } from '../public/examples.mjs';

test('held connections fill every slot; the rest of the attack is rejected', () => {
  const r = heldConnections(ATTACK);
  assert.equal(r.attackAdmitted, 4);  // the limit
  assert.equal(r.attackDenied, 2);
});

test('legit short requests are denied while slots are held — then one lands after release', () => {
  const r = heldConnections(ATTACK);
  assert.equal(r.legitDenied, 4);
  assert.equal(r.legitAdmitted, 1); // the t=5100 request, after holds release at ~5000
});

test('a per-second rate limiter admits the entire attack — wrong axis', () => {
  const r = heldConnections(ATTACK);
  assert.equal(r.fixedWouldAdmitAll, true); // ~2 req/s over 5s trips nothing
});

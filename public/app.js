import { boundaryBurst, tokenVsLeaky, heldConnections, twoNodeDrift, noisyNeighbor, retryStorm } from './scenarios.mjs';
import { BURST, STEADY, ATTACK, SCENARIOS } from './examples.mjs';

const $ = (id) => document.getElementById(id);
const badge = (el, text, cls) => { el.textContent = text; el.className = `badge ${cls}`; };

/* Boundary lab ------------------------------------------------------------ */
$('bd-run').addEventListener('click', () => {
  const r = boundaryBurst(BURST);
  $('bd-fixed').textContent = `${r.fixed.admitted}/${r.events}`;
  $('bd-sliding').textContent = `${r.sliding.admitted}/${r.events}`;
  $('bd-log').textContent = `${r.log.admitted}/${r.events}`;
  const mark = (ok) => (ok ? '<span class="success-text">allow</span>' : '<span class="danger-text">deny</span>');
  $('bd-log').innerHTML = r.fixed.run.map((f, i) => {
    const s = r.sliding.run[i];
    const l = r.log.run[i];
    const edge = f.t < BURST.windowMs ? 'before rollover' : 'after rollover';
    const cls = s.allowed ? 'pass' : 'fail';
    return `<li class="result ${cls}"><code>t=${f.t}ms</code> (${edge}) — fixed ${mark(f.allowed)} · sliding ${mark(s.allowed)} · log ${mark(l.allowed)}</li>`;
  }).join('');
  badge($('bd-badge'),
    `fixed admitted ${r.fixed.admitted} requests inside ${r.span}ms — 2× the limit of ${BURST.limit}; sliding variants held it to ${r.sliding.admitted}`,
    'warn');
});

/* Buckets lab ------------------------------------------------------------- */
$('bk-run').addEventListener('click', () => {
  const r = tokenVsLeaky(STEADY);
  const W = 560; const H = 96; const ROW = 34;
  const x = (t) => ((t / 3600) * (W - 60) + 30).toFixed(1);
  const tickRow = (times, y, fill, label) =>
    `<text x="4" y="${y + 4}" font-size="11" font-weight="700" fill="${fill}">${label}</text>` +
    times.map((t) =>
      `<rect x="${x(t)}" y="${y - 9}" width="7" height="18" rx="2" fill="${fill}"/>` +
      `<text x="${(Number(x(t)) + 3.5).toFixed(1)}" y="${y + 24}" text-anchor="middle" font-size="9" fill="#8aa0ae">${t}</text>`).join('');
  const tokenTimes = r.token.run.filter((v) => v.allowed).map((v) => v.t);
  $('bk-chart').innerHTML =
    `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Emission times: token vs leaky">` +
    tickRow(tokenTimes, 22, '#48A080', 'token') +
    tickRow(r.leaky.emittedAt, 62, '#245B78', 'leaky') +
    `<text x="${W - 4}" y="${H - 2}" text-anchor="end" font-size="10" fill="#8aa0ae">ms →</text></svg>`;
  $('bk-token-last').textContent = r.token.lastEmit;
  $('bk-leaky-last').textContent = r.leaky.lastEmit;
  $('bk-gap').textContent = r.leaky.gaps[0] ?? '—';
  badge($('bk-badge'),
    `both admitted ${r.token.admitted}/${STEADY.events.length} — token emitted all by t=${r.token.lastEmit}ms; leaky spread them to t=${r.leaky.lastEmit}ms at ${r.leaky.jitterFree ? 'perfect' : ''} ${r.leaky.gaps[0]}ms cadence`,
    'pass');
});

/* Concurrency lab --------------------------------------------------------- */
$('cc-run').addEventListener('click', () => {
  const r = heldConnections(ATTACK);
  const W = 560; const H = 150;
  const x = (t) => ((t / 5600) * (W - 60) + 30).toFixed(1);
  const bars = r.run.map((e, i) => {
    const y = 20 + i * 11;
    const w = Math.max(3, Number(x(e.t + e.holdMs)) - Number(x(e.t)));
    const fill = !e.verdict.allowed ? '#c0504d' : e.kind === 'attack' ? '#EBB042' : '#48A080';
    return `<rect x="${x(e.t)}" y="${y}" width="${w.toFixed(1)}" height="8" rx="2" fill="${fill}"/>` +
      `<text x="${Number(x(e.t)) + w + 5}" y="${y + 7}" font-size="9" fill="#8aa0ae">${e.kind} ${e.verdict.allowed ? 'holds ' + e.holdMs + 'ms' : '429'}</text>`;
  }).join('');
  $('cc-slots').innerHTML =
    `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Request holds over time">` +
    bars +
    `<text x="30" y="12" font-size="10" fill="#8aa0ae">amber = attack hold · green = legit · red = rejected</text></svg>`;
  $('cc-log').innerHTML = r.run.map((e) =>
    `<li class="result ${e.verdict.allowed ? 'pass' : 'fail'}"><code>t=${e.t}ms</code> ${e.kind} (${e.holdMs}ms hold) — ${e.verdict.allowed ? `admitted, slot until t=${e.verdict.releasesAt}` : 'rejected — all 4 slots held'}</li>`).join('');
  badge($('cc-badge'),
    `${r.attackAdmitted} slow requests filled all ${ATTACK.limit} slots → ${r.legitDenied} legit denied; a 10/s fixed window admitted every one of the ${r.run.length}`,
    'warn');
});

/* Deployment & clients lab ------------------------------------------------- */
const dpStat = (id, num, label) => { $(`dp-${id}`).textContent = num; $(`dp-${id}-label`).textContent = label; };

$('dp-drift').addEventListener('click', () => {
  const s = SCENARIOS.twoNode;
  const r = twoNodeDrift(s);
  dpStat('a', r.perNodeTotal, 'admitted, per-node counters');
  dpStat('b', r.sharedAdmitted, 'admitted, shared counter');
  dpStat('c', `${r.requests}`, 'requests sent');
  $('dp-log').innerHTML =
    `<li class="result fail">node A admits ${r.perNode[0]}, node B admits ${r.perNode[1]} — "limit ${s.limit}" quietly became ${r.perNodeTotal}</li>` +
    `<li class="result pass">one shared atomic counter admits exactly ${r.sharedAdmitted} — the algorithm is the same; only the state moved</li>`;
  badge($('dp-badge'), `distributed: ${r.perNodeTotal} vs ${r.sharedAdmitted} — same limiter, different state`, 'warn');
});

$('dp-quota').addEventListener('click', () => {
  const s = SCENARIOS.quota;
  const r = noisyNeighbor(s);
  dpStat('a', `${r.global.hog}/${r.global.victim}`, 'global: hog/victim admitted');
  dpStat('b', `${r.keyed.hog}/${r.keyed.victim}`, 'per-key: hog/victim admitted');
  dpStat('c', r.limitersCreated, 'limiter objects created');
  $('dp-log').innerHTML =
    `<li class="result fail">global limit ${s.globalLimit}: the hog takes all ${r.global.hog}, the victim gets ${r.global.victim} — quota spent is quota gone</li>` +
    `<li class="result pass">per-key limit ${s.perUserLimit}: hog capped at ${r.keyed.hog}, victim keeps all ${r.keyed.victim} — a policy, not an algorithm</li>`;
  badge($('dp-badge'), `quota is any mechanism + an identity key — cost: ${r.limitersCreated} limiter per user`, 'pass');
});

$('dp-storm').addEventListener('click', () => {
  const s = SCENARIOS.retryStorm;
  const r = retryStorm(s);
  dpStat('a', r.naiveTotal, 'retry hits, no backoff');
  dpStat('b', r.backTotal, 'retry hits, exp+jitter');
  dpStat('c', `${r.naivePeakPerBucket}→${r.backPeakPerBucket}`, 'peak per 500ms');
  $('dp-log').innerHTML =
    `<li class="result fail">no backoff: ${s.clients} clients × every ${s.fixedMs}ms = ${r.naiveTotal} hits during a ${s.outageMs / 1000}s outage — the retries ARE the storm</li>` +
    `<li class="result pass">backoff ${s.baseMs}→${s.maxMs}ms + jitter: ${r.backTotal} hits, peak bucket ${r.backPeakPerBucket} — backoff never limits the server; it un-hammers it</li>`;
  badge($('dp-badge'), `retry storm: ${r.naiveTotal} hits → ${r.backTotal}; peak ${r.naivePeakPerBucket} → ${r.backPeakPerBucket} per 500ms`, 'pass');
});

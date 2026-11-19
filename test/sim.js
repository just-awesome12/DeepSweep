/**
 * Balance simulation. A bot with perfect logic plays full runs through the real Run rules.
 * Usage: node sim.js [runs] [push=0.5] [careful=1] [char=sapper] [depth=0] [risky=0] [step=N] [patch=N] [cap=N]
 *   push    lowest cache odds the bot gambles on (above 1 = never gamble)
 *   careful 1 = patch up and buy defensive items first, 0 = buy whatever is offered
 */
const args = Object.fromEntries(process.argv.slice(3).map((kv) => kv.split('=')).map(([k, v]) => [k, Number.isNaN(Number(v)) ? v : Number(v)]));
// Tuning overrides: step=8 patch=6 cap=4 try a rule value without editing the engine.
const { Run, PHASE, MODE, Rng, Solver, cacheOdds, BOSSES, CHARACTERS, starsFor } = require('./load.js')((code) => code
  .replace(/streakStep: \d+/, (m) => (args.step ? `streakStep: ${args.step}` : m))
  .replace(/patchCost: \d+/, (m) => (args.patch ? `patchCost: ${args.patch}` : m))
  .replace(/multCap: \d+/, (m) => (args.cap ? `multCap: ${args.cap}` : m))
  .replace(/gemsPerFloor: \d+/, (m) => (args.gems !== undefined ? `gemsPerFloor: ${args.gems}` : m)));
const CHARACTER = CHARACTERS.find((c) => c.id === (args.char || 'sapper'));
const DEPTH = args.depth || 0;
const RISKY = args.risky || 0;
const RUNS = Number(process.argv[2]) || 2000;
const PUSH = args.push ?? 0.5;
const CAREFUL = args.careful ?? 1;
const BUY_ORDER = ['shield', 'probe', 'boots', 'wind', 'rod', 'steady', 'sonar', 'lantern', 'momentum', 'echo', 'bounty', 'coin', 'magnet', 'purse', 'ledger', 'first', 'token', 'crowbar', 'medkit', 'die'];

function shop(run) {
  if (CAREFUL) while (run.hearts < run.maxHearts && run.coins >= run.patchCost) run.patch();
  for (const id of BUY_ORDER) {
    const slot = run.shop.indexOf(id);
    if (slot < 0 || run.coins < run.price(id)) continue;
    if (id === 'medkit' && run.hearts >= run.maxHearts) continue;
    if (id === 'die' && CAREFUL) continue;
    run.buy(slot);
  }
  run.leaveShop();
}

function floorStep(run) {
  if (run.hearts <= 1 && run.canUse('medkit')) { run.useItem('medkit'); return; }
  // Undo what a boss did to the board before reading it: dig out rubble, clear jammed clues.
  const cellsOf = [...run.open.keys()];
  const rubble = cellsOf.find((i) => run.hasRubble(i));
  if (rubble !== undefined) { run.flip(rubble); return; }
  const jam = cellsOf.find((i) => run.isJammed(i));
  if (jam !== undefined) { run.clearJam(jam); return; }
  const known = Uint8Array.from(run.found, (v) => (v >= 0 ? 1 : 0));
  if (!run.cleared) {
    const solver = new Solver(run.board, run.open, known);
    let d = solver.step();
    while (d && !d.safe.length) { solver.apply(d); d = solver.step(); }
    if (d) { run.flip(d.safe[0]); return; }
    const risk = solver.riskMap();
    let best = -1; let p = 2;
    if (risk) risk.forEach((v, c) => { if (v < p) { p = v; best = c; } });
    if (best < 0) best = [...run.open.keys()].find((i) => !run.open[i] && run.found[i] < 0);
    if (run.canUse('lantern')) run.useItem('lantern', best);
    else if (run.canUse('probe')) run.useItem('probe', best);
    else run.flip(best);
    return;
  }
  const odds = cacheOdds(run.board, run.open, run.found);
  let best = -1; let p = -1;
  odds.forEach((v, c) => { if (v > p) { p = v; best = c; } });
  const must = run.isBossFloor && !run.bossBeaten;
  const cushion = run.itemsWork && (run.has('shield') || run.has('boots'));
  const more = best >= 0 && run.cachesFound < run.board.cacheCount;
  if (more && p === 1) run.flip(best);
  else if (more && must) { if (run.canUse('lantern')) run.useItem('lantern', best); else if (run.canUse('probe')) run.useItem('probe', best); else run.flip(best); }
  else if (more && !run.isBossFloor && run.canUse('lantern')) run.useItem('lantern', best);
  else if (more && !run.isBossFloor && p >= PUSH && (cushion || run.hearts >= run.maxHearts)) run.flip(best);
  else run.descend();
}

const rng = new Rng(20261115);
const t = { wins: 0, died: [0, 0, 0, 0], boss: {}, scores: [], earned: 0, mult: 0, multHist: {}, stars: 0 };
for (let k = 0; k < RUNS; k++) {
  const run = new Run(rng.int(2 ** 31), { character: CHARACTER, depth: DEPTH });
  let guard = 0;
  while (!run.over && guard++ < 3000) {
    if (run.phase === PHASE.SHOP) shop(run);
    else if (run.phase === PHASE.PATH) run.choosePath(Boolean(RISKY));
    else if (run.phase === PHASE.BOSS_GATE) { run.payToll(run.coins >= 3); while (!run.over && run.discardsLeft > 0) run.sabotage(run.items.length - 1); run.enterBoss(); }
    else floorStep(run);
  }
  const b = (t.boss[run.boss.id] ||= { runs: 0, wins: 0 });
  t.stars += starsFor(run);
  b.runs++;
  t.earned += run.stats.earned;
  t.mult += run.stats.bestMultiplier;
  t.multHist[run.stats.bestMultiplier] = (t.multHist[run.stats.bestMultiplier] || 0) + 1;
  if (run.phase === PHASE.WON) { t.wins++; b.wins++; t.scores.push(run.score); } else t.died[run.floorIndex]++;
}
const pct = (a, b) => `${((a / b) * 100).toFixed(1)}%`;
t.scores.sort((a, b) => a - b);
const q = (f) => t.scores[Math.floor(t.scores.length * f)] ?? 0;
console.log(`runs ${RUNS} push ${PUSH} careful ${CAREFUL} char ${CHARACTER.id} depth ${DEPTH} risky ${RISKY}`);
console.log('win rate', pct(t.wins, RUNS), '| deaths by floor', t.died.map((d) => pct(d, RUNS)).join(' '));
console.log('by boss', BOSSES.filter((x) => t.boss[x.id]).map((x) => `${x.id} ${pct(t.boss[x.id].wins, t.boss[x.id].runs)}`).join(' | '));
console.log('winning score: median', q(0.5), 'p90', q(0.9), 'max', t.scores[t.scores.length - 1], '| avg coins earned', (t.earned / RUNS).toFixed(1), '| avg stars per run', (t.stars / RUNS).toFixed(1));
console.log('best multiplier reached: avg', (t.mult / RUNS).toFixed(2), JSON.stringify(t.multHist));

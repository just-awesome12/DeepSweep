// Rule tests for the streak multiplier and each rule-changing gear piece.
const assert = require('assert');
const { Run, PHASE, MODE, Solver, KIND, RULES, CHARACTERS, Profile, ACHIEVEMENTS, dailyRun, starsFor } = require('./load.js')();
/** A plain run that starts with the given items. */
const withItems = (seed, ...items) => { const run = new Run(seed); run.items.push(...items); return run; };
const cells = (run, kind) => [...run.open.keys()].filter((i) => !run.open[i] && run.found[i] < 0 && run.board.kind(i) === kind);
const safeFlip = (run) => { const s = new Solver(run.board, run.open, Uint8Array.from(run.found, (v) => (v >= 0 ? 1 : 0))); let d = s.step(); while (d && !d.safe.length) { s.apply(d); d = s.step(); } if (!d) return false; run.flip(d.safe[0]); return true; };
const clear = (run) => { while (!run.cleared) assert(safeFlip(run), 'floor 1 needs no guess'); };
let n = 0; const ok = (name) => { n++; console.log('ok', name); };

{ // streak and multiplier
  let run; let flips; let seed = 11;
  do { run = new Run(seed++); flips = 0; while (run.streak < RULES.streakStep && safeFlip(run)) flips++; } while (run.streak < RULES.streakStep || !cells(run, KIND.CACHE).length);
  assert.equal(run.streak, flips + run.stats.gems * RULES.gemStreak, 'each safe flip adds 1, each gem adds more'); assert(run.multiplier >= 2);
  const before = run.coins; const held = run.streak; const mult = run.multiplier; run.flip(cells(run, KIND.CACHE)[0]);
  assert.equal(run.coins - before, RULES.cacheCoins * mult); assert.equal(run.streak, held, 'cache keeps the streak');
  run.flip(cells(run, KIND.TRAP)[0]); assert.equal(run.streak, 0); assert.equal(run.multiplier, 1); assert.equal(run.hearts, 2);
  assert.equal(run.score, run.stats.earned + RULES.heartPoints * 2); ok('streak multiplier, reset, score');
}
{ const run = withItems(12, 'die'); run.flip(cells(run, KIND.CACHE)[0]); assert.equal(run.coins, 6); run.flip(cells(run, KIND.TRAP)[0]); assert.equal(run.hearts, 1); ok('Loaded Die'); }
{ const run = withItems(13, 'first'); run.flip(cells(run, KIND.TRAP)[0]); assert.equal(run.hearts, 3); assert.equal(run.trapsFound, 1); run.flip(cells(run, KIND.TRAP)[0]); assert.equal(run.hearts, 2); ok('First Step'); }
{ const run = withItems(14, 'steady'); safeFlip(run); safeFlip(run); run.flip(cells(run, KIND.TRAP)[0]); assert.equal(run.streak, 2); run.flip(cells(run, KIND.TRAP)[0]); assert.equal(run.streak, 0); ok('Steady Hands'); }
{ const run = withItems(15, 'momentum'); assert.equal(run.streakStep, 5); run.streak = 5; assert.equal(run.multiplier, 2); ok('Momentum'); }
{ const run = withItems(16, 'bounty', 'probe', 'first'); run.useItem('probe', cells(run, KIND.TRAP)[0]); assert.equal(run.coins, 2); run.flip(cells(run, KIND.TRAP)[0]); assert.equal(run.coins, 4); assert.equal(run.hearts, 3); ok('Bounty Board with Probe and First Step'); }
{ let kept = 0; for (let k = 0; k < 400; k++) { const run = withItems(1000 + k, 'echo', 'probe'); run.useItem('probe', cells(run, KIND.SAFE)[0]); if (run.has('probe')) kept++; } assert(kept > 150 && kept < 250, 'echo rate ' + kept); ok('Echo keeps about half: ' + kept + '/400'); }
{ const run = withItems(17, 'purse'); clear(run); run.coins = 11; run.descend(); assert.equal(run.phase, PHASE.SHOP); assert.equal(run.coins, 13); ok("Miser's Purse"); }
{ const run = withItems(18, 'rod'); clear(run); assert.equal(run.found[run.board.cacheCells[0]], KIND.CACHE); assert(run.coins >= 3); ok('Dowsing Rod, paid ' + run.coins); }
{ // gear is off on the Jammer's floor
  let seed = 1; let run; do { run = withItems(seed++, 'die'); } while (run.boss.id !== 'jammer');
  run.floorIndex = 2; run.phase = PHASE.SHOP; run.leaveShop(); run.enterBoss(); run.streak = 0; assert(run.isBossFloor && !run.itemsWork);
  run.flip(cells(run, KIND.CACHE)[0]); assert.equal(run.coins, 3, 'die is jammed'); ok('Jammer turns gear off');
}

/* ---------- characters, depth, paths, modes, bosses ---------- */
const by = (id) => CHARACTERS.find((c) => c.id === id);
const sweep = (run) => { for (const i of cells(run, KIND.SAFE)) run.flip(i); };
const bossRun = (bossId, options = {}) => { let seed = 1; let run; do { run = new Run(seed++, options); } while (!run.bosses.some((b) => b.id === bossId)); return run; };
/** Play to the end without ever touching a trap. `risky` picks the rich vein at each fork. */
const finish = (run, { risky = false, buy = false, caches = false, floors = 99 } = {}) => {
  let guard = 0;
  while (!run.over && guard++ < 400 && run.stats.floorsCleared < floors) {
    if (run.phase === PHASE.FLOOR) { sweep(run); if (caches || run.bossRule('hoarder')) cells(run, KIND.CACHE).forEach((i) => run.flip(i)); run.descend(); }
    else if (run.phase === PHASE.SHOP) { if (buy) run.buy(0); run.leaveShop(); }
    else if (run.phase === PHASE.PATH) run.choosePath(risky);
    else if (run.phase === PHASE.BOSS_GATE) { run.payToll(run.coins >= 3); while (run.discardsLeft) run.sabotage(0); run.enterBoss(); }
  }
  return run;
};

{ const run = new Run(21, { character: by('gambler') }); assert.equal(run.hearts, 2); assert.equal(run.multiplier, 2); run.flip(cells(run, KIND.CACHE)[0]); assert.equal(run.coins, 6); run.streak = 99; assert.equal(run.multiplier, 6); ok('Gambler'); }
{ const run = new Run(22, { character: by('surveyor') }); assert.equal(run.trapsFound, 1); finish(run, { floors: 1 }); run.leaveShop(); run.choosePath(false); assert.equal(run.trapsFound, 1); ok('Surveyor'); }
{ const run = new Run(23, { character: by('daredevil') }); run.streak = 10; run.flip(cells(run, KIND.TRAP)[0]); assert.equal(run.streak, 5); ok('Daredevil'); }
{ const run = bossRun('crusher', { character: by('ghost') }); finish(run, { floors: 3 }); run.leaveShop(); assert(run.tollSettled); run.enterBoss(); assert(run.isBossFloor); run.flip(cells(run, KIND.TRAP)[0]); assert.equal(run.hearts, 1, 'crusher ignored'); ok('Ghost ignores the boss rule'); }
{ const run = new Run(25, { character: by('banker') }); assert.equal(run.coins, 4); finish(run, { floors: 1 }); assert.equal(run.shop.length, 4); const first = run.shop.join(); run.reroll(); assert.notEqual(run.shop.join(), first); assert(!run.canReroll); ok('Banker'); }
{ const run = new Run(26, { character: by('medic') }); assert.equal(run.hearts, 3); assert.equal(run.topMultiplier, 3); run.flip(cells(run, KIND.TRAP)[0]); assert.equal(run.hearts, 2); finish(run, { floors: 1 }); assert.equal(run.patchCost, 2); run.coins = 2; run.patch(); assert.equal(run.hearts, 3); assert.equal(run.coins, 0); ok('Medic'); }
{ const d0 = new Run(27); const d5 = new Run(27, { depth: 5 });
  assert.equal(d5.price('probe'), d0.price('probe') + 1); assert.equal(d5.patchCost, 7); assert.equal(d5.board.trapCount, d0.board.trapCount + 1); assert.equal(d5.cacheCoins, 2); assert.equal(d5.bosses.length, 2);
  d5.stats.earned = 10; assert.equal(d5.score, Math.round((10 + 15) * 2)); assert.equal(new Run(27, { depth: 5, mode: MODE.DAILY }).depth, 0); ok('Depth 5 rules and score bonus'); }
{ const run = new Run(28); finish(run, { floors: 1 }); run.leaveShop(); assert.equal(run.phase, PHASE.PATH); run.choosePath(true); assert.equal(run.board.trapCount, 7); assert(run.floor.risky); const m = run.multiplier; run.flip(cells(run, KIND.CACHE)[0]); assert.equal(run.coins, RULES.cacheCoins * m * 2); ok('Rich vein path'); }
{ const run = finish(new Run(29, { mode: MODE.ENDLESS }), { floors: 6 }); assert.equal(run.stats.floorsCleared, 6); assert(!run.over && run.bosses.length === 0); assert.equal(run.floor.name, 'Floor 6'); ok('Endless mode runs past the boss'); }
{ const run = bossRun('rust'); finish(run, { floors: 3 }); run.items.push('probe', 'shield', 'boots'); run.leaveShop(); run.enterBoss(); assert.deepEqual(run.items, ['boots']); ok('The Rust'); }
{ const run = bossRun('brute'); finish(run, { floors: 3 }); run.leaveShop(); run.enterBoss(); assert.equal(run.hearts, 2); assert.equal(run.stats.heartsLost, 0); ok('The Brute'); }
{ const run = finish(new Run(30), { caches: true }); assert.equal(run.phase, PHASE.WON); assert.equal(run.stats.gems, 4); assert.equal(run.stats.allCacheFloors, 4); assert(run.stats.earned >= 8 * 3); ok('Gems and a full clean win, score ' + run.score); }

/* ---------- profile: stars, unlocks, achievements ---------- */
{ const p = new Profile(null);
  assert.deepEqual(p.get('characters'), ['sapper', 'gambler']); assert.equal(p.character.id, 'sapper');
  assert.deepEqual(p.finishTutorial().map((a) => a.id), ['tutorial']);
  const win = finish(new Run(31), { caches: true, risky: true });
  const r = p.record(win);
  assert.equal(r.stars, starsFor(win)); assert.equal(p.get('stars'), r.stars); assert(r.depthUp && p.get('depthMax') === 1);
  for (const id of ['ghost', 'surveyor']) assert(r.characters.some((c) => c.id === id), 'feat unlock ' + id);
  const got = r.achievements.map((a) => a.id);
  for (const id of ['win', 'untouched', 'minimalist', 'cleansweep', 'risky', 'gems']) assert(got.includes(id), 'missing ' + id);
  assert(!got.includes('closecall')); assert(!p.record(finish(new Run(31), { caches: true, risky: true })).achievements.length, 'no repeats');
  p.set('stars', 39); assert.equal(p.buy(by('banker')).length, 0); assert(!p.owns(by('banker')));
  p.set('stars', 45); p.buy(by('banker')); assert(p.owns(by('banker'))); assert.equal(p.get('stars'), 5); assert.equal(p.character.id, 'banker');
  ok('Profile: stars, depth unlock, feat unlocks, purchase, achievements (' + got.length + ' earned in one perfect run)'); }
{ const p = new Profile(null); const a = dailyRun(new Date('2026-11-16T03:00:00Z')); const b = dailyRun(new Date('2026-11-16T22:00:00Z')); const c = dailyRun(new Date('2026-11-17T01:00:00Z'));
  assert.equal(a.key, '2026-11-16'); assert.equal(a.seed, b.seed); assert.notEqual(a.seed, c.seed);
  const one = new Run(a.seed, { mode: MODE.DAILY }); const two = new Run(a.seed, { mode: MODE.DAILY }); assert.equal(one.boss.id, two.boss.id); assert.equal(one.boardSeed, two.boardSeed);
  const r = p.record(finish(one)); assert(r.achievements.some((x) => x.id === 'daily')); assert.equal(p.get('daily').key, dailyRun().key);
  const e = p.record(finish(new Run(5, { mode: MODE.ENDLESS }), { floors: 10 })); assert.equal(p.get('endlessBest'), 10); assert(e.achievements.some((x) => x.id === 'endless10'));
  ok('Daily seed is shared and stable; endless best is tracked'); }
console.log(n, 'rule tests passed');

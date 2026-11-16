// Fuzz: random legal and illegal actions over many runs, every character, depth and mode. No exceptions, invariants hold.
const { Run, PHASE, MODE, Rng, CHARACTERS } = require('./load.js')();
const r = new Rng(7); const out = { won: 0, lost: 0, stuck: 0, endlessFloors: 0 }; const N = 1400;
for (let k = 0; k < N; k++) {
  const mode = [MODE.RUN, MODE.RUN, MODE.DAILY, MODE.ENDLESS][k % 4];
  const run = new Run(r.int(1e9), { character: CHARACTERS[k % CHARACTERS.length], depth: k % 6, mode }); let steps = 0;
  while (!run.over && steps++ < 4000) {
    if (run.hearts < 1 || run.hearts > run.maxHearts || run.coins < 0 || run.multiplier > run.topMultiplier) throw new Error(`invariant ${run.hearts} ${run.coins}`);
    const a = r.int(10); const i = r.int(36);
    if (run.phase === PHASE.FLOOR) {
      if (run.cleared && a < 3) run.descend();
      else if (a < 6) run.flip(i); else if (a < 7) run.toggleMark(i); else run.useItem(['probe', 'lantern', 'sonar', 'medkit'][r.int(4)], i);
    } else if (run.phase === PHASE.SHOP) { if (a < 2) run.buy(r.int(4)); else if (a < 3) run.patch(); else if (a < 4) run.reroll(); else run.leaveShop(); }
    else if (run.phase === PHASE.PATH) run.choosePath(a < 5);
    else if (run.phase === PHASE.BOSS_GATE) { run.payToll(r.int(2) === 0); run.sabotage(0); run.enterBoss(); }
  }
  if (run.phase === PHASE.WON) out.won++; else if (run.phase === PHASE.LOST) out.lost++; else out.stuck++;
  if (run.endless) out.endlessFloors = Math.max(out.endlessFloors, run.stats.floorsCleared);
}
console.log(out);

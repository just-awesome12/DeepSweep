// Follow the coach blindly through the whole practice: two floors and the shop. It never leads into a trap.
const {Run,Coach,PHASE,Rng}=require('./load.js')();
const r=new Rng(5);let ok=0,N=400,goals=0,probes=0,guesses=0;
for(let k=0;k<N;k++){const run=new Run(r.int(1e9),{practice:true});let g=0;
 while(run.phase!==PHASE.PRACTICE_DONE&&g++<400){const a=Coach.advise(run);
  if(run.phase===PHASE.SHOP){if(a.action==='shop')run.buy(0);else run.leaveShop();continue;}
  if(run.cleared){run.descend();continue;}
  if(!a.cells.length)throw new Error('no advice: '+a.text);
  const guess=/least risky/.test(a.text);
  if(a.action==='mark')a.cells.forEach(i=>run.toggleMark(i));
  else if(a.action==='probe'){if(!run.useItem('probe',a.cells[0]))throw new Error('probe failed');probes++;}
  else a.cells.forEach(i=>run.flip(i));
  if(guess)guesses++;else if(/^Trap/.test(run.message))throw new Error('coach led into a trap: '+a.text);}
 if(run.phase===PHASE.PRACTICE_DONE)ok++;
 if(Coach.GOALS.filter(x=>x.done(run)).length>=6)goals++;}
console.log({ok,N,probes,guesses,sixGoals:goals});

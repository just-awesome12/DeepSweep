/** Test helper: load the engine, run and meta sources as one scope, as the page does. */
const fs = require('fs');
const NAMES = 'Rng,KIND,Board,Solver,Generator,cacheOdds,GRID,FLOORS,RULES,ITEMS,BOSSES,CHARACTERS,DEPTHS,floorConfig,itemDeck,Run,Coach,PHASE,MODE,ITEM_BY_ID,FEATS,ACHIEVEMENTS,starsFor,dailyRun,dailyCard,Profile';
module.exports = (patch = (code) => code) => {
  const code = patch(['engine.js', 'run.js', 'meta.js'].map((f) => fs.readFileSync(`${__dirname}/../src/${f}`, 'utf8')).join('\n'));
  return new Function('module', `${code};return {${NAMES}};`)(undefined);
};

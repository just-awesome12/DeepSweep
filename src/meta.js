/**
 * Deepsweep progress between runs: stars, character unlocks, depth levels, achievements, the daily run.
 * No DOM access. Depends on the engine and run globals. Storage is optional.
 */

/** Feat checks for characters with a feat unlock. Each runs at the end of a won run. */
const FEATS = Object.freeze({
  surveyor: (run) => run.stats.heartsLost === 0,
  daredevil: (run) => run.stats.bestMultiplier >= run.topMultiplier,
  ghost: (run) => run.stats.bought === 0,
});

/**
 * @typedef {Object} AchievementContext
 * @property {Run|null} run The run that just ended, or null outside a run.
 * @property {boolean} won
 * @property {Object} data Profile data, already updated with the run.
 */

/** @type {ReadonlyArray<{id:string, name:string, text:string, test:(c:AchievementContext)=>boolean}>} */
const ACHIEVEMENTS = Object.freeze([
  { id: 'tutorial', name: 'Trained', text: 'Finish the practice.', test: (c) => c.data.tutorial },
  { id: 'win', name: 'First descent', text: 'Win a run.', test: (c) => c.won },
  { id: 'untouched', name: 'Untouched', text: 'Win a run without losing a heart.', test: (c) => c.won && c.run.stats.heartsLost === 0 },
  { id: 'closecall', name: 'Close call', text: 'Win a run with 1 heart left.', test: (c) => c.won && c.run.hearts === 1 },
  { id: 'minimalist', name: 'Minimalist', text: 'Win a run without buying an item.', test: (c) => c.won && c.run.stats.bought === 0 },
  { id: 'gearhead', name: 'Gearhead', text: 'Hold 5 gear pieces at once.', test: (c) => Boolean(c.run) && c.run.stats.gearPeak >= 5 },
  { id: 'roll', name: 'On a roll', text: 'Reach a x3 multiplier.', test: (c) => Boolean(c.run) && c.run.stats.bestMultiplier >= 3 },
  { id: 'maxed', name: 'Maxed out', text: "Reach your character's top multiplier.", test: (c) => Boolean(c.run) && c.run.stats.bestMultiplier >= c.run.topMultiplier },
  { id: 'jackpot', name: 'Jackpot', text: 'Collect 20 or more coins from one cache.', test: (c) => Boolean(c.run) && c.run.stats.bestPay >= 20 },
  { id: 'score100', name: 'Big score', text: 'Score 100 or more in one run.', test: (c) => Boolean(c.run) && c.run.score >= 100 },
  { id: 'cleansweep', name: 'Clean sweep', text: 'Win a run with every cache found on all four floors.', test: (c) => c.won && c.run.stats.allCacheFloors >= FLOORS.length },
  { id: 'flagged', name: 'By the book', text: 'Clear a floor with every trap marked.', test: (c) => Boolean(c.run) && c.run.stats.fullyMarked >= 1 },
  { id: 'risky', name: 'Rich veins', text: 'Win a run taking the rich vein at every fork.', test: (c) => c.won && c.run.stats.pathChoices > 0 && c.run.stats.riskyPaths === c.run.stats.pathChoices },
  { id: 'gems', name: 'Gem hound', text: 'Win a run with every gem found.', test: (c) => c.won && c.run.stats.gems >= FLOORS.length * RULES.gemsPerFloor },
  { id: 'bosses', name: 'Boss hunter', text: `Beat all ${BOSSES.length} bosses.`, test: (c) => c.data.bosses.length >= BOSSES.length },
  { id: 'depth3', name: 'Deeper', text: 'Win at depth 3.', test: (c) => c.won && c.run.depth >= 3 },
  { id: 'depth5', name: 'Rock bottom', text: 'Win at depth 5.', test: (c) => c.won && c.run.depth >= 5 },
  { id: 'daily', name: 'Daily driver', text: 'Finish a daily run.', test: (c) => Boolean(c.run) && c.run.mode === MODE.DAILY },
  { id: 'endless10', name: 'Bottomless', text: 'Clear 10 floors in endless mode.', test: (c) => Boolean(c.run) && c.run.endless && c.run.stats.floorsCleared >= 10 },
  { id: 'caches100', name: 'Cache king', text: 'Collect 100 caches across all runs.', test: (c) => c.data.caches >= 100 },
  { id: 'roster', name: 'Full roster', text: `Unlock all ${CHARACTERS.length} characters.`, test: (c) => c.data.characters.length >= CHARACTERS.length },
].map(Object.freeze));

/**
 * Stars a finished run pays. Stars buy characters.
 * @param {Run} run
 * @returns {number}
 */
function starsFor(run) {
  return Math.floor(run.score / 10) + (run.phase === PHASE.WON ? 3 + 2 * run.depth : 0);
}

/**
 * The daily run. Everyone gets the same seed on the same UTC date.
 * @param {Date} [date]
 * @returns {{key:string, seed:number}}
 */
function dailyRun(date = new Date()) {
  const key = date.toISOString().slice(0, 10);
  return { key, seed: Math.imul(Number(key.replace(/-/g, '')), 2654435761) >>> 0 };
}

/**
 * @typedef {Object} RunRewards
 * @property {number} stars Stars this run paid.
 * @property {CharacterDef[]} characters Characters this run unlocked.
 * @property {Object[]} achievements Achievements this run earned.
 * @property {boolean} depthUp True when the run opened the next depth level.
 */

/** Saved progress. Works without storage; progress then lasts for the visit only. */
class Profile {
  static KEY = 'deepsweep.profile.v2';
  static #defaults() {
    return {
      runs: 0, wins: 0, best: 0, caches: 0, bosses: [], tutorial: false, muted: false, stars: 0,
      character: 'sapper', characters: CHARACTERS.filter((c) => c.unlock.type === 'free').map((c) => c.id),
      depth: 0, depthMax: 0, achievements: [], daily: null, endlessBest: 0,
    };
  }

  #data;
  #storage;

  /** @param {Storage|null} [storage] Defaults to localStorage when it exists. */
  constructor(storage) {
    this.#storage = storage === undefined ? Profile.#browserStorage() : storage;
    let saved = null;
    try { saved = JSON.parse((this.#storage && this.#storage.getItem(Profile.KEY)) || 'null'); } catch (err) { /* storage is optional */ }
    this.#data = { ...Profile.#defaults(), ...(saved && typeof saved === 'object' ? saved : {}) };
    for (const key of ['bosses', 'characters', 'achievements']) {
      if (!Array.isArray(this.#data[key])) this.#data[key] = Profile.#defaults()[key];
    }
  }

  static #browserStorage() {
    try { return typeof localStorage === 'undefined' ? null : localStorage; } catch (err) { return null; }
  }

  /** @param {string} key @returns {*} */
  get(key) { return this.#data[key]; }

  /** @param {string} key @param {*} value */
  set(key, value) {
    this.#data[key] = value;
    this.#save();
  }

  /** @param {CharacterDef} character @returns {boolean} */
  owns(character) { return this.#data.characters.includes(character.id); }

  /** @returns {CharacterDef} The selected character, or the first one if the selection is not owned. */
  get character() {
    return CHARACTERS.find((c) => c.id === this.#data.character && this.owns(c)) || CHARACTERS[0];
  }

  /** @returns {number} The selected depth, never above the highest one unlocked. */
  get depth() { return Math.min(this.#data.depth, this.#data.depthMax); }

  /** @param {string} id @returns {boolean} */
  hasAchievement(id) { return this.#data.achievements.includes(id); }

  /**
   * Buy a character with stars.
   * @param {CharacterDef} character
   * @returns {Object[]} Achievements the purchase earned. Empty when the purchase fails.
   */
  buy(character) {
    const { unlock } = character;
    if (unlock.type !== 'buy' || this.owns(character) || this.#data.stars < unlock.cost) return [];
    this.#data.stars -= unlock.cost;
    this.#data.characters.push(character.id);
    this.#data.character = character.id;
    return this.#award({ run: null, won: false });
  }

  /** Record the finished practice. @returns {Object[]} Achievements earned. */
  finishTutorial() {
    this.#data.tutorial = true;
    return this.#award({ run: null, won: false });
  }

  /**
   * Record a finished run.
   * @param {Run} run
   * @returns {RunRewards}
   */
  record(run) {
    const d = this.#data;
    const won = run.phase === PHASE.WON;
    const stars = starsFor(run);
    d.runs++;
    d.caches += run.stats.caches;
    d.best = Math.max(d.best, run.score);
    d.stars += stars;
    if (run.endless) d.endlessBest = Math.max(d.endlessBest, run.stats.floorsCleared);
    if (run.mode === MODE.DAILY) {
      const { key } = dailyRun();
      if (!d.daily || d.daily.key !== key || run.score > d.daily.score) d.daily = { key, score: run.score, won };
    }
    let depthUp = false;
    const characters = [];
    if (won) {
      d.wins++;
      run.bosses.forEach((boss) => { if (!d.bosses.includes(boss.id)) d.bosses.push(boss.id); });
      if (run.mode === MODE.RUN && run.depth === d.depthMax && d.depthMax < DEPTHS.length - 1) { d.depthMax++; depthUp = true; }
      for (const character of CHARACTERS) {
        if (character.unlock.type !== 'feat' || this.owns(character) || !FEATS[character.id](run)) continue;
        d.characters.push(character.id);
        characters.push(character);
      }
    }
    const achievements = this.#award({ run, won });
    return { stars, characters, achievements, depthUp };
  }

  /** Grant every achievement whose test now passes. Saves. @returns {Object[]} Newly earned ones. */
  #award({ run, won }) {
    const context = { run, won, data: this.#data };
    const earned = ACHIEVEMENTS.filter((a) => !this.hasAchievement(a.id) && a.test(context));
    earned.forEach((a) => this.#data.achievements.push(a.id));
    this.#save();
    return earned;
  }

  #save() {
    try { if (this.#storage) this.#storage.setItem(Profile.KEY, JSON.stringify(this.#data)); } catch (err) { /* storage is optional */ }
  }
}

if (typeof module !== 'undefined') module.exports = { FEATS, ACHIEVEMENTS, starsFor, dailyRun, Profile };

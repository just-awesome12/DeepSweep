/**
 * Deepsweep engine: seeded boards, a logic-only solver, and a board generator.
 * No DOM access. Shared by the digital game, the balance simulation and the print kit.
 */

/** Seeded pseudo-random number generator (mulberry32). */
class Rng {
  #state;

  /** @param {number} seed Unsigned 32-bit seed. */
  constructor(seed) { this.#state = seed >>> 0; }

  /** @returns {number} Float in [0, 1). */
  next() {
    this.#state = (this.#state + 0x6D2B79F5) >>> 0;
    let t = this.#state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** @param {number} n Exclusive upper bound. @returns {number} Integer in [0, n). */
  int(n) { return Math.floor(this.next() * n); }

  /** @template T @param {T[]} list Shuffled in place. @returns {T[]} */
  shuffle(list) {
    for (let i = list.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      [list[i], list[j]] = [list[j], list[i]];
    }
    return list;
  }
}

/** Cell kinds. A buried cell is a trap or a cache. */
const KIND = Object.freeze({ SAFE: 0, TRAP: 1, CACHE: 2 });

/**
 * @typedef {Object} FloorConfig
 * @property {number} rows
 * @property {number} cols
 * @property {number} traps
 * @property {number} caches
 * @property {number} start Start tile index. It and its neighbors are never buried.
 * @property {number} [tier] Required logic tier (1 to 3). Applies to no-guess floors only.
 * @property {number} [stalls] Exact count of forced guesses. 0 or unset means a no-guess floor.
 * @property {number} [minOdds] Lowest allowed risk for a forced guess. Keeps guesses real.
 */

/** Immutable floor layout with precomputed clues. */
class Board {
  #rows; #cols; #start; #kind; #number; #neighbors; #traps; #caches; #hint; #cacheCells;

  /** @param {{rows:number, cols:number, start:number, traps:number[], caches:number[]}} layout */
  constructor({ rows, cols, start, traps, caches }) {
    this.#rows = rows;
    this.#cols = cols;
    this.#start = start;
    this.#traps = traps.length;
    this.#caches = caches.length;
    this.#kind = new Uint8Array(rows * cols);
    traps.forEach((i) => { this.#kind[i] = KIND.TRAP; });
    caches.forEach((i) => { this.#kind[i] = KIND.CACHE; });
    this.#neighbors = Array.from({ length: rows * cols }, (_, i) => Board.neighborsOf(i, rows, cols));
    this.#number = Uint8Array.from(this.#neighbors, (list) => list.filter((n) => this.#kind[n] !== KIND.SAFE).length);
    this.#hint = Object.freeze({ row: Math.floor(caches[0] / cols), col: caches[1] % cols });
    this.#cacheCells = Object.freeze([...caches]);
  }

  /** @returns {number[]} Indices of the up-to-8 adjacent cells. */
  static neighborsOf(i, rows, cols) {
    const r = Math.floor(i / cols);
    const c = i % cols;
    const out = [];
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        const rr = r + dr;
        const cc = c + dc;
        if ((dr || dc) && rr >= 0 && rr < rows && cc >= 0 && cc < cols) out.push(rr * cols + cc);
      }
    }
    return out;
  }

  /**
   * Bury traps and caches at random outside the start area.
   * @param {FloorConfig} config
   * @param {Rng} rng
   * @returns {Board}
   */
  static random({ rows, cols, traps, caches, start }, rng) {
    const blocked = new Set([start, ...Board.neighborsOf(start, rows, cols)]);
    const pool = [];
    for (let i = 0; i < rows * cols; i++) if (!blocked.has(i)) pool.push(i);
    if (traps + caches > pool.length) throw new RangeError('Too many buried tiles for this grid.');
    rng.shuffle(pool);
    return new Board({ rows, cols, start, caches: pool.slice(0, caches), traps: pool.slice(caches, caches + traps) });
  }

  get rows() { return this.#rows; }
  get cols() { return this.#cols; }
  get size() { return this.#rows * this.#cols; }
  get start() { return this.#start; }
  get trapCount() { return this.#traps; }
  get cacheCount() { return this.#caches; }
  get buriedCount() { return this.#traps + this.#caches; }
  get safeCount() { return this.size - this.buriedCount; }

  /** @param {number} i @returns {number} A KIND value. */
  kind(i) { return this.#kind[i]; }
  /** @param {number} i @returns {boolean} */
  isBuried(i) { return this.#kind[i] !== KIND.SAFE; }
  /** @param {number} i @returns {number} Adjacent buried tiles (traps plus caches). */
  number(i) { return this.#number[i]; }
  /** @returns {{row:number, col:number}} Cache A lies in this row, cache B in this column (0-based). */
  get cacheHint() { return this.#hint; }
  /** @returns {ReadonlyArray<number>} [cache in the hint row, cache in the hint column]. */
  get cacheCells() { return this.#cacheCells; }
  /** @param {number} i @returns {number[]} */
  neighbors(i) { return this.#neighbors[i]; }

  /**
   * Open a safe tile and cascade through blank tiles.
   * @param {number} i Safe tile to open.
   * @param {Uint8Array} open Open-state array, mutated in place.
   * @returns {number} Count of newly opened tiles.
   */
  flood(i, open) {
    const stack = [i];
    let opened = 0;
    while (stack.length) {
      const cell = stack.pop();
      if (open[cell] || this.#kind[cell] !== KIND.SAFE) continue;
      open[cell] = 1;
      opened++;
      if (this.#number[cell] === 0) stack.push(...this.#neighbors[cell]);
    }
    return opened;
  }

  /** @param {number} i @returns {string} Printable value: T, C, or the clue digit. */
  label(i) {
    if (this.#kind[i] === KIND.TRAP) return 'T';
    if (this.#kind[i] === KIND.CACHE) return 'C';
    return String(this.#number[i]);
  }
}

/**
 * @typedef {Object} Deduction
 * @property {number[]} safe Tiles proven safe.
 * @property {number[]} buried Tiles proven buried.
 * @property {number} tier Logic tier that produced the proof.
 */

/**
 * @typedef {Object} SolveResult
 * @property {boolean} solvable True when logic alone clears the floor.
 * @property {number} tier Hardest tier used (1 to 3).
 * @property {number[]} steps Deduction count per tier.
 * @property {number} stalls Forced guesses met on the way.
 * @property {number} worstOdds Highest risk among the best available guesses.
 * @property {number} easiestOdds Lowest risk among the best available guesses.
 */

/** Logic-only solver over buried and safe tiles. Traps and caches look alike to it. */
class Solver {
  static TIER = Object.freeze({ COUNT: 1, PATTERN: 2, DEEP: 3 });
  static MAX_FRONTIER = 22;

  #board; #open; #buried; #openCount = 0; #buriedCount = 0;

  /**
   * @param {Board} board
   * @param {Uint8Array} [open] Existing open state, copied.
   * @param {Uint8Array} [buried] Tiles already known to be buried, copied.
   */
  constructor(board, open, buried) {
    this.#board = board;
    this.#open = open ? Uint8Array.from(open) : new Uint8Array(board.size);
    this.#buried = buried ? Uint8Array.from(buried) : new Uint8Array(board.size);
    this.#open.forEach((v) => { this.#openCount += v; });
    this.#buried.forEach((v) => { this.#buriedCount += v; });
  }

  get solved() { return this.#openCount === this.#board.safeCount; }

  /** @param {{safe:number[], buried:number[]}} facts Apply proven facts. */
  apply({ safe, buried }) {
    safe.forEach((i) => { this.#openCount += this.#board.flood(i, this.#open); });
    buried.forEach((i) => {
      if (!this.#buried[i]) { this.#buried[i] = 1; this.#buriedCount++; }
    });
  }

  /**
   * Simplest proof a new player can follow: one clue counted against its covered neighbors.
   * @returns {{clue:number, cells:number[], buried:boolean}|null}
   */
  countingProof() {
    const constraints = this.#constraints();
    const safe = constraints.find((c) => c.need === 0);
    if (safe) return { clue: safe.from, cells: safe.cells, buried: false };
    const buried = constraints.find((c) => c.need === c.cells.length);
    return buried ? { clue: buried.from, cells: buried.cells, buried: true } : null;
  }

  /** @returns {Deduction|null} The easiest available proof, or null when only a guess remains. */
  step() {
    const constraints = this.#constraints();
    const count = this.#byCounting(constraints);
    if (count.safe.size || count.buried.size) return Solver.#deduction(count, Solver.TIER.COUNT);
    const pattern = this.#byPattern(constraints);
    if (pattern.safe.size || pattern.buried.size) return Solver.#deduction(pattern, Solver.TIER.PATTERN);
    const tally = this.#enumerate(constraints);
    if (!tally) return null;
    const deep = { safe: new Set(), buried: new Set() };
    tally.risk.forEach((p, cell) => {
      if (p === 0) deep.safe.add(cell);
      else if (p === 1) deep.buried.add(cell);
    });
    return deep.safe.size || deep.buried.size ? Solver.#deduction(deep, Solver.TIER.DEEP) : null;
  }

  /**
   * Chance that each covered, unidentified tile is buried.
   * @returns {Map<number, number>|null} Null when the frontier is too large to enumerate.
   */
  riskMap() {
    const tally = this.#enumerate(this.#constraints());
    return tally ? tally.risk : null;
  }

  /**
   * Solve from the start tile. At a stall, the lowest-risk tile is revealed for free
   * and counted, so boss floors can be rated by their forced guesses.
   * @returns {SolveResult}
   */
  solveFromStart() {
    this.apply({ safe: [this.#board.start], buried: [] });
    const steps = [0, 0, 0, 0];
    let stalls = 0;
    let worstOdds = 0;
    let easiestOdds = 1;
    while (!this.solved) {
      const deduction = this.step();
      if (deduction) {
        steps[deduction.tier]++;
        this.apply(deduction);
        continue;
      }
      const risk = this.riskMap();
      if (!risk || !risk.size) return { solvable: false, tier: 3, steps, stalls: 99, worstOdds: 1, easiestOdds: 1 };
      let best = -1;
      let bestRisk = 2;
      risk.forEach((p, cell) => { if (p < bestRisk) { bestRisk = p; best = cell; } });
      stalls++;
      worstOdds = Math.max(worstOdds, bestRisk);
      easiestOdds = Math.min(easiestOdds, bestRisk);
      this.apply(this.#board.isBuried(best) ? { safe: [], buried: [best] } : { safe: [best], buried: [] });
    }
    const tier = steps[3] ? 3 : steps[2] ? 2 : 1;
    return { solvable: stalls === 0, tier, steps, stalls, worstOdds, easiestOdds };
  }

  static #deduction({ safe, buried }, tier) {
    return { safe: [...safe], buried: [...buried], tier };
  }

  /** @returns {{cells:number[], need:number}[]} One constraint per open clue with unknown neighbors. */
  #constraints() {
    const out = [];
    for (let i = 0; i < this.#board.size; i++) {
      if (!this.#open[i] || this.#board.number(i) === 0) continue;
      const cells = [];
      let known = 0;
      for (const n of this.#board.neighbors(i)) {
        if (this.#buried[n]) known++;
        else if (!this.#open[n]) cells.push(n);
      }
      if (cells.length) out.push({ cells, need: this.#board.number(i) - known, from: i });
    }
    return out;
  }

  /** Tier 1: a clue with nothing left to find, or with as many left as covered neighbors. */
  #byCounting(constraints) {
    const safe = new Set();
    const buried = new Set();
    for (const { cells, need } of constraints) {
      if (need === 0) cells.forEach((c) => safe.add(c));
      else if (need === cells.length) cells.forEach((c) => buried.add(c));
    }
    return { safe, buried };
  }

  /** Tier 2: compare two clues where one covered set sits inside the other. */
  #byPattern(constraints) {
    const safe = new Set();
    const buried = new Set();
    for (const a of constraints) {
      const inner = new Set(a.cells);
      for (const b of constraints) {
        if (a === b || a.cells.length >= b.cells.length) continue;
        if (!a.cells.every((c) => b.cells.includes(c))) continue;
        const rest = b.cells.filter((c) => !inner.has(c));
        const need = b.need - a.need;
        if (need === 0) rest.forEach((c) => safe.add(c));
        else if (need === rest.length) rest.forEach((c) => buried.add(c));
      }
    }
    return { safe, buried };
  }

  /**
   * Tier 3: weigh every buried arrangement that fits all clues and the buried total.
   * @returns {{risk: Map<number, number>}|null}
   */
  #enumerate(constraints) {
    const frontier = [...new Set(constraints.flatMap((c) => c.cells))];
    const n = frontier.length;
    if (n > Solver.MAX_FRONTIER) return null;

    const index = new Map(frontier.map((cell, i) => [cell, i]));
    const outside = [];
    for (let i = 0; i < this.#board.size; i++) {
      if (!this.#open[i] && !this.#buried[i] && !index.has(i)) outside.push(i);
    }
    const remaining = this.#board.buriedCount - this.#buriedCount;
    const byCell = frontier.map(() => []);
    constraints.forEach((c) => {
      const tracker = { need: c.need, got: 0, left: c.cells.length };
      c.cells.forEach((cell) => byCell[index.get(cell)].push(tracker));
    });

    const assign = new Uint8Array(n);
    const hits = new Float64Array(n);
    let total = 0;
    let outsideHits = 0;
    let used = 0;

    const place = (pos) => {
      if (pos === n) {
        const rest = remaining - used;
        if (rest < 0 || rest > outside.length) return;
        const weight = Solver.#choose(outside.length, rest);
        total += weight;
        for (let i = 0; i < n; i++) hits[i] += assign[i] * weight;
        if (outside.length) outsideHits += weight * (rest / outside.length);
        return;
      }
      for (let v = 0; v <= 1; v++) {
        if (v && used >= remaining) continue;
        let ok = true;
        for (const t of byCell[pos]) {
          t.left--;
          t.got += v;
          if (t.got > t.need || t.need - t.got > t.left) ok = false;
        }
        if (ok) {
          assign[pos] = v;
          used += v;
          place(pos + 1);
          used -= v;
        }
        for (const t of byCell[pos]) { t.left++; t.got -= v; }
      }
    };
    place(0);
    if (!total) return null;

    const risk = new Map();
    const snap = (p) => (p < 1e-9 ? 0 : p > 1 - 1e-9 ? 1 : p);
    frontier.forEach((cell, i) => risk.set(cell, snap(hits[i] / total)));
    outside.forEach((cell) => risk.set(cell, snap(outsideHits / total)));
    return { risk };
  }

  /** @returns {number} Binomial coefficient. */
  static #choose(n, k) {
    if (k < 0 || k > n) return 0;
    let out = 1;
    for (let i = 1; i <= k; i++) out = (out * (n - k + i)) / i;
    return out;
  }
}

/**
 * Chance that each covered tile holds a cache, once every covered tile is known to be buried.
 * Uses the floor hint: cache A lies in the hint row, cache B in the hint column.
 * @param {Board} board
 * @param {Uint8Array} open Open safe tiles.
 * @param {Int8Array} found Per tile: -1 unknown, else the KIND already identified.
 * @returns {Map<number, number>} Unidentified covered tile to cache probability.
 */
function cacheOdds(board, open, found) {
  const { row, col } = board.cacheHint;
  const candidate = (i) => !open[i] && found[i] !== KIND.TRAP;
  const inRow = [];
  const inCol = [];
  const foundCaches = [];
  for (let i = 0; i < board.size; i++) {
    if (found[i] === KIND.CACHE) foundCaches.push(i);
    if (!candidate(i)) continue;
    if (Math.floor(i / board.cols) === row) inRow.push(i);
    if (i % board.cols === col) inCol.push(i);
  }
  const hits = new Map();
  let total = 0;
  for (const a of inRow) {
    for (const b of inCol) {
      if (a === b || !foundCaches.every((c) => c === a || c === b)) continue;
      total++;
      [a, b].forEach((c) => hits.set(c, (hits.get(c) || 0) + 1));
    }
  }
  const odds = new Map();
  for (let i = 0; i < board.size; i++) {
    if (!open[i] && found[i] < 0) odds.set(i, total ? (hits.get(i) || 0) / total : 0);
  }
  return odds;
}

/**
 * @typedef {Object} Found
 * @property {Board} board
 * @property {SolveResult} result
 * @property {number} seed Seed that produced this exact board.
 * @property {number} tries Layouts tested before this one passed.
 */

/** Searches seeds for layouts that match a floor config. */
class Generator {
  static MAX_TRIES = 20000;

  /**
   * @param {FloorConfig} config
   * @param {number} seed First seed to test. Later tries use seed + 1, seed + 2, ...
   * @returns {Found|null}
   */
  static find(config, seed) {
    for (let t = 0; t < Generator.MAX_TRIES; t++) {
      const boardSeed = (seed + t) >>> 0;
      const board = Board.random(config, new Rng(boardSeed));
      const result = new Solver(board).solveFromStart();
      if (Generator.#accepts(config, result)) return { board, result, seed: boardSeed, tries: t + 1 };
    }
    return null;
  }

  static #accepts({ tier, stalls = 0, minOdds = 0.3 }, result) {
    if (result.stalls !== stalls) return false;
    if (stalls) return result.easiestOdds >= minOdds && result.worstOdds <= 0.5;
    return !tier || result.tier === tier;
  }
}

/**
 * The run: three floors and a boss floor, all 6x6 with a center start.
 * `stalls` is the count of dead ends, the points where logic runs out and a guess or a tool is needed.
 */
const GRID = Object.freeze({ rows: 6, cols: 6, start: 21 });
const RULES_MIN_ODDS = 0.45;
const FLOORS = Object.freeze([
  Object.freeze({ ...GRID, name: 'Floor 1', traps: 5, caches: 2, stalls: 0, tier: 1, bonus: 0 }),
  Object.freeze({ ...GRID, name: 'Floor 2', traps: 6, caches: 2, stalls: 1, minOdds: RULES_MIN_ODDS, bonus: 0 }),
  Object.freeze({ ...GRID, name: 'Floor 3', traps: 7, caches: 2, stalls: 2, minOdds: RULES_MIN_ODDS, bonus: 0 }),
  Object.freeze({ ...GRID, name: 'Boss floor', traps: 8, caches: 2, stalls: 3, minOdds: RULES_MIN_ODDS, bonus: 0, boss: true }),
]);

/** Run rules shared by every build. */
const RULES = Object.freeze({
  startHearts: 3, maxHearts: 3, startCoins: 0, cacheCoins: 3, patchCost: 5, shopSize: 3,
  /** Safe flips in a row needed for each +1 of the cache multiplier. */
  streakStep: 8,
  /** Highest cache multiplier. */
  multCap: 5,
  /** Score points for each heart left at the end of a run. */
  heartPoints: 5,
  /** Gems hidden under safe tiles on each floor. */
  gemsPerFloor: 1,
  /** Safe flips a gem adds to the streak. */
  gemStreak: 2,
  /** Streak a player gives up to clear a clue the Jammer jammed. */
  jamCost: 2,
  /** Score bonus for each depth level. */
  depthBonus: 0.2,
});

/**
 * @typedef {Object} ItemDef
 * @property {string} id
 * @property {string} name
 * @property {number} cost
 * @property {number} copies Cards of this item in the 20-card deck.
 * @property {boolean} gear True for permanent gear, false for single-use tools.
 * @property {string} text Rules text.
 */

/** @type {ReadonlyArray<ItemDef>} */
const ITEMS = Object.freeze([
  { id: 'probe', name: 'Probe', cost: 4, copies: 4, gear: false, text: 'Identify one covered tile safely. A safe tile opens, a trap is marked, a cache is collected.' },
  { id: 'shield', name: 'Shield', cost: 4, copies: 3, gear: false, text: 'When a trap hits you, discard this to lose no hearts.' },
  { id: 'medkit', name: 'Medkit', cost: 5, copies: 2, gear: false, text: 'Gain 2 hearts, up to the maximum of 3.' },
  { id: 'coin', name: 'Lucky Coin', cost: 3, copies: 2, gear: false, text: 'When a trap hits you, discard this and flip a coin. Heads: lose no hearts.' },
  { id: 'sonar', name: 'Sonar', cost: 6, copies: 2, gear: false, text: 'Pick one open tile. Use a Probe on every covered tile that touches it.' },
  { id: 'crowbar', name: 'Crowbar', cost: 3, copies: 1, gear: false, text: 'When you open a cache, discard this to double its coins.' },
  { id: 'wind', name: 'Second Wind', cost: 6, copies: 1, gear: false, text: 'When you drop to 0 hearts, discard this and return to 1 heart.' },
  { id: 'lantern', name: 'Lantern', cost: 7, copies: 1, gear: true, text: 'Gear. Once per floor, use it as a Probe.' },
  { id: 'boots', name: 'Thick Boots', cost: 8, copies: 1, gear: true, text: 'Gear. The first trap that hits you on each floor costs no hearts.' },
  { id: 'magnet', name: 'Magnet', cost: 6, copies: 1, gear: true, text: 'Gear. Every cache pays 1 extra coin.' },
  { id: 'ledger', name: 'Ledger', cost: 6, copies: 1, gear: true, text: 'Gear. Gain 2 extra coins each time you clear a floor.' },
  { id: 'token', name: "Haggler's Token", cost: 5, copies: 1, gear: true, text: 'Gear. Every shop price drops by 1, to a minimum of 1.' },
  { id: 'die', name: 'Loaded Die', cost: 6, copies: 1, gear: true, text: 'Gear. Caches pay double. Each trap costs 1 extra heart.' },
  { id: 'first', name: 'First Step', cost: 6, copies: 1, gear: true, text: 'Gear. Your first flip on each floor is safe. A trap there is disarmed and marked.' },
  { id: 'steady', name: 'Steady Hands', cost: 6, copies: 1, gear: true, text: 'Gear. Once per floor, a trap does not reset your streak.' },
  { id: 'momentum', name: 'Momentum', cost: 7, copies: 1, gear: true, text: 'Gear. Your multiplier grows every 5 safe flips instead of 8.' },
  { id: 'bounty', name: 'Bounty Board', cost: 5, copies: 1, gear: true, text: 'Gear. Gain 2 coins each time a Probe, Lantern, Sonar or First Step marks a trap.' },
  { id: 'echo', name: 'Echo', cost: 6, copies: 1, gear: true, text: 'Gear. When you spend a tool, flip a coin. Heads: you keep the tool.' },
  { id: 'purse', name: "Miser's Purse", cost: 5, copies: 1, gear: true, text: 'Gear. At each shop, gain 1 coin for every 5 coins you hold, up to 3.' },
  { id: 'rod', name: 'Dowsing Rod', cost: 8, copies: 1, gear: true, text: 'Gear. When you clear a floor, the cache in the hint row is found and collected.' },
].map(Object.freeze));

/**
 * Bosses. `act` marks a boss that also acts on the board: every `every` safe flips it changes `count` tiles.
 * What each one does is in `Run`. Nothing a boss does to the board costs a heart or hides a tile for good.
 * @type {ReadonlyArray<{id:string, name:string, text:string, act?:{every:number, count:number}}>}
 */
const BOSSES = Object.freeze([
  { id: 'crusher', name: 'The Crusher', act: Object.freeze({ every: 4, count: 2 }), text: 'Each trap costs 2 hearts on this floor. Every 4 safe flips, it buries 2 open tiles again. Flip them to dig them out.' },
  { id: 'hoarder', name: 'The Hoarder', text: 'You win only after both caches on this floor are found.' },
  { id: 'jammer', name: 'The Jammer', act: Object.freeze({ every: 4, count: 1 }), text: `No item works on this floor. Gear counts as items. Every 4 safe flips, it jams a clue. Tap the clue to clear it for ${RULES.jamCost} streak.` },
  { id: 'toll', name: 'The Tollkeeper', text: 'On entry, pay 3 coins or lose 1 heart.' },
  { id: 'saboteur', name: 'The Saboteur', text: 'On entry, discard half of your items, rounded up. You choose which.' },
  { id: 'rust', name: 'The Rust', text: 'On entry, discard every single-use tool. Gear stays.' },
  { id: 'brute', name: 'The Brute', text: 'On entry, lose 1 heart. It cannot take your last one.' },
].map(Object.freeze));

/**
 * @typedef {Object} CharacterDef
 * @property {string} id
 * @property {string} name
 * @property {string} text What sets the character apart.
 * @property {number} [hearts] Starting and maximum hearts. Default 3.
 * @property {number} [baseMult] Multiplier with no streak. Default 1.
 * @property {number} [multCap] Top multiplier. Default 5.
 * @property {number} [startCoins] Default 0.
 * @property {string} [ability] reveal, halve, ignoreBoss, shop or heal (cheap patching).
 * @property {{type:'free'}|{type:'buy', cost:number}|{type:'feat', text:string}} unlock
 */

/** Playable characters. Their rules are ones no gear gives. @type {ReadonlyArray<CharacterDef>} */
const CHARACTERS = Object.freeze([
  { id: 'sapper', name: 'Sapper', text: 'No special rule. 3 hearts, multiplier up to x5.', unlock: { type: 'free' } },
  { id: 'gambler', name: 'Gambler', hearts: 2, baseMult: 2, multCap: 6, text: 'Multiplier starts at x2 and tops out at x6. Only 2 hearts.', unlock: { type: 'free' } },
  { id: 'surveyor', name: 'Surveyor', ability: 'reveal', text: 'One trap is marked for you at the start of every floor.', unlock: { type: 'feat', text: 'Win a run without losing a heart' } },
  { id: 'daredevil', name: 'Daredevil', ability: 'halve', text: 'A trap halves your streak instead of resetting it.', unlock: { type: 'feat', text: 'Win a run after reaching the top multiplier' } },
  { id: 'ghost', name: 'Ghost', hearts: 2, ability: 'ignoreBoss', text: 'Boss rules do not apply to you. Only 2 hearts.', unlock: { type: 'feat', text: 'Win a run without buying an item' } },
  { id: 'banker', name: 'Banker', startCoins: 4, ability: 'shop', text: 'Shops offer 4 items and one free reroll. Start with 4 coins.', unlock: { type: 'buy', cost: 40 } },
  { id: 'medic', name: 'Medic', multCap: 3, ability: 'heal', text: 'Patching up costs 2 coins at any depth. Multiplier tops out at x3.', unlock: { type: 'buy', cost: 80 } },
].map(Object.freeze));

/** Depth levels. Each one adds its rule to all the rules before it. Index 0 is the standard game. */
const DEPTHS = Object.freeze([
  'Standard rules.',
  'Shop prices rise by 1.',
  'Patching up costs 7 coins.',
  'Every floor has 1 more trap.',
  'Caches pay 1 coin less.',
  'The boss floor has two boss rules.',
]);

/**
 * Floor layout for a place in the run.
 * @param {number} index Floor number, from 0.
 * @param {{depth?: number, risky?: boolean, endless?: boolean}} [options]
 * @returns {FloorConfig & {name:string, boss?:boolean, risky:boolean}}
 */
function floorConfig(index, { depth = 0, risky = false, endless = false } = {}) {
  const base = endless
    ? { ...GRID, name: `Floor ${index + 1}`, traps: Math.min(9, 5 + index), caches: 2, stalls: Math.min(3, Math.floor((index + 1) / 2)), minOdds: RULES_MIN_ODDS, tier: index === 0 ? 1 : undefined }
    : FLOORS[index];
  const stalls = Math.min(3, (base.stalls || 0) + (risky ? 1 : 0));
  return { ...base, traps: base.traps + (depth >= 3 ? 1 : 0) + (risky ? 1 : 0), stalls, tier: stalls ? undefined : base.tier, minOdds: RULES_MIN_ODDS, risky };
}

/** @returns {string[]} The item deck as item ids, unshuffled. */
function itemDeck() {
  return ITEMS.flatMap((item) => Array.from({ length: item.copies }, () => item.id));
}

const Deepsweep = { Rng, KIND, Board, Solver, Generator, cacheOdds, GRID, FLOORS, RULES, ITEMS, BOSSES, CHARACTERS, DEPTHS, floorConfig, itemDeck };
if (typeof module !== 'undefined') module.exports = Deepsweep;

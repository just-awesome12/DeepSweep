/**
 * Deepsweep run: the full rules of one run as a state machine. No DOM access.
 * Depends on the engine globals (Rng, KIND, Solver, Generator, FLOORS, RULES, ITEMS, BOSSES,
 * CHARACTERS, floorConfig, itemDeck).
 */

/** @enum {string} */
const PHASE = Object.freeze({ FLOOR: 'floor', SHOP: 'shop', PATH: 'path', BOSS_GATE: 'bossGate', WON: 'won', LOST: 'lost', PRACTICE_DONE: 'practiceDone' });

/** @enum {string} RUN is three floors and a boss. DAILY is a RUN on the day's shared seed. ENDLESS has no boss and no end. */
const MODE = Object.freeze({ RUN: 'run', DAILY: 'daily', ENDLESS: 'endless' });

/** Lookup of item definitions by id. */
const ITEM_BY_ID = Object.freeze(Object.fromEntries(ITEMS.map((item) => [item.id, item])));

/** Items the player triggers by hand. Every other item triggers on its own. */
const ACTIVE_ITEMS = Object.freeze(['probe', 'lantern', 'sonar', 'medkit']);

class Run {
  /** Floors played in practice mode. */
  static PRACTICE_FLOORS = 2;

  #rng;
  /** @type {string[]} */ #deck;
  /** Once-per-floor flags. */ #floorState = Run.#freshFloorState();
  /** Layout of the current floor. */ #config;
  /** Safe tiles that hide a gem on this floor. @type {Set<number>} */ #gems = new Set();

  static #freshFloorState() { return { bootsUsed: false, lanternUsed: false, steadyUsed: false, firstUsed: false, clearDone: false }; }

  /**
   * @param {number} seed Seed for the whole run: bosses, shops, boards and coin flips.
   * @param {{character?: CharacterDef, practice?: boolean, depth?: number, mode?: string}} [options]
   *   Practice mode is two floors with a shop between them, where traps cost no heart.
   */
  constructor(seed, { character = CHARACTERS[0], practice = false, depth = 0, mode = MODE.RUN } = {}) {
    this.seed = seed >>> 0;
    this.character = character;
    this.practice = practice;
    this.mode = practice ? MODE.RUN : mode;
    this.depth = practice || mode !== MODE.RUN ? 0 : depth;
    this.#rng = new Rng(this.seed);
    this.#deck = this.#rng.shuffle(itemDeck());
    this.maxHearts = character.hearts ?? RULES.startHearts;
    this.hearts = this.maxHearts;
    this.coins = character.startCoins ?? RULES.startCoins;
    /** @type {string[]} Item ids in hand. */
    this.items = [];
    /** Totals for the profile, unlocks and achievements. */
    this.stats = {
      caches: 0, floorsCleared: 0, marks: 0, flips: 0, bought: 0, itemsUsed: 0, earned: 0, gems: 0,
      bestMultiplier: character.baseMult ?? 1, trapsHit: 0, heartsLost: 0, bestPay: 0, gearPeak: 0,
      fullyMarked: 0, allCacheFloors: 0, riskyPaths: 0, pathChoices: 0,
      /** One entry per floor entered, in order. @type {{traps:number, caches:number, gems:number, cleared:boolean}[]} */
      floors: [],
    };
    /** Safe flips in a row. A trap resets it. It carries across floors. */
    this.streak = 0;
    const order = this.#rng.shuffle([...BOSSES]);
    /** Boss rules of this run: none in endless mode, two at depth 5. @type {{id:string, name:string, text:string}[]} */
    this.bosses = this.mode === MODE.ENDLESS ? [] : order.slice(0, this.depth >= 5 ? 2 : 1);
    this.floorIndex = -1;
    /** @type {string[]} Item ids on offer in the shop. */
    this.shop = [];
    /** Free shop rerolls left in this shop. */
    this.rerolls = 0;
    this.message = '';
    /** Items still to discard at the Saboteur gate. */
    this.discardsLeft = 0;
    /** True once the Tollkeeper is paid or has taken a heart. */
    this.tollSettled = false;
    /** Gems already collected on this floor. */
    this.gemTaken = new Uint8Array(0);
    this.#enterFloor(0, false);
  }

  /* ---------- read-only views ---------- */

  get floor() { return this.#config; }
  /** First boss of the run, for single-boss displays. */
  get boss() { return this.bosses[0]; }
  get endless() { return this.mode === MODE.ENDLESS; }
  get isBossFloor() { return Boolean(this.#config.boss); }
  get over() { return this.phase === PHASE.WON || this.phase === PHASE.LOST; }
  get openCount() { return this.open.reduce((sum, v) => sum + v, 0); }
  get cleared() { return this.openCount === this.board.safeCount; }
  get cachesFound() { return this.found.filter((k) => k === KIND.CACHE).length; }
  get trapsFound() { return this.found.filter((k) => k === KIND.TRAP).length; }
  /** True while the floor is clear and a cache is still buried: every covered tile left is a trap or a cache. */
  get hunting() { return this.phase === PHASE.FLOOR && this.cleared && this.cachesFound < this.board.cacheCount; }
  /** Coins the next cache opened on this floor pays, with the streak, the path and gear counted. */
  get cachePay() { return this.#cachePay().pay; }
  get lanternReady() { return this.has('lantern') && !this.#floorState.lanternUsed; }

  /** Score: every coin earned plus points for hearts left, raised by the depth bonus. */
  get score() {
    const base = this.stats.earned + RULES.heartPoints * Math.max(0, this.hearts);
    return Math.round(base * (1 + RULES.depthBonus * this.depth));
  }

  /** Safe flips needed for each +1 of the multiplier. */
  get streakStep() { return this.#gear('momentum') ? 5 : RULES.streakStep; }
  /** Highest multiplier this character reaches. */
  get topMultiplier() { return this.character.multCap ?? RULES.multCap; }
  /** Cache payout multiplier, from the streak. */
  get multiplier() { return Math.min(this.topMultiplier, (this.character.baseMult ?? 1) + Math.floor(this.streak / this.streakStep)); }
  /** Coins a cache pays before the multiplier. */
  get cacheCoins() { return RULES.cacheCoins - (this.depth >= 4 ? 1 : 0); }
  /** Cost of restoring one heart in the shop. */
  get patchCost() {
    if (this.character.ability === 'heal') return 2;
    return this.depth >= 2 ? 7 : RULES.patchCost;
  }
  get shopSize() { return this.character.ability === 'shop' ? RULES.shopSize + 1 : RULES.shopSize; }
  get canReroll() { return this.phase === PHASE.SHOP && !this.practice && this.rerolls > 0; }

  /** @returns {boolean} True when the boss floor win condition is met. */
  get bossBeaten() {
    return this.isBossFloor && this.cleared && (!this.bossRule('hoarder') || this.cachesFound === this.board.cacheCount);
  }

  /** @param {string} id Boss id. @returns {boolean} True when that boss rule is in force on this floor. */
  bossRule(id) { return this.isBossFloor && this.#facesBoss(id); }

  /** @param {string} id @returns {boolean} True when this run has that boss and the character does not ignore it. */
  #facesBoss(id) { return this.character.ability !== 'ignoreBoss' && this.bosses.some((b) => b.id === id); }

  /** @param {string} id @returns {boolean} */
  has(id) { return this.items.includes(id); }

  /** @param {number} i @returns {boolean} True when an open tile gave up a gem. */
  hasGem(i) { return this.gemTaken[i] === 1; }

  /** @param {string} id @returns {boolean} True when the player holds this item and items work here. */
  #gear(id) { return this.itemsWork && this.items.includes(id); }

  /** @returns {boolean} False on the Jammer's floor, where no item works. */
  get itemsWork() { return !this.bossRule('jammer'); }

  /** @param {string} id @returns {number} Shop price after depth and the Haggler's Token. */
  price(id) { return Math.max(1, ITEM_BY_ID[id].cost + (this.depth >= 1 ? 1 : 0) - (this.has('token') ? 1 : 0)); }

  /** @param {string} id @returns {boolean} True when the player can trigger this item now. */
  canUse(id) {
    if (this.phase !== PHASE.FLOOR || !this.itemsWork || !this.has(id) || !ACTIVE_ITEMS.includes(id)) return false;
    if (id === 'lantern') return this.lanternReady;
    if (id === 'medkit') return this.hearts < this.maxHearts;
    return true;
  }

  /* ---------- floor actions ---------- */

  /** Flip a covered tile and take what is under it. @param {number} i */
  flip(i) {
    if (!this.#isCovered(i)) return;
    this.marks[i] = 0;
    const kind = this.board.kind(i);
    const firstStep = this.#gear('first') && !this.#floorState.firstUsed;
    this.#floorState.firstUsed = true;
    if (kind === KIND.SAFE) {
      this.stats.flips++;
      this.streak++;
      this.stats.bestMultiplier = Math.max(this.stats.bestMultiplier, this.multiplier);
      this.#openSafe(i);
    } else if (kind === KIND.CACHE) { this.found[i] = KIND.CACHE; this.#collect(); }
    else if (firstStep) {
      this.found[i] = KIND.TRAP;
      this.message = `Trap. First Step disarms it.${this.#bounty()}`;
    } else { this.found[i] = KIND.TRAP; this.#hit(); }
  }

  /** Toggle the player's own mark on a covered tile. @param {number} i */
  toggleMark(i) {
    if (!this.#isCovered(i)) return;
    this.marks[i] ^= 1;
    if (this.marks[i]) this.stats.marks++;
  }

  /**
   * Use a hand-triggered item.
   * @param {string} id probe, lantern, sonar or medkit.
   * @param {number} [target] Covered tile for probe and lantern, open tile for sonar.
   * @returns {boolean} True when the item took effect.
   */
  useItem(id, target) {
    const used = this.#applyItem(id, target);
    if (used) this.stats.itemsUsed++;
    return used;
  }

  #applyItem(id, target) {
    if (!this.canUse(id)) return false;
    if (id === 'medkit') {
      this.hearts = Math.min(this.maxHearts, this.hearts + 2);
      this.message = `Medkit used. Hearts restored.${this.#spend(id)}`;
      return true;
    }
    if (id === 'sonar') {
      if (!this.open[target]) return false;
      const around = this.board.neighbors(target).filter((n) => this.#isCovered(n));
      if (!around.length) { this.message = 'No covered tile touches that tile.'; return false; }
      const echo = this.#spend(id);
      const seen = around.map((n) => this.#identify(n));
      this.message = `Sonar: ${Run.#tallyText(seen)}.${echo}`;
      return true;
    }
    if (!this.#isCovered(target)) return false;
    let echo = '';
    if (id === 'lantern') this.#floorState.lanternUsed = true;
    else echo = this.#spend(id);
    const kind = this.#identify(target);
    const name = ITEM_BY_ID[id].name;
    this.message = `${name}: ${['a safe tile, now open', 'a trap, now marked', 'a cache, collected'][kind]}.${echo}`;
    return true;
  }

  /** Leave a cleared floor: go to the shop, or win the run on the boss floor. */
  descend() {
    if (this.phase !== PHASE.FLOOR || !this.cleared) return;
    if (this.practice) {
      this.stats.floorsCleared = this.floorIndex + 1;
      if (this.floorIndex >= Run.PRACTICE_FLOORS - 1) { this.phase = PHASE.PRACTICE_DONE; this.message = ''; return; }
      this.coins = Math.max(this.coins, ITEM_BY_ID.probe.cost);
      this.shop = ['probe', 'shield', 'coin'];
      this.phase = PHASE.SHOP;
      this.message = '';
      return;
    }
    if (this.isBossFloor && !this.bossBeaten) return;
    this.stats.floorsCleared = this.floorIndex + 1;
    this.#floorLog.cleared = true;
    if (this.cachesFound === this.board.cacheCount) this.stats.allCacheFloors++;
    if (this.isBossFloor) { this.phase = PHASE.WON; this.message = `${this.bosses.map((b) => b.name).join(' and ')} beaten.`; return; }
    const notes = [];
    if (this.has('purse')) {
      const interest = Math.min(3, Math.floor(this.coins / 5));
      if (interest) { this.#earn(interest); notes.push(`Miser's Purse pays ${interest}.`); }
    }
    if (this.has('ledger')) { this.#earn(2); notes.push('Ledger pays 2.'); }
    this.shop = this.#draw(this.shopSize);
    this.rerolls = this.character.ability === 'shop' ? 1 : 0;
    this.phase = PHASE.SHOP;
    this.message = notes.join(' ');
  }

  /* ---------- shop actions ---------- */

  /** @param {number} slot Index into the shop offer. */
  buy(slot) {
    const id = this.shop[slot];
    if (this.phase !== PHASE.SHOP || !id || this.coins < this.price(id)) return;
    if (ITEM_BY_ID[id].gear && this.has(id)) return;
    this.coins -= this.price(id);
    this.shop.splice(slot, 1);
    this.items.push(id);
    this.stats.bought++;
    this.stats.gearPeak = Math.max(this.stats.gearPeak, this.items.filter((x) => ITEM_BY_ID[x].gear).length);
    this.message = `${ITEM_BY_ID[id].name} bought.`;
  }

  /** Pay to restore one heart. */
  patch() {
    if (this.phase !== PHASE.SHOP || this.practice || this.coins < this.patchCost || this.hearts >= this.maxHearts) return;
    this.coins -= this.patchCost;
    this.hearts++;
    this.message = 'Patched up. 1 heart restored.';
  }

  /** Swap the shop offer for new items. The Banker gets one free reroll per shop. */
  reroll() {
    if (!this.canReroll) return;
    this.rerolls--;
    this.shop = this.#draw(this.shopSize);
    this.message = 'New stock.';
  }

  /** Leave the shop: on to the path choice, the boss gate, or the next practice floor. */
  leaveShop() {
    if (this.phase !== PHASE.SHOP) return;
    const next = this.floorIndex + 1;
    this.message = '';
    if (this.practice) { this.#enterFloor(next, false); return; }
    if (this.endless || !FLOORS[next].boss) { this.phase = PHASE.PATH; return; }
    this.phase = PHASE.BOSS_GATE;
    this.tollSettled = !this.#facesBoss('toll');
    this.discardsLeft = this.#facesBoss('saboteur') ? Math.ceil(this.items.length / 2) : 0;
  }

  /**
   * Pick the next floor.
   * @param {boolean} risky True for the rich vein: 1 more trap and 1 more dead end, and caches pay double on that floor.
   */
  choosePath(risky) {
    if (this.phase !== PHASE.PATH) return;
    this.stats.pathChoices++;
    if (risky) this.stats.riskyPaths++;
    this.#enterFloor(this.floorIndex + 1, Boolean(risky));
  }

  /* ---------- boss gate actions ---------- */

  /** Settle the Tollkeeper. @param {boolean} withCoins Pay 3 coins, else lose 1 heart. */
  payToll(withCoins) {
    if (this.phase !== PHASE.BOSS_GATE || this.tollSettled) return;
    if (withCoins) {
      if (this.coins < 3) return;
      this.coins -= 3;
    } else {
      this.hearts--;
      this.stats.heartsLost++;
    }
    this.tollSettled = true;
    if (this.hearts <= 0) this.#lose('The toll takes your last heart.');
  }

  /** Discard one item for the Saboteur. @param {number} index Index into the hand. */
  sabotage(index) {
    if (this.phase !== PHASE.BOSS_GATE || this.discardsLeft <= 0 || index >= this.items.length) return;
    this.items.splice(index, 1);
    this.discardsLeft--;
  }

  /** Enter the boss floor once the gate is settled. */
  enterBoss() {
    if (this.phase !== PHASE.BOSS_GATE || !this.tollSettled || this.discardsLeft > 0) return;
    if (this.#facesBoss('rust')) this.items = this.items.filter((id) => ITEM_BY_ID[id].gear);
    if (this.#facesBoss('brute')) this.hearts = Math.max(1, this.hearts - 1);
    this.#enterFloor(this.floorIndex + 1, false);
  }

  /* ---------- internals ---------- */

  /** @param {number} count @returns {string[]} Next cards. Reshuffles when the deck runs out. */
  #draw(count) {
    if (this.#deck.length < count) {
      this.#deck = this.#rng.shuffle(itemDeck().filter((id) => !(ITEM_BY_ID[id].gear && this.has(id))));
    }
    return this.#deck.splice(0, count);
  }

  /** @returns {{traps:number, caches:number, gems:number, cleared:boolean}} The log entry of the current floor. */
  get #floorLog() { return this.stats.floors[this.stats.floors.length - 1]; }

  #enterFloor(index, risky) {
    this.floorIndex = index;
    this.stats.floors.push({ traps: 0, caches: 0, gems: 0, cleared: false });
    this.#config = this.practice ? { ...FLOORS[index], risky: false } : floorConfig(index, { depth: this.depth, risky, endless: this.endless });
    const found = Generator.find(this.#config, this.#rng.int(1e9));
    if (!found) throw new Error(`No board found for ${this.#config.name}.`);
    this.board = found.board;
    this.boardSeed = found.seed;
    this.open = new Uint8Array(this.board.size);
    /** Per tile: -1 unknown, else the KIND found there. */
    this.found = new Int8Array(this.board.size).fill(-1);
    this.marks = new Uint8Array(this.board.size);
    this.gemTaken = new Uint8Array(this.board.size);
    this.#floorState = Run.#freshFloorState();
    this.board.flood(this.board.start, this.open);
    const hidden = (kind) => [...this.open.keys()].filter((i) => !this.open[i] && this.board.kind(i) === kind);
    this.#gems = new Set(this.practice ? [] : this.#rng.shuffle(hidden(KIND.SAFE)).slice(0, RULES.gemsPerFloor));
    if (this.character.ability === 'reveal' && !this.practice) {
      const traps = hidden(KIND.TRAP);
      this.found[traps[this.#rng.int(traps.length)]] = KIND.TRAP;
    }
    this.phase = PHASE.FLOOR;
    this.message = '';
  }

  #isCovered(i) {
    return this.phase === PHASE.FLOOR && i >= 0 && i < this.board.size && !this.open[i] && this.found[i] < 0;
  }

  /** Open a safe tile, cascade, and pick up any gems the cascade uncovers. @returns {string} Message suffix. */
  #reveal(i) {
    this.board.flood(i, this.open);
    let gems = 0;
    for (const cell of this.#gems) {
      if (!this.open[cell] || this.gemTaken[cell]) continue;
      this.gemTaken[cell] = 1;
      gems++;
    }
    if (!gems) return '';
    this.stats.gems += gems;
    this.#floorLog.gems += gems;
    this.streak += gems * RULES.gemStreak;
    this.stats.bestMultiplier = Math.max(this.stats.bestMultiplier, this.multiplier);
    return `Gem. +${gems * RULES.gemStreak} streak.`;
  }

  #openSafe(i) {
    const gem = this.#reveal(i);
    this.message = [gem, this.cleared ? this.#clearText() : ''].filter(Boolean).join(' ');
    this.#onClear();
  }

  /** Once per floor, when the last safe tile opens. */
  #onClear() {
    if (!this.cleared || this.#floorState.clearDone) return;
    this.#floorState.clearDone = true;
    const allMarked = [...this.open.keys()].every((i) => this.board.kind(i) !== KIND.TRAP || this.marks[i] || this.found[i] === KIND.TRAP);
    if (allMarked) this.stats.fullyMarked++;
    const cell = this.board.cacheCells[0];
    if (!this.#gear('rod') || this.found[cell] >= 0) return;
    const text = this.message;
    this.found[cell] = KIND.CACHE;
    this.marks[cell] = 0;
    this.#collect();
    this.message = `${text} Dowsing Rod: ${this.message}`.trim();
  }

  #clearText() {
    if (this.practice) return this.floorIndex ? 'Floor clear. Hunt for caches or finish the practice.' : 'Floor clear. Hunt for caches or descend.';
    if (!this.isBossFloor) return 'Floor clear. Hunt for caches or descend.';
    return this.bossBeaten ? 'Boss floor clear. Finish the run.' : 'Floor clear. The Hoarder wants every cache found.';
  }

  /** @param {number} amount Coins gained. They also count toward the score. */
  #earn(amount) {
    this.coins += amount;
    this.stats.earned += amount;
  }

  /** @returns {string} Message suffix. Pays the Bounty Board when a trap is marked safely. */
  #bounty() {
    if (!this.#gear('bounty')) return '';
    this.#earn(2);
    return ' Bounty Board pays 2 coins.';
  }

  /**
   * Spend a single-use tool. Echo keeps it on a coin flip.
   * @param {string} id
   * @returns {string} Message suffix.
   */
  #spend(id) {
    if (this.#gear('echo') && this.#rng.next() < 0.5) return ` Echo keeps the ${ITEM_BY_ID[id].name}.`;
    this.#discard(id);
    return '';
  }

  /** Reveal a tile without risk. @returns {number} The KIND found. */
  #identify(i) {
    const kind = this.board.kind(i);
    this.marks[i] = 0;
    if (kind === KIND.SAFE) { this.#reveal(i); this.#onClear(); }
    else {
      this.found[i] = kind;
      if (kind === KIND.CACHE) this.#collect();
      else this.#bounty();
    }
    return kind;
  }

  /** @returns {{pay:number, notes:string[], crowbar:boolean}} What a cache pays now, and why. Spends nothing. */
  #cachePay() {
    let pay = this.cacheCoins;
    const notes = [];
    if (this.#gear('magnet')) { pay += 1; notes.push('Magnet'); }
    if (this.multiplier > 1) { pay *= this.multiplier; notes.push(`x${this.multiplier} streak`); }
    if (this.#config.risky) { pay *= 2; notes.push('rich vein'); }
    if (this.#gear('die')) { pay *= 2; notes.push('Loaded Die'); }
    const crowbar = this.#gear('crowbar');
    if (crowbar) { pay *= 2; notes.push('Crowbar'); }
    return { pay, notes, crowbar };
  }

  #collect() {
    const { pay, notes, crowbar } = this.#cachePay();
    const echo = crowbar ? this.#spend('crowbar') : '';
    this.#earn(pay);
    this.stats.caches++;
    this.#floorLog.caches++;
    this.stats.bestPay = Math.max(this.stats.bestPay, pay);
    this.message = `Cache. +${pay} coins${notes.length ? ` (${notes.join(', ')})` : ''}.${echo}`;
  }

  #hit() {
    const lost = this.streak;
    this.stats.trapsHit++;
    this.#floorLog.traps++;
    let streakNote = lost >= 3 ? ` Streak of ${lost} lost.` : '';
    if (this.#gear('steady') && !this.#floorState.steadyUsed && this.streak > 0) {
      this.#floorState.steadyUsed = true;
      streakNote = ' Steady Hands keeps your streak.';
    } else if (this.character.ability === 'halve') {
      this.streak = Math.floor(this.streak / 2);
      streakNote = lost >= 2 ? ` Streak halved to ${this.streak}.` : '';
    } else this.streak = 0;
    if (this.practice) { this.message = `Trap. On the practice floor it costs no heart.${streakNote}`; return; }
    if (this.itemsWork) {
      if (this.has('boots') && !this.#floorState.bootsUsed) {
        this.#floorState.bootsUsed = true;
        this.message = `Trap. Thick Boots take the hit.${streakNote}`;
        return;
      }
      if (this.has('shield')) {
        this.message = `Trap. Shield blocks it, no hearts lost.${this.#spend('shield')}${streakNote}`;
        return;
      }
      if (this.has('coin')) {
        const echo = this.#spend('coin');
        if (this.#rng.next() < 0.5) { this.message = `Trap. Lucky Coin lands heads, no hearts lost.${echo}${streakNote}`; return; }
      }
    }
    const damage = 1 + (this.bossRule('crusher') ? 1 : 0) + (this.#gear('die') ? 1 : 0);
    this.hearts -= damage;
    this.stats.heartsLost += damage;
    this.message = `Trap. -${damage} ${damage === 1 ? 'heart' : 'hearts'}.${streakNote}`;
    if (this.hearts <= 0 && this.itemsWork && this.has('wind')) {
      this.#discard('wind');
      this.hearts = 1;
      this.message += ' Second Wind returns you to 1 heart.';
    }
    if (this.hearts <= 0) this.#lose(`A trap on ${this.floor.name.toLowerCase()} ends the run.`);
  }

  #lose(text) {
    this.hearts = 0;
    this.phase = PHASE.LOST;
    this.message = text;
  }

  #discard(id) { this.items.splice(this.items.indexOf(id), 1); }

  /** @param {number[]} kinds @returns {string} Such as "2 safe, 1 trap". */
  static #tallyText(kinds) {
    const names = ['safe', 'trap', 'cache'];
    return names
      .map((name, kind) => [kinds.filter((k) => k === kind).length, name])
      .filter(([count]) => count)
      .map(([count, name]) => `${count} ${name}${count > 1 && name !== 'safe' ? 's' : ''}`)
      .join(', ');
  }
}

/**
 * @typedef {Object} Advice
 * @property {string} text What to do next and why.
 * @property {number[]} cells Tiles the advice points at.
 * @property {'mark'|'flip'|'probe'|'shop'|'leave'} action What the player does with those tiles.
 */

/** Plain-language advice for practice mode. Reads the true board, so it is for teaching only. */
class Coach {
  /** Practice goals in order. Each `done` reads the run. */
  static GOALS = Object.freeze([
    { text: 'Mark a buried tile', done: (run) => run.stats.marks > 0 },
    { text: 'Flip a safe tile', done: (run) => run.stats.flips > 0 },
    { text: 'Clear the first floor', done: (run) => run.stats.floorsCleared >= 1 || (run.floorIndex === 0 && run.cleared) },
    { text: 'Open a cache', done: (run) => run.stats.caches > 0 },
    { text: 'Buy an item in the shop', done: (run) => run.stats.bought > 0 },
    { text: 'Use an item at a dead end', done: (run) => run.stats.itemsUsed > 0 },
    { text: 'Clear the second floor', done: (run) => run.stats.floorsCleared >= 2 || (run.floorIndex === 1 && run.cleared) },
  ]);

  /** @param {Board} board @param {number} i @returns {string} Tile name such as "D2". */
  static tileName(board, i) { return `${'ABCDEFGHIJ'[i % board.cols]}${Math.floor(i / board.cols) + 1}`; }

  /** @param {Run} run @returns {Advice} */
  static advise(run) {
    if (run.phase === PHASE.SHOP) {
      return run.stats.bought
        ? { text: 'Tools are single-use. Gear lasts the whole run. Tap Go to floor 2.', cells: [], action: 'leave' }
        : { text: 'Caches pay coins, and coins buy items. Buy the Probe: it identifies one tile with no risk. You need it on the next floor.', cells: [], action: 'shop' };
    }
    const { board } = run;
    const name = (i) => Coach.tileName(board, i);
    const list = (cells) => cells.map(name).join(', ');

    const wrong = [...run.marks.keys()].filter((i) => run.marks[i] && !board.isBuried(i));
    if (wrong.length) {
      return { text: `Nothing proves ${name(wrong[0])} is buried. Switch to Mark and tap it to clear the mark.`, cells: [wrong[0]], action: 'mark' };
    }
    if (run.cleared) return Coach.#cacheAdvice(run);

    const known = Uint8Array.from(run.found, (kind, i) => (kind >= 0 || run.marks[i] ? 1 : 0));
    const solver = new Solver(board, run.open, known);
    const proof = solver.countingProof();
    if (proof) {
      const n = board.number(proof.clue);
      const k = proof.cells.length;
      const clue = `The ${n} at ${name(proof.clue)}`;
      if (proof.buried) {
        const fresh = board.neighbors(proof.clue).every((x) => !known[x]);
        const why = fresh
          ? `${clue} touches exactly ${k} covered ${k === 1 ? 'tile, so that tile is' : 'tiles, so each one is'} buried.`
          : `${clue} still needs ${k} buried ${k === 1 ? 'tile' : 'tiles'} and has exactly ${k} unmarked covered ${k === 1 ? 'tile' : 'tiles'} left.`;
        return { text: `${why} Switch to Mark and mark ${list(proof.cells)}.`, cells: proof.cells, action: 'mark' };
      }
      const have = n === 1 ? 'its buried tile' : n === 2 ? 'both of its buried tiles' : `all ${n} of its buried tiles`;
      return {
        text: `${clue} already has ${have} marked or found. Every other covered tile that touches it is safe. Switch to Flip and flip ${list(proof.cells)}.`,
        cells: proof.cells, action: 'flip',
      };
    }

    const step = solver.step();
    if (step && step.safe.length) {
      const cell = step.safe[0];
      return { text: `No single clue settles a tile here, but two clues together do. Compare the clues around ${name(cell)}: they leave no room for a buried tile there. Switch to Flip and flip ${name(cell)}.`, cells: [cell], action: 'flip' };
    }
    if (step) {
      const cell = step.buried[0];
      return { text: `No single clue settles a tile here, but two clues together do. Compare the clues around ${name(cell)}: one of them needs a buried tile exactly there. Switch to Mark and mark ${name(cell)}.`, cells: [cell], action: 'mark' };
    }

    const risk = solver.riskMap();
    let best = -1;
    let odds = 2;
    if (risk) risk.forEach((p, cell) => { if (p < odds) { odds = p; best = cell; } });
    if (best < 0) return { text: 'Flip any covered tile.', cells: [], action: 'flip' };
    if (run.canUse('probe')) {
      return { text: `This is a dead end: no clue proves any tile safe. Items exist for this moment. Tap Use on the Probe in your kit, then tap ${name(best)}.`, cells: [best], action: 'probe' };
    }
    return { text: `This is a dead end: no clue proves any tile safe, and you have no item for it. ${name(best)} is the least risky guess, at about ${Math.round(odds * 100)}% risk. Switch to Flip and flip it.`, cells: [best], action: 'flip' };
  }

  /** @param {Run} run @returns {Advice} */
  static #cacheAdvice(run) {
    const { board } = run;
    const { row, col } = board.cacheHint;
    const leave = run.floorIndex ? 'Finish practice' : 'Descend to the shop';
    if (run.cachesFound === board.cacheCount) return { text: `Both caches are found. Tap ${leave}.`, cells: [], action: 'leave' };
    const covered = (i) => !run.open[i] && run.found[i] < 0;
    const cells = [...run.open.keys()].filter((i) => covered(i) && (Math.floor(i / board.cols) === row || i % board.cols === col));
    const inRow = cells.filter((i) => Math.floor(i / board.cols) === row).length;
    const inCol = cells.filter((i) => i % board.cols === col).length;
    return {
      text: `The floor is clear, so every covered tile is a trap or a cache. Cache 1 is in row ${row + 1}, which has ${inRow} covered ${inRow === 1 ? 'tile' : 'tiles'}. `
        + `Cache 2 is in column ${'ABCDEFGHIJ'[col]}, which has ${inCol}. A lone tile is a sure cache. Otherwise a flip is a gamble. `
        + `In a run each trap costs a heart. Here it costs nothing, so flip a few, then tap ${leave}.`,
      cells, action: 'flip',
    };
  }
}

if (typeof module !== 'undefined') module.exports = { Run, Coach, PHASE, MODE, ITEM_BY_ID, ACTIVE_ITEMS };

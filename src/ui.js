/**
 * Deepsweep interface: sound, backdrop, effects and the page controller.
 * Depends on the engine, run and meta globals and on the `h` element helper.
 */

const REDUCED_MOTION = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Synthesized sound effects. No audio files. */
class Sfx {
  /** Each tone: [frequency Hz, start s, length s, wave]. */
  static TUNES = Object.freeze({
    tap: [[380, 0, 0.04, 'square']],
    flip: [[520, 0, 0.06, 'triangle']],
    open: [[440, 0, 0.05, 'triangle'], [660, 0.05, 0.08, 'triangle']],
    mark: [[300, 0, 0.04, 'square']],
    trap: [[160, 0, 0.12, 'sawtooth'], [90, 0.1, 0.26, 'sawtooth']],
    block: [[330, 0, 0.06, 'square'], [250, 0.06, 0.1, 'square']],
    cache: [[880, 0, 0.08, 'square'], [1320, 0.08, 0.2, 'square']],
    buy: [[660, 0, 0.07, 'triangle'], [880, 0.07, 0.12, 'triangle']],
    gem: [[1175, 0, 0.05, 'square'], [1568, 0.05, 0.12, 'square']],
    award: [[784, 0, 0.08, 'square'], [988, 0.08, 0.08, 'square'], [1175, 0.16, 0.08, 'square'], [1568, 0.24, 0.28, 'square']],
    mult: [[660, 0, 0.06, 'square'], [990, 0.06, 0.06, 'square'], [1320, 0.12, 0.16, 'square']],
    lost: [[220, 0, 0.1, 'sawtooth'], [147, 0.1, 0.22, 'sawtooth']],
    clear: [[523, 0, 0.09, 'square'], [659, 0.09, 0.09, 'square'], [784, 0.18, 0.2, 'square']],
    win: [[523, 0, 0.12, 'square'], [659, 0.12, 0.12, 'square'], [784, 0.24, 0.12, 'square'], [1047, 0.36, 0.36, 'square']],
    lose: [[392, 0, 0.16, 'sawtooth'], [311, 0.16, 0.16, 'sawtooth'], [233, 0.32, 0.42, 'sawtooth']],
  });

  #ctx = null;
  muted = false;

  /**
   * Play a named effect. Call from a click handler.
   * @param {string} name
   * @param {number} [semitones] Pitch shift, used to climb during a streak of safe flips.
   */
  play(name, semitones = 0) {
    const tune = Sfx.TUNES[name];
    if (this.muted || !tune) return;
    try {
      this.#ctx ||= new (window.AudioContext || window.webkitAudioContext)();
      const ctx = this.#ctx;
      if (ctx.state === 'suspended') ctx.resume();
      const now = ctx.currentTime;
      const shift = 2 ** (semitones / 12);
      for (const [freq, start, length, wave] of tune) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = wave;
        osc.frequency.value = freq * shift;
        gain.gain.setValueAtTime(0.0001, now + start);
        gain.gain.exponentialRampToValueAtTime(wave === 'triangle' ? 0.1 : 0.05, now + start + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + start + length);
        osc.connect(gain).connect(ctx.destination);
        osc.start(now + start);
        osc.stop(now + start + length + 0.02);
      }
    } catch (err) { /* sound is optional */ }
  }
}

/** Slow, posterized plasma drawn at low resolution behind the page. */
class Backdrop {
  static W = 48;
  static H = 84;
  static PALETTE = [[8, 15, 22], [12, 32, 42], [17, 51, 61], [30, 42, 82], [50, 36, 90]];

  #ctx; #image;

  /** @param {HTMLCanvasElement} canvas */
  constructor(canvas) {
    canvas.width = Backdrop.W;
    canvas.height = Backdrop.H;
    this.#ctx = canvas.getContext('2d');
    this.#image = this.#ctx.createImageData(Backdrop.W, Backdrop.H);
  }

  start() {
    this.#draw(0);
    if (REDUCED_MOTION) return;
    let last = 0;
    const loop = (ms) => {
      if (ms - last > 70 && !document.hidden) { last = ms; this.#draw(ms / 1000); }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  /** @param {number} t Seconds. */
  #draw(t) {
    const { W, H, PALETTE } = Backdrop;
    const data = this.#image.data;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const u = x / W - 0.5;
        const v = (y / H - 0.5) * (H / W);
        const swirl = Math.sin(Math.atan2(v, u) * 3 + Math.hypot(u, v) * 9 - t * 0.5);
        const drift = Math.sin(u * 7 + t * 0.35) + Math.sin(v * 6 - t * 0.27 + Math.sin(u * 4 + t * 0.2));
        const band = Math.min(PALETTE.length - 1, Math.floor(((swirl + drift + 3) / 6) * PALETTE.length));
        const p = (y * W + x) * 4;
        [data[p], data[p + 1], data[p + 2]] = PALETTE[band];
        data[p + 3] = 255;
      }
    }
    this.#ctx.putImageData(this.#image, 0, 0);
  }
}

/** Short-lived visual effects drawn on a fixed layer above the page. */
class Fx {
  static COLORS = { gold: '#f4b93e', red: '#ee5d44', blue: '#45a9e6', green: '#55c887' };

  #layer;

  /** @param {HTMLElement} layer */
  constructor(layer) { this.#layer = layer; }

  /** @param {Element|null} el @returns {{x:number, y:number}|null} Viewport center of an element. */
  static center(el) {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }

  #add(el, ms) {
    if (REDUCED_MOTION) return;
    this.#layer.append(el);
    setTimeout(() => el.remove(), ms);
  }

  /** Floating text that rises from a point. */
  text(str, at, color) {
    if (!at) return;
    const el = h('span', { class: `pop-text ${color}`, text: str });
    el.style.left = `${at.x}px`;
    el.style.top = `${at.y}px`;
    this.#add(el, 950);
  }

  /** Large text across the middle of the screen. */
  banner(str, color = 'gold') {
    const el = h('span', { class: 'banner', text: str });
    el.style.color = Fx.COLORS[color];
    this.#add(el, 1350);
  }

  /** Square bits that fly out from a point. */
  burst(at, color, count = 12) {
    if (!at) return;
    for (let k = 0; k < count; k++) {
      const angle = (Math.PI * 2 * k) / count + Math.random() * 0.5;
      const reach = 40 + Math.random() * 70;
      const bit = h('span', { class: 'bit' });
      bit.style.cssText = `left:${at.x - 4}px;top:${at.y - 4}px;background:${Fx.COLORS[color]};--dx:${Math.cos(angle) * reach}px;--dy:${Math.sin(angle) * reach}px`;
      this.#add(bit, 720);
    }
  }

  /** Coins that fall down the screen. */
  rain(count = 40) {
    for (let k = 0; k < count; k++) {
      const bit = h('span', { class: 'bit rain' });
      bit.style.cssText = `left:${Math.random() * 100}%;top:-12px;border-radius:50%;background:${Fx.COLORS.gold};animation-delay:${Math.random() * 0.9}s`;
      this.#add(bit, 2600);
    }
  }

  /** Remove every effect still on screen. */
  clear() { this.#layer.replaceChildren(); }

  /** Brief full-screen tint. */
  flash(color) {
    const el = h('span', { class: 'flash' });
    el.style.background = Fx.COLORS[color];
    this.#add(el, 380);
  }

  /** Count a number up or down in place. */
  countUp(el, from, to, ms = 450) {
    if (!el) return;
    if (REDUCED_MOTION || from === to) { el.textContent = String(to); return; }
    const begin = performance.now();
    const tick = (now) => {
      if (!el.isConnected) return;
      const k = Math.min(1, (now - begin) / ms);
      el.textContent = String(Math.round(from + (to - from) * k));
      if (k < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }
}

/** Cell order of the portrait sheet, by character or boss id. One 48 px portrait per cell, in one row. */
const PORTRAITS = Object.freeze(['sapper', 'gambler', 'surveyor', 'daredevil', 'ghost', 'banker', 'medic', 'saboteur', 'brute', 'crusher', 'hoarder', 'jammer', 'toll', 'rust']);
/** Cell order of the status strip. One 16 px icon per cell. */
const UI_ICONS = Object.freeze(['heart', 'lost', 'coin', 'trap', 'cache', 'gem', 'mark', 'streak']);
/** Icons per row of the item sheet. Cells follow the order of ITEMS. */
const ITEM_SHEET_COLS = 5;

/**
 * One cell of a sprite sheet, as a decorative element.
 * @param {'face'|'icon'|'ui'} sheet Portraits, item icons or status icons.
 * @param {string} id Character or boss id, item id, or a name from UI_ICONS.
 * @param {string} [extra] Extra classes, such as `big` for double size.
 * @returns {HTMLElement}
 */
function sprite(sheet, id, extra = '') {
  const index = sheet === 'face' ? PORTRAITS.indexOf(id) : sheet === 'icon' ? ITEMS.findIndex((item) => item.id === id) : UI_ICONS.indexOf(id);
  const cols = sheet === 'icon' ? ITEM_SHEET_COLS : Infinity;
  const el = h('span', { class: `spr ${sheet} ${extra}`.trim(), 'aria-hidden': 'true' });
  el.style.setProperty('--x', index % cols);
  el.style.setProperty('--y', cols === Infinity ? 0 : Math.floor(index / cols));
  return el;
}

/** Pages of the tutorial guide shown before the practice. Board tokens: c covered, c* pointed at, o open, digits, T trap, C cache. */
const GUIDE_PAGES = Object.freeze([
  {
    title: 'Read the numbers',
    lines: ['Every floor is a 6 by 6 grid of tiles. Some tiles have something buried under them.', 'A number counts the buried tiles among the tiles that touch it, corners included.', 'This 2 touches exactly two covered tiles, so both are buried.'],
    board: [['c*', 'c*', 'o'], ['o', '2', 'o'], ['o', 'o', 'o']],
  },
  {
    title: 'Trap or cache',
    lines: ['A buried tile is a trap or a cache. The numbers do not say which.', 'A trap costs 1 heart. A cache pays 3 coins.', 'Each floor names one row and one column that hold a cache. Flip there for coins, or play it safe.'],
    board: [['T', 'C']],
    art: [['ui', 'heart'], ['ui', 'trap'], ['ui', 'cache'], ['ui', 'coin']],
  },
  {
    title: 'Survive the run',
    lines: ['You have 3 hearts. A run is three floors, then a boss floor with its own rule.', 'A shop sits between floors. Coins buy single-use tools and lasting gear.', 'Deeper floors have dead ends, where no clue proves a tile safe. Guess, or spend an item.'],
    board: [['1', 'c', 'c'], ['1', '2', 'c*'], ['o', '1', 'c']],
    art: [['ui', 'heart'], ['ui', 'heart'], ['ui', 'heart'], ['icon', 'probe'], ['icon', 'shield'], ['icon', 'lantern']],
  },
  {
    title: 'Build a streak',
    lines: [`Every safe flip in a row adds to your streak. Every ${RULES.streakStep} raises your multiplier, up to x${RULES.multCap}.`, `A cache pays ${RULES.cacheCoins} coins times the multiplier. A trap resets the streak to zero.`, `A gem hides under one safe tile on each floor. It adds ${RULES.gemStreak} to your streak. Your score is every coin you earn.`],
    board: [['1', '2', 'C'], ['o', '1', 'c']],
    art: [['ui', 'streak'], ['ui', 'gem'], ['ui', 'coin']],
  },
]);

/** Page controller. One click listener routes every action. */
class GameUI {
  static COLS = 'ABCDEFGHIJ';

  /** @type {Run|null} */ #run = null;
  #profile = new Profile();
  #sfx = new Sfx();
  /** @type {Fx} */ #fx;
  #el = {};
  /** Screen shown outside a run: title, guide or achievements. */ #screen = 'title';
  #guidePage = 0;
  #markMode = false;
  /** Item waiting for a target tile, or null. */ #armed = null;
  #confirmAbandon = false;
  /** Safe flips in a row, for the climbing flip sound. */ #pitch = 0;
  /** What the run that just ended paid. @type {RunRewards|null} */ #rewards = null;
  /** Text of the daily result, once the player asks to share it. */ #shareText = '';
  #shareNote = '';
  /** Changes made by the last action, used once by the next render. */
  #change = GameUI.#noChange();

  static #noChange() { return { fresh: new Set(), found: new Set(), gems: new Set(), origin: -1, events: [], coinsFrom: null, newView: false, stepped: false }; }

  /** @param {Document} doc */
  constructor(doc) {
    ['app', 'logo', 'hud', 'track', 'boss', 'stage', 'kit', 'kitPanel', 'restart', 'best', 'sound', 'bg', 'fx'].forEach((id) => { this.#el[id] = doc.getElementById(id); });
    this.#sfx.muted = Boolean(this.#profile.get('muted'));
    this.#fx = new Fx(this.#el.fx);
    this.#el.logo.replaceChildren(...[...this.#el.logo.textContent].map((letter, k) => {
      const span = h('span', { text: letter });
      span.style.setProperty('--k', k);
      return span;
    }));
    this.#el.logo.setAttribute('aria-label', 'Deepsweep');
  }

  /** The current run, or null outside a run. */
  get run() { return this.#run; }
  /** The saved profile. */
  get profile() { return this.#profile; }

  init() {
    new Backdrop(this.#el.bg).start();
    this.#el.app.addEventListener('click', (e) => {
      const target = e.target.closest('[data-action]');
      if (target && !target.disabled) this.#dispatch(target.dataset.action, target.dataset);
    });
    this.#render();
  }

  /** @param {'run'|'daily'|'endless'|'practice'} kind */
  #startRun(kind) {
    const p = this.#profile;
    const seed = Math.floor(Math.random() * 2 ** 32);
    if (kind === 'practice') this.#run = new Run(seed, { practice: true });
    else if (kind === 'daily') this.#run = new Run(dailyRun().seed, { character: CHARACTERS[0], mode: MODE.DAILY });
    else if (kind === 'endless') this.#run = new Run(seed, { character: p.character, mode: MODE.ENDLESS });
    else this.#run = new Run(seed, { character: p.character, depth: p.depth, mode: MODE.RUN });
    this.#markMode = false;
    this.#armed = null;
    this.#pitch = 0;
    this.#rewards = null;
    this.#shareText = '';
    this.#shareNote = '';
  }

  /**
   * @param {string} action
   * @param {DOMStringMap} data
   */
  #dispatch(action, data) {
    const run = this.#run;
    const index = Number(data.i);
    const before = run && {
      board: run.board, open: Uint8Array.from(run.open), found: Int8Array.from(run.found), gemTaken: Uint8Array.from(run.gemTaken),
      hearts: run.hearts, coins: run.coins, phase: run.phase, cleared: run.cleared, marks: run.marks.join(''),
      streak: run.streak, multiplier: run.multiplier, goals: run.practice ? Coach.GOALS.filter((g) => g.done(run)).length : 0,
    };
    if (action !== 'restart') this.#confirmAbandon = false;
    /** Achievements earned outside a run by this action. */
    let earned = [];

    switch (action) {
      case 'sound':
        this.#sfx.muted = !this.#sfx.muted;
        this.#profile.set('muted', this.#sfx.muted);
        break;
      case 'character': earned = this.#pickCharacter(data.id); break;
      case 'depth': this.#profile.set('depth', Math.max(0, Math.min(this.#profile.get('depthMax'), this.#profile.depth + Number(data.step)))); break;
      case 'start': this.#startRun(data.kind); break;
      case 'screen': this.#screen = data.to; this.#guidePage = 0; break;
      case 'guide': this.#guidePage = Math.max(0, this.#guidePage + Number(data.step)); break;
      case 'title': this.#run = null; this.#screen = 'title'; break;
      case 'restart':
        if (this.#confirmAbandon) { this.#run = null; this.#screen = 'title'; this.#confirmAbandon = false; } else this.#confirmAbandon = true;
        break;
      case 'share': this.#share(); break;
      case 'cell': this.#tapCell(index); break;
      case 'mode': this.#markMode = data.mode === 'mark'; this.#armed = null; break;
      case 'use': this.#useItem(data.id); break;
      case 'descend': run.descend(); break;
      case 'buy': run.buy(index); break;
      case 'patch': run.patch(); break;
      case 'reroll': run.reroll(); break;
      case 'leave': run.leaveShop(); break;
      case 'path': run.choosePath(data.risky === '1'); break;
      case 'toll': run.payToll(data.pay === 'coins'); break;
      case 'sabotage': run.sabotage(index); break;
      case 'enter': run.enterBoss(); break;
      default: return;
    }

    if (before && this.#run === run) this.#afterAction(before, action === 'cell' ? index : -1);
    else {
      this.#change.newView = true;
      this.#fx.clear();
      earned.forEach((a) => this.#change.events.push({ type: 'achievement', name: a.name }));
      if (action !== 'sound') this.#sfx.play(earned.length ? 'award' : 'tap');
    }
    const events = this.#change.events;
    this.#render();
    this.#playEvents(events);
  }

  /**
   * Select an owned character, or buy one with stars.
   * @param {string} id
   * @returns {Object[]} Achievements a purchase earned.
   */
  #pickCharacter(id) {
    const character = CHARACTERS.find((c) => c.id === id);
    if (this.#profile.owns(character)) { this.#profile.set('character', id); return []; }
    return this.#profile.buy(character);
  }

  /** Put the daily result on the page and try the clipboard. */
  #share() {
    const run = this.#run;
    const result = run.phase === PHASE.WON ? 'Won' : `Lost on ${run.floor.name.toLowerCase()}`;
    this.#shareText = `Deepsweep daily ${dailyRun().key}\n${result} as ${run.character.name}\nScore ${run.score}, best multiplier x${run.stats.bestMultiplier}, ${run.stats.caches} caches`;
    this.#shareNote = 'Select the text to copy it.';
    try {
      navigator.clipboard.writeText(this.#shareText).then(() => {
        this.#shareNote = 'Copied. Paste it anywhere.';
        if (this.#run === run) this.#render();
      }, () => {});
    } catch (err) { /* the text stays on the page to copy by hand */ }
  }

  /**
   * Work out what the action changed: sound, effects and profile updates.
   * @param {Object} before Run snapshot taken before the action.
   * @param {number} origin Tapped tile, or -1.
   */
  #afterAction(before, origin) {
    const run = this.#run;
    const change = this.#change;
    const sameBoard = run.board === before.board;
    if (sameBoard) {
      for (let i = 0; i < run.board.size; i++) {
        if (run.open[i] && !before.open[i]) change.fresh.add(i);
        if (run.found[i] >= 0 && before.found[i] < 0) change.found.add(i);
        if (run.gemTaken[i] && !before.gemTaken[i]) change.gems.add(i);
      }
    }
    change.origin = origin;
    change.newView = run.phase !== before.phase || !sameBoard;
    if (run.coins !== before.coins) change.coinsFrom = before.coins;

    const ended = run.phase !== before.phase && run.over;
    let awards = [];
    if (ended) {
      this.#rewards = this.#profile.record(run);
      awards = this.#rewards.achievements;
    }
    if (run.phase === PHASE.PRACTICE_DONE && before.phase !== PHASE.PRACTICE_DONE) awards = this.#profile.finishTutorial();

    const lostHearts = before.hearts - run.hearts;
    const caches = [...change.found].filter((i) => run.found[i] === KIND.CACHE);
    const traps = [...change.found].filter((i) => run.found[i] === KIND.TRAP);
    const justCleared = run.phase === PHASE.FLOOR && sameBoard && run.cleared && !before.cleared;
    const events = change.events;
    caches.forEach((cell) => events.push({ type: 'cache', cell, pay: Math.round((run.coins - before.coins) / caches.length) }));
    change.gems.forEach((cell) => events.push({ type: 'gem', cell }));
    if (traps.length && lostHearts > 0) events.push({ type: 'trap', cell: traps[0], damage: lostHearts });
    else if (traps.length && origin >= 0 && /^Trap/.test(run.message)) events.push({ type: 'block', cell: traps[0] });
    else if (lostHearts > 0) events.push({ type: 'hurt' });
    const multUp = run.multiplier > before.multiplier;
    const streakLost = before.streak >= 3 && run.streak < before.streak;
    if (multUp) events.push({ type: 'mult', value: run.multiplier });
    if (streakLost) events.push({ type: 'streakLost', text: run.streak ? 'STREAK HALVED' : 'STREAK LOST' });
    if (justCleared) events.push({ type: 'clear' });
    if (ended) events.push({ type: run.phase === PHASE.WON ? 'win' : 'lose' });
    if (run.practice && Coach.GOALS.filter((g) => g.done(run)).length > before.goals) events.push({ type: 'goal' });
    awards.forEach((a) => events.push({ type: 'achievement', name: a.name }));

    let sound = 'tap';
    if (ended) sound = run.phase === PHASE.WON ? 'win' : 'lose';
    else if (lostHearts > 0) sound = 'trap';
    else if (streakLost) sound = 'lost';
    else if (events.some((e) => e.type === 'block')) sound = 'block';
    else if (run.coins > before.coins) sound = 'cache';
    else if (run.coins < before.coins) sound = 'buy';
    else if (awards.length) sound = 'award';
    else if (justCleared) sound = 'clear';
    else if (multUp) sound = 'mult';
    else if (change.gems.size) sound = 'gem';
    else if (change.fresh.size > 1) sound = 'open';
    else if (change.fresh.size === 1) sound = 'flip';
    else if (run.marks.join('') !== before.marks) sound = 'mark';

    const safeFlip = sound === 'flip' || sound === 'open';
    change.stepped = run.streak > before.streak;
    this.#pitch = safeFlip ? this.#pitch + 1 : (sound === 'tap' || sound === 'mark') ? this.#pitch : 0;
    if (!sameBoard) this.#pitch = 0;
    this.#sfx.play(sound, safeFlip ? Math.min(this.#pitch - 1, 14) : 0);
  }

  /** Run the effects for the last action, once the new view is on the page. @param {Object[]} events */
  #playEvents(events) {
    const fx = this.#fx;
    const stage = this.#el.stage;
    const at = (cell) => Fx.center(stage.querySelector(`.cell[data-i="${cell}"]`));
    const meter = () => Fx.center(stage.querySelector('.meter'));
    const shake = () => {
      stage.classList.add('shake');
      setTimeout(() => stage.classList.remove('shake'), 400);
    };
    let awards = 0;
    for (const event of events) {
      switch (event.type) {
        case 'cache': fx.text(`+${event.pay}`, at(event.cell), 'gold'); fx.burst(at(event.cell), 'gold', 14); break;
        case 'gem': fx.text(`GEM +${RULES.gemStreak}`, at(event.cell), 'blue'); fx.burst(at(event.cell), 'blue', 10); break;
        case 'trap': fx.text(`-${event.damage}`, at(event.cell), 'red'); fx.burst(at(event.cell), 'red', 16); fx.flash('red'); shake(); break;
        case 'block': fx.text('BLOCKED', at(event.cell), 'blue'); fx.burst(at(event.cell), 'blue', 10); break;
        case 'hurt': fx.flash('red'); shake(); break;
        case 'clear': fx.banner('FLOOR CLEAR', 'green'); break;
        case 'mult': fx.text(`x${event.value} MULTIPLIER`, meter(), 'gold'); fx.burst(Fx.center(stage.querySelector('.meter .mult')), 'gold', 10); break;
        case 'streakLost': fx.text(event.text, meter(), 'red'); break;
        case 'goal': fx.text('STEP DONE', Fx.center(stage.querySelector('.chips.goals')), 'green'); break;
        case 'win': fx.banner('RUN WON'); fx.rain(); break;
        case 'lose': fx.banner('RUN OVER', 'red'); fx.flash('red'); shake(); break;
        case 'achievement': {
          const y = 90 + 44 * awards++;
          setTimeout(() => fx.text(`ACHIEVEMENT: ${event.name.toUpperCase()}`, { x: window.innerWidth / 2, y }, 'gold'), 500 + 350 * awards);
          break;
        }
        default: break;
      }
    }
  }

  /** @param {number} i */
  #tapCell(i) {
    const run = this.#run;
    if (this.#armed) {
      if (run.useItem(this.#armed, i)) this.#armed = null;
      return;
    }
    if (this.#markMode) run.toggleMark(i);
    else if (!run.marks[i]) run.flip(i);
  }

  /** @param {string} id */
  #useItem(id) {
    if (id === 'medkit') { this.#run.useItem(id); return; }
    this.#armed = this.#armed === id ? null : id;
  }

  /* ---------- render ---------- */

  #render() {
    const run = this.#run;
    const el = this.#el;
    const inRun = Boolean(run);
    const playing = inRun && !run.practice;
    const change = this.#change;
    el.sound.textContent = this.#sfx.muted ? 'Sound off' : 'Sound on';
    el.sound.setAttribute('aria-pressed', String(!this.#sfx.muted));
    el.hud.hidden = !inRun;
    el.track.hidden = !playing || run.endless;
    el.boss.hidden = !playing || !run.bosses.length;
    el.kitPanel.hidden = !inRun || (run.phase === PHASE.BOSS_GATE && run.discardsLeft > 0) || run.phase === PHASE.PRACTICE_DONE;
    el.restart.hidden = !inRun || run.over || run.phase === PHASE.PRACTICE_DONE;
    el.restart.textContent = this.#confirmAbandon ? 'Tap again to confirm' : run && run.practice ? 'Leave the tutorial' : 'Abandon run';
    const best = this.#profile.get('best');
    el.best.textContent = [best ? `Best ${best}` : '', playing ? `Run ${run.seed}` : ''].filter(Boolean).join(' · ');

    let view;
    if (!inRun) view = { guide: () => this.#guideView(), achievements: () => this.#achievementsView() }[this.#screen]?.() || this.#titleView();
    else {
      this.#renderHud();
      this.#renderKit();
      if (playing) { this.#renderTrack(); this.#renderBoss(); }
      view = {
        [PHASE.FLOOR]: () => this.#floorView(),
        [PHASE.SHOP]: () => this.#shopView(),
        [PHASE.PATH]: () => this.#pathView(),
        [PHASE.BOSS_GATE]: () => this.#gateView(),
        [PHASE.WON]: () => this.#endView(true),
        [PHASE.LOST]: () => this.#endView(false),
        [PHASE.PRACTICE_DONE]: () => this.#practiceDoneView(),
      }[run.phase]();
    }
    const tone = inRun && run.over ? ` end ${run.phase === PHASE.WON ? 'win' : 'lose'}` : '';
    el.stage.className = `panel${tone}${change.newView ? ' deal' : ''}`;
    const nodes = view.filter(Boolean);
    nodes.forEach((node, k) => node.style.setProperty('--k', k));
    el.stage.replaceChildren(...nodes);
    this.#change = GameUI.#noChange();
  }

  /**
   * Small picture board for the guide.
   * @param {string[][]} rows Tokens: c covered, c* pointed at, o open, a digit, T trap, C cache.
   * @returns {HTMLElement}
   */
  static #miniBoard(rows) {
    const grid = h('div', { class: 'board mini', 'aria-hidden': 'true' });
    grid.style.setProperty('--n', rows[0].length);
    rows.flat().forEach((token) => {
      const kind = { c: 'cell', 'c*': 'cell coach', o: 'cell open', T: 'cell trap', C: 'cell cache' }[token];
      grid.append(kind ? h('span', { class: kind }) : h('span', { class: `cell open n${Math.min(Number(token), 4)}`, text: token }));
    });
    return grid;
  }

  /** @returns {HTMLElement[]} */
  #guideView() {
    const page = GUIDE_PAGES[this.#guidePage];
    const last = this.#guidePage === GUIDE_PAGES.length - 1;
    return [
      h('h2', { text: `Guide · ${this.#guidePage + 1} of ${GUIDE_PAGES.length}` }),
      h('div', { class: 'who' }, sprite('face', 'sapper'), h('h3', { text: page.title })),
      GameUI.#miniBoard(page.board),
      page.art ? h('div', { class: 'art-row' }, ...page.art.map(([sheet, id]) => sprite(sheet, id, sheet === 'ui' ? 'big' : ''))) : null,
      ...page.lines.map((text) => h('p', { text })),
      h('div', { class: 'dots' }, ...GUIDE_PAGES.map((_, k) => h('i', { class: k === this.#guidePage ? 'on' : '' }))),
      h('div', { class: 'row' },
        this.#guidePage > 0 ? h('button', { type: 'button', class: 'quiet', 'data-action': 'guide', 'data-step': '-1', text: 'Back' }) : h('button', { type: 'button', class: 'quiet', 'data-action': 'title', text: 'Close' }),
        last ? h('button', { type: 'button', class: 'go', 'data-action': 'start', 'data-kind': 'practice', text: 'Start the practice' }) : h('button', { type: 'button', class: 'primary', 'data-action': 'guide', 'data-step': '1', text: 'Next' })),
    ];
  }

  /** @returns {HTMLElement[]} */
  #achievementsView() {
    const p = this.#profile;
    const rows = ACHIEVEMENTS.map((a) => {
      const done = p.hasAchievement(a.id);
      return h('div', { class: `ach${done ? ' done' : ''}` },
        h('span', { class: 'name', text: a.name }), h('span', { class: 'state', text: done ? 'Done' : 'Open' }), h('span', { class: 'text', text: a.text }));
    });
    return [
      h('h2', { text: `Achievements · ${p.get('achievements').length} of ${ACHIEVEMENTS.length}` }),
      h('div', { class: 'kit' }, ...rows),
      h('button', { type: 'button', class: 'quiet wide', 'data-action': 'title', text: 'Back' }),
    ];
  }

  /** @param {CharacterDef} character @returns {HTMLElement} Character card for the title screen. */
  #characterCard(character) {
    const p = this.#profile;
    const { unlock } = character;
    const owned = p.owns(character);
    const canBuy = !owned && unlock.type === 'buy';
    let lock = null;
    if (canBuy) lock = h('span', { class: 'lock', text: `Buy for ${unlock.cost} stars. You have ${p.get('stars')}.` });
    else if (!owned) lock = h('span', { class: 'lock', text: `Locked. ${unlock.text}.` });
    return h('button', {
      type: 'button', class: `kitpick${canBuy ? ' buy' : ''}`, 'data-action': 'character', 'data-id': character.id,
      disabled: !owned && !(canBuy && p.get('stars') >= unlock.cost), 'aria-pressed': String(owned && character === p.character),
    }, sprite('face', character.id, owned ? '' : 'locked'), h('span', { class: 'name', text: character.name }), h('span', { class: 'text', text: character.text }), lock);
  }

  /** @returns {HTMLElement[]} */
  #titleView() {
    const p = this.#profile;
    const isNew = !p.get('tutorial');
    const today = dailyRun().key;
    const daily = p.get('daily');
    const depthMax = p.get('depthMax');
    const stats = [`Runs ${p.get('runs')}`, `Wins ${p.get('wins')}`, `Best ${p.get('best')}`, `Bosses ${p.get('bosses').length}/${BOSSES.length}`, `Endless best ${p.get('endlessBest')}`]
      .map((text) => h('span', { class: 'chip', text }));
    const start = h('button', { type: 'button', class: `wide ${isNew ? 'quiet' : 'go'}`, 'data-action': 'start', 'data-kind': 'run', text: `Start a run as ${p.character.name}${p.depth ? `, depth ${p.depth}` : ''}` });
    const learn = h('button', { type: 'button', class: `wide ${isNew ? 'go' : 'quiet'}`, 'data-action': 'screen', 'data-to': 'guide', text: isNew ? 'New here? Open the guide' : 'Guide and practice' });
    const depthRules = DEPTHS.slice(1, p.depth + 1);
    return [
      h('p', { text: 'Sweep three floors of buried traps and caches, gear up in the shop, and beat the boss floor.' }),
      ...(isNew ? [learn, start] : [start, learn]),
      h('button', { type: 'button', class: 'wide primary', 'data-action': 'start', 'data-kind': 'daily', text: daily && daily.key === today ? `Daily run · best today ${daily.score}` : `Daily run · ${today}` }),
      h('button', { type: 'button', class: 'wide', 'data-action': 'start', 'data-kind': 'endless', text: `Endless as ${p.character.name}` }),
      h('button', { type: 'button', class: 'wide quiet', 'data-action': 'screen', 'data-to': 'achievements', text: `Achievements · ${p.get('achievements').length} of ${ACHIEVEMENTS.length}` }),
      h('h2', {}, 'Character · ', h('span', { class: 'stars', text: `${p.get('stars')} stars` })),
      h('div', { class: 'kit' }, ...CHARACTERS.map((c) => this.#characterCard(c))),
      h('h2', { text: 'Depth' }),
      depthMax ? h('div', { class: 'depth' },
        h('button', { type: 'button', class: 'quiet', 'data-action': 'depth', 'data-step': '-1', disabled: p.depth <= 0, 'aria-label': 'Lower depth', text: '-' }),
        h('span', { class: 'label', text: `Depth ${p.depth} of ${depthMax}` }),
        h('button', { type: 'button', class: 'quiet', 'data-action': 'depth', 'data-step': '1', disabled: p.depth >= depthMax, 'aria-label': 'Raise depth', text: '+' }))
        : h('p', { class: 'empty', text: 'Win a run to unlock depth 1. Each depth adds a rule and raises your score.' }),
      depthMax ? h('p', { class: 'empty', text: p.depth ? `${depthRules.join(' ')} Score +${Math.round(RULES.depthBonus * p.depth * 100)}%.` : 'Standard rules. Win at your highest depth to unlock the next.' }) : null,
      h('h2', { text: 'Your record' }),
      h('div', { class: 'chips' }, ...stats),
    ];
  }

  #renderHud() {
    const run = this.#run;
    const { hearts, coins } = run;
    const change = this.#change;
    const hurt = change.events.some((e) => e.type === 'trap' || e.type === 'hurt');
    const pips = run.practice ? [] : Array.from({ length: run.maxHearts }, (_, k) => sprite('ui', k < hearts ? 'heart' : 'lost'));
    const amount = h('span', { text: String(coins) });
    this.#el.hud.replaceChildren(
      h('span', { class: `hearts${hurt ? ' bump' : ''}`, 'aria-label': `${hearts} of ${run.maxHearts} hearts` }, ...pips),
      h('span', { class: `coins${change.coinsFrom !== null ? ' bump' : ''}`, 'aria-label': `${coins} coins` }, sprite('ui', 'coin'), amount),
    );
    if (change.coinsFrom !== null) this.#fx.countUp(amount, change.coinsFrom, coins);
  }

  #renderTrack() {
    const run = this.#run;
    const at = run.phase === PHASE.BOSS_GATE || (run.phase === PHASE.PATH) ? run.floorIndex + 1 : run.floorIndex;
    this.#el.track.replaceChildren(...FLOORS.map((floor, k) => {
      const state = run.phase === PHASE.WON || k < at ? 'done' : k === at ? 'now' : '';
      return h('span', { class: state, text: floor.boss ? 'Boss' : floor.name });
    }));
  }

  #renderBoss() {
    const run = this.#run;
    const loud = this.#change.newView && (run.phase === PHASE.BOSS_GATE || (run.phase === PHASE.FLOOR && (run.floorIndex === 0 || run.isBossFloor)));
    this.#el.boss.className = `panel boss${loud ? ' slam' : ''}`;
    const immune = run.character.ability === 'ignoreBoss';
    this.#el.boss.replaceChildren(
      h('span', { class: 'tag', text: run.bosses.length > 1 ? 'Bosses of this run' : 'Boss of this run' }),
      ...run.bosses.map((boss) => h('div', { class: 'who' }, sprite('face', boss.id, 'big'), h('div', {}, h('h3', { text: boss.name }), h('p', { text: boss.text })))),
      ...(immune ? [h('p', { class: 'empty', text: `${run.character.name} ignores boss rules.` })] : []),
    );
  }

  /** @returns {HTMLElement} Streak meter: multiplier, progress to the next one. */
  #meter() {
    const run = this.#run;
    const step = run.streakStep;
    const capped = run.multiplier >= run.topMultiplier;
    const filled = capped ? step : run.streak % step;
    const pips = Array.from({ length: step }, (_, k) => h('i', { class: k < filled ? `on${this.#change.stepped && k === filled - 1 ? ' new' : ''}` : '' }));
    const note = capped ? 'Top multiplier' : `${step - filled} to x${run.multiplier + 1}`;
    return h('div', { class: `meter${run.multiplier > 1 ? ' hot' : ''}`, 'aria-label': `Streak ${run.streak}, cache multiplier ${run.multiplier}` },
      sprite('ui', 'streak'), h('span', { class: 'mult', text: `x${run.multiplier}` }), h('span', { class: 'pips' }, ...pips), h('span', { class: 'fine', text: note }));
  }

  /** @returns {HTMLElement|null} Practice step strip, or null in a real run. */
  #goalStrip() {
    const run = this.#run;
    if (!run.practice) return null;
    const done = Coach.GOALS.map((goal) => goal.done(run));
    const current = done.indexOf(false);
    const label = current < 0 ? 'All steps done' : `Step ${current + 1} of ${Coach.GOALS.length}: ${Coach.GOALS[current].text}`;
    return h('div', { class: 'kit' },
      h('p', { class: 'hint' }, h('b', { text: label })),
      h('div', { class: 'chips goals' }, ...done.map((ok, k) => h('span', { class: `chip${ok ? ' done' : k === current ? ' now' : ''}`, text: ok ? `${k + 1} done` : String(k + 1) }))));
  }

  /** @returns {HTMLElement|null} */
  #coachBox(advice) {
    return advice ? h('div', { class: 'coach-box' }, h('b', { text: 'Coach' }), advice.text) : null;
  }

  /** @returns {string} Heading for the current floor. */
  #floorTitle() {
    const run = this.#run;
    if (run.practice) return `Practice · floor ${run.floorIndex + 1} of ${Run.PRACTICE_FLOORS}`;
    const vein = run.floor.risky ? ' · rich vein' : '';
    if (run.endless) return `Endless · ${run.floor.name.toLowerCase()}${vein}`;
    return `${run.mode === MODE.DAILY ? 'Daily · ' : ''}${run.floor.name}${vein}`;
  }

  /** @returns {HTMLElement[]} */
  #floorView() {
    const run = this.#run;
    const { board } = run;
    const { row, col } = board.cacheHint;
    const armed = this.#armed;
    const advice = run.practice ? Coach.advise(run) : null;
    const coached = new Set(advice ? advice.cells : []);

    const chips = [
      `Traps ${run.trapsFound}/${board.trapCount}`,
      `Caches ${run.cachesFound}/${board.cacheCount}`,
      run.floor.stalls ? `Dead ends ${run.floor.stalls}` : 'No dead ends',
    ].map((text) => h('span', { class: 'chip', text }));
    if (!run.itemsWork) chips.push(h('span', { class: 'chip warn', text: 'Items jammed' }));

    const grid = h('div', { class: 'board', role: 'grid', 'aria-label': `${run.floor.name} board` });
    grid.style.setProperty('--n', board.cols);
    grid.append(h('span', { class: 'axis' }));
    for (let c = 0; c < board.cols; c++) grid.append(h('span', { class: `axis${c === col ? ' hot' : ''}`, text: GameUI.COLS[c] }));
    for (let i = 0; i < board.size; i++) {
      const r = Math.floor(i / board.cols);
      if (i % board.cols === 0) grid.append(h('span', { class: `axis${r === row ? ' hot' : ''}`, text: String(r + 1) }));
      grid.append(this.#cell(i, armed, coached.has(i)));
    }

    let prompt = run.message;
    if (armed === 'sonar') prompt = 'Sonar: tap an open tile that touches covered tiles.';
    else if (armed) prompt = `${ITEM_BY_ID[armed].name}: tap a covered tile.`;
    const tone = /^Trap.*-\d/.test(prompt) ? 'bad' : /^Cache|^Gem|clear/.test(prompt) ? 'good' : '';
    const canLeave = run.isBossFloor && !run.practice ? run.bossBeaten : run.cleared;
    const lastPractice = run.practice && run.floorIndex >= Run.PRACTICE_FLOORS - 1;
    const leaveText = lastPractice ? 'Finish practice' : run.isBossFloor && !run.practice ? 'Finish the run' : 'Descend to the shop';
    const extra = run.floor.risky ? ' Caches pay double here.' : '';

    return [
      h('h2', { text: this.#floorTitle() }),
      this.#goalStrip(),
      this.#coachBox(advice),
      h('div', { class: 'chips' }, ...chips),
      this.#meter(),
      h('p', { class: 'hint' }, 'Cache 1 is in ', h('b', { text: `row ${row + 1}` }), '. Cache 2 is in ', h('b', { text: `column ${GameUI.COLS[col]}` }), `.${extra}`),
      grid,
      h('p', { class: `message ${tone}`.trim(), text: prompt || `${board.safeCount - run.openCount} safe tiles left.` }),
      h('div', { class: 'row' },
        h('div', { class: 'seg', role: 'group', 'aria-label': 'Tap action' },
          h('button', { type: 'button', 'data-action': 'mode', 'data-mode': 'flip', 'aria-pressed': String(!this.#markMode), text: 'Flip' }),
          h('button', { type: 'button', 'data-action': 'mode', 'data-mode': 'mark', 'aria-pressed': String(this.#markMode), text: 'Mark' })),
        h('button', { type: 'button', class: 'go', 'data-action': 'descend', disabled: !canLeave, text: leaveText })),
    ];
  }

  /**
   * @param {number} i
   * @param {string|null} armed
   * @param {boolean} coached
   * @returns {HTMLElement}
   */
  #cell(i, armed, coached) {
    const run = this.#run;
    const { board } = run;
    const change = this.#change;
    const classes = ['cell'];
    let label = 'covered';
    let text = '';
    if (run.open[i]) {
      const n = board.number(i);
      classes.push('open');
      if (n) { text = String(n); classes.push(`n${Math.min(n, 4)}`); }
      label = n ? `clue ${n}` : 'blank';
      if (run.hasGem(i)) { classes.push('gem'); label += ', gem found'; }
      if (armed === 'sonar' && n) classes.push('target');
    } else if (run.found[i] === KIND.TRAP) { classes.push('trap'); label = 'trap'; }
    else if (run.found[i] === KIND.CACHE) { classes.push('cache'); label = 'cache'; }
    else {
      if (run.marks[i]) { classes.push('mark'); label = 'marked'; }
      if (armed && armed !== 'sonar') classes.push('target');
    }
    if (i === board.start) classes.push('start');
    if (coached) classes.push('coach');
    if (change.fresh.has(i)) classes.push('pop');
    if (change.found.has(i)) classes.push('found');
    const where = `Row ${Math.floor(i / board.cols) + 1}, column ${GameUI.COLS[i % board.cols]}`;
    const cell = h('button', { type: 'button', class: classes.join(' '), 'data-action': 'cell', 'data-i': String(i), 'aria-label': `${where}, ${label}`, text });
    if (change.fresh.has(i) && change.origin >= 0) {
      const o = change.origin;
      const distance = Math.max(Math.abs(Math.floor(i / board.cols) - Math.floor(o / board.cols)), Math.abs((i % board.cols) - (o % board.cols)));
      cell.style.setProperty('--d', distance);
    }
    return cell;
  }

  /**
   * @param {string} id Item id.
   * @param {HTMLElement} control Button or label on the right of the card.
   * @param {number} k Position, for staggered motion.
   * @param {string} [extra] Extra class.
   * @returns {HTMLElement}
   */
  static #itemCard(id, control, k, extra = '') {
    const item = ITEM_BY_ID[id];
    const card = h('div', { class: `item ${extra}`.trim() },
      sprite('icon', id),
      h('span', {}, h('span', { class: 'name', text: item.name }), h('span', { class: `kind${item.gear ? ' gear' : ''}`, text: item.gear ? 'Gear' : 'Tool' })),
      control,
      h('span', { class: 'text', text: item.text.replace(/^Gear\. /, '') }));
    card.style.setProperty('--k', k);
    return card;
  }

  /** @returns {HTMLElement[]} */
  #shopView() {
    const run = this.#run;
    const nextIsBoss = !run.practice && !run.endless && FLOORS[run.floorIndex + 1].boss;
    const leaveText = run.practice ? 'Go to floor 2' : nextIsBoss ? 'Go to the boss' : 'Go to the fork';
    const cards = run.shop.map((id, slot) => {
      const owned = ITEM_BY_ID[id].gear && run.has(id);
      return GameUI.#itemCard(id,
        h('button', { type: 'button', class: 'primary', 'data-action': 'buy', 'data-i': String(slot), disabled: owned || run.coins < run.price(id), text: owned ? 'Owned' : `Buy for ${run.price(id)}` }), slot);
    });
    return [
      h('h2', { text: run.practice ? 'Practice · the shop' : `Shop after ${run.floor.name.toLowerCase()}` }),
      this.#goalStrip(),
      this.#coachBox(run.practice ? Coach.advise(run) : null),
      h('p', { class: 'message', text: run.message || `You have ${run.coins} coins.` }),
      h('div', { class: `kit${this.#change.newView ? ' deal' : ''}` }, ...(cards.length ? cards : [h('p', { class: 'empty', text: 'The shelves are empty.' })])),
      run.character.ability === 'shop' && !run.practice
        ? h('button', { type: 'button', class: 'wide quiet', 'data-action': 'reroll', disabled: !run.canReroll, text: run.canReroll ? 'Reroll the shop, free' : 'Reroll used' }) : null,
      h('div', { class: 'row' },
        h('button', { type: 'button', 'data-action': 'patch', disabled: run.practice || run.coins < run.patchCost || run.hearts >= run.maxHearts, text: `Patch up: 1 heart for ${run.patchCost}` }),
        h('button', { type: 'button', class: 'go', 'data-action': 'leave', text: leaveText })),
    ];
  }

  /** @returns {HTMLElement[]} */
  #pathView() {
    const run = this.#run;
    const next = run.floorIndex + 1;
    const describe = (risky) => {
      const f = floorConfig(next, { depth: run.depth, risky, endless: run.endless });
      return `${f.traps} traps, ${f.caches} caches, ${f.stalls ? `${f.stalls} dead ${f.stalls === 1 ? 'end' : 'ends'}` : 'no dead ends'}.`;
    };
    const option = (risky, name, pitch) => h('button', { type: 'button', class: `choice${risky ? ' rich' : ''}`, 'data-action': 'path', 'data-risky': risky ? '1' : '0' },
      h('span', { class: 'name', text: name }), h('span', { class: 'text', text: `${pitch} ${describe(risky)}` }));
    return [
      h('h2', { text: `Fork before floor ${next + 1}` }),
      h('p', { text: 'Two ways down. Pick one.' }),
      option(false, 'Steady path', 'The standard floor.'),
      option(true, 'Rich vein', 'One more trap and one more dead end. Caches pay double.'),
    ];
  }

  /** @returns {HTMLElement[]} */
  #gateView() {
    const run = this.#run;
    const immune = run.character.ability === 'ignoreBoss';
    const parts = [h('h2', { text: 'Boss gate' }), ...run.bosses.map((boss) => h('div', { class: 'who' }, sprite('face', boss.id, 'big'), h('p', {}, h('b', { text: boss.name }), ` blocks the way. ${boss.text}`)))];
    if (immune) parts.push(h('p', { class: 'reward', text: `${run.character.name} walks straight through.` }));
    if (!run.tollSettled) {
      parts.push(h('div', { class: 'row' },
        h('button', { type: 'button', class: 'primary', 'data-action': 'toll', 'data-pay': 'coins', disabled: run.coins < 3, text: 'Pay 3 coins' }),
        h('button', { type: 'button', class: 'danger', 'data-action': 'toll', 'data-pay': 'heart', text: 'Lose 1 heart' })));
    }
    if (run.discardsLeft > 0) {
      parts.push(h('p', { class: 'message', text: `Discard ${run.discardsLeft} more. Tap an item to discard it.` }));
      parts.push(h('div', { class: 'kit' }, ...run.items.map((id, k) => h('button', { type: 'button', class: 'wide danger with-icon', 'data-action': 'sabotage', 'data-i': String(k) }, sprite('icon', id), `Discard ${ITEM_BY_ID[id].name}`))));
    }
    parts.push(h('button', { type: 'button', class: 'go wide', 'data-action': 'enter', disabled: !run.tollSettled || run.discardsLeft > 0, text: 'Enter the boss floor' }));
    return parts;
  }

  /** @param {boolean} won @returns {HTMLElement[]} */
  #endView(won) {
    const run = this.#run;
    const p = this.#profile;
    const rewards = this.#rewards || { stars: 0, characters: [], achievements: [], depthUp: false };
    const line = (label, value) => h('div', {}, h('span', { text: label }), h('span', { text: String(value) }));
    const score = h('p', { class: 'big', text: String(run.score) });
    if (this.#change.newView) this.#fx.countUp(score, 0, run.score, 900);
    const heading = run.endless ? 'Endless run over' : won ? 'Run won' : 'Run lost';
    const story = run.endless ? `${run.message} You cleared ${run.stats.floorsCleared} ${run.stats.floorsCleared === 1 ? 'floor' : 'floors'}.`
      : won ? run.message : `${run.message} You reached ${run.floor.name.toLowerCase()}.`;
    const gains = [
      h('p', { class: 'reward', text: `+${rewards.stars} stars. You have ${p.get('stars')}.` }),
      rewards.depthUp ? h('p', { class: 'reward', text: `Depth ${p.get('depthMax')} unlocked: ${DEPTHS[p.get('depthMax')]}` }) : null,
      ...rewards.characters.map((c) => h('p', { class: 'unlock', text: `New character: ${c.name}. ${c.text}` })),
      ...rewards.achievements.map((a) => h('p', { class: 'unlock', text: `Achievement: ${a.name}. ${a.text}` })),
    ];
    const daily = run.mode === MODE.DAILY ? [
      h('button', { type: 'button', class: 'primary wide', 'data-action': 'share', text: 'Share this result' }),
      this.#shareText ? h('p', { class: 'share', text: this.#shareText }) : null,
      this.#shareText ? h('p', { class: 'empty', text: this.#shareNote }) : null,
    ] : [];
    return [
      h('h2', { text: `${heading}${run.mode === MODE.DAILY ? ` · daily ${dailyRun().key}` : ''}` }),
      h('div', { class: 'who' }, sprite('face', run.character.id, 'big'), h('p', { text: story })),
      h('div', { class: 'tally' },
        line('Coins earned', run.stats.earned),
        line(`Hearts ${run.hearts} x ${RULES.heartPoints}`, run.hearts * RULES.heartPoints),
        run.depth ? line(`Depth ${run.depth} bonus`, `+${Math.round(RULES.depthBonus * run.depth * 100)}%`) : null,
        line('Best multiplier', `x${run.stats.bestMultiplier}`)),
      score,
      h('p', { class: 'empty', text: run.score >= p.get('best') ? 'That is your best score.' : `Best: ${p.get('best')}.` }),
      ...gains,
      ...daily,
      h('button', { type: 'button', class: 'go wide', 'data-action': 'title', text: 'Back to the title screen' }),
    ];
  }

  /** @returns {HTMLElement[]} */
  #practiceDoneView() {
    return [
      h('h2', { text: 'Practice complete' }),
      h('h3', { text: 'You are ready' }),
      h('p', { text: 'You read clues, marked and flipped, hunted caches, shopped, and broke a dead end with an item.' }),
      h('p', { text: 'A real run adds what the practice left out: traps cost hearts, there are three floors with a fork before each new one, and a boss floor ends the run with its own rule.' }),
      h('button', { type: 'button', class: 'go wide', 'data-action': 'title', text: 'Pick a character and start' }),
    ];
  }

  #renderKit() {
    const run = this.#run;
    const onFloor = run.phase === PHASE.FLOOR;
    if (!run.items.length) {
      this.#el.kit.replaceChildren(h('p', { class: 'empty', text: 'Empty. Caches pay coins. The shop sells tools and gear.' }));
      return;
    }
    const coachWantsProbe = run.practice && onFloor && Coach.advise(run).action === 'probe';
    this.#el.kit.replaceChildren(...run.items.map((id, k) => {
      const active = ACTIVE_ITEMS.includes(id);
      const spent = id === 'lantern' && onFloor && !run.lanternReady;
      const armed = this.#armed === id;
      const control = active
        ? h('button', { type: 'button', class: coachWantsProbe && id === 'probe' && !armed ? 'primary' : '', 'data-action': 'use', 'data-id': id, disabled: !run.canUse(id), 'aria-pressed': String(armed), text: armed ? 'Cancel' : spent ? 'Used' : 'Use' })
        : h('span', { class: 'kind', text: 'Automatic' });
      return GameUI.#itemCard(id, control, k, onFloor && !run.itemsWork ? 'off' : '');
    }));
  }
}

if (typeof document !== 'undefined') {
  const ui = new GameUI(document);
  ui.init();
  window.deepsweep = ui;
}

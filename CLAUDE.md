# Deepsweep project notes

Deepsweep is a Minesweeper roguelike that ships as one self-contained HTML file. See README.md for the layout and commands.

## Commands

- `npm install` once, then `npm run build` to produce `dist/`.
- `npm test` after every rules change. It takes a few seconds.
- `node test/sim.js 400` after any change that touches balance: items, prices, hearts, streak, bosses, characters, floors. Compare against the win rates in README.md and update them.
- `npm run test:browser` after UI changes, when Playwright is installed.

## Architecture rules

- `engine.js`, `run.js` and `meta.js` never touch the DOM. Tests load them in Node through `test/load.js`.
- All rules live in `Run`. `GameUI` only calls `Run` methods and reads its state. Do not put a rule in `ui.js`.
- Game data (items, bosses, characters, depths, floor configs) lives in `engine.js` as frozen arrays. Rule text shown to players comes from those arrays, so change the text and the behavior together.
- Everything random in a run goes through the run's seeded `Rng`. The daily run depends on that. Never call `Math.random` inside `Run`.
- The source files share one global scope after the build. They are not ES modules. Each ends with a `module.exports` line that the build strips.
- One click listener on `#app` routes every action through `data-action` attributes. Add a case to `GameUI.#dispatch` instead of adding listeners.
- `GameUI` rebuilds the stage on every action. Effects for the last action are queued in `#change` and played after the render.

## Constraints that have bitten before

- The page must scroll inside `.scroll`, not on the body. Host frames such as itch.io block page scrolling on phones. `tools/check-frame.py` guards this.
- The font is Jersey 15, weight 400 only. Do not add bold weights or `font-weight` above 400. An earlier pixel font made C read as O and 5 as S.
- Floor 1 must stay solvable by logic alone. Deeper floors carry an exact count of dead ends, checked by `Generator`. A new tile or clue type needs solver support first.
- The generator caps the enumeration frontier at 22 tiles. Raising it makes some boards very slow.
- `Profile.KEY` is versioned. Bump it only when the saved shape changes, because that resets every player's progress.
- The art sheets in `src/art/` are read by cell position. `items.png` follows the order of `ITEMS`; `portraits.png` and `ui.png` follow `PORTRAITS` and `UI_ICONS` in `ui.js`. Add or reorder an item, boss or character and the sheet together. The sources are in the Pixelwright project "Deepsweep".
- Show sprites at whole-number zoom only (`--z`), or the pixels come out uneven.
- The game is its own visual identity. Do not copy art, logos or layouts from other games.

## Style

- ES2022 classes with private fields, JSDoc on every class and public method.
- Plain language in all player-facing text. Present tense, no jargon.

# Deepsweep

A Minesweeper roguelike for the browser. Sweep three floors of buried traps and caches, build a streak multiplier, gear up in the shop, and beat the boss floor.

The game is plain JavaScript with no framework and no runtime dependencies. The build inlines everything into one HTML file.

## Quick start

```
npm install        # fetches the bundled font
npm run build      # writes dist/index.html, dist/itch/ and dist/Deepsweep-itch.zip
npm test           # rule tests, fuzz test, coach test
```

Open `dist/index.html` in a browser to play. Upload `dist/Deepsweep-itch.zip` to itch.io as an HTML project.

Needs Node 18 or later and Python 3.9 or later.

## Layout

| Path | What it holds |
| --- | --- |
| `src/engine.js` | Seeded boards, the logic-only solver, the board generator, and all game data: floors, items, bosses, characters, depth levels. No DOM. |
| `src/run.js` | `Run`, the rules of one run as a state machine, and `Coach`, the practice-mode advice. No DOM. |
| `src/meta.js` | Progress between runs: `Profile`, stars, character unlocks, achievements, the daily seed. No DOM. |
| `src/ui.js` | Sound, backdrop, effects, and `GameUI`, the page controller. |
| `src/game.src.html` | Page shell and all CSS. The build replaces the `/*__NAME__*/` markers with the scripts and the art. |
| `src/art/` | Pixel art sheets: `portraits.png` (14 portraits, 48 px), `items.png` (20 item icons, 16 px, 5 per row), `ui.png` (8 status and tile icons, 16 px), `sound.png` (sound on and off, 16 px). The build inlines them as data URLs. |
| `test/` | `check-gear.js` (28 rule tests), `check-run.js` (fuzz), `check-coach.js` (practice), `sim.js` (balance bot). |
| `tools/` | `build.py`, plus browser checks and store art that need Playwright. |
| `store/itch-page.md` | Store page text and upload settings. |

## Balance simulation

A bot with perfect logic plays full runs through the real rules.

```
node test/sim.js 400                    # Sapper, depth 0
node test/sim.js 400 char=gambler       # another character
node test/sim.js 400 depth=3 risky=1    # depth level, always take the rich vein
node test/sim.js 400 step=10 patch=6    # try a rule value without editing the engine
```

Last measured bot win rates: Sapper about 79%, Gambler 73%, Ghost 68%, Daredevil 83%, Banker 87%, Surveyor 88%, Medic 88%. Depth 1 to 5: 78%, 72%, 61%, 52%, 40%. Human win rates are not measured.

## Browser checks and store art

These need Playwright for Python (`pip install playwright`, then `playwright install chromium`). Set `CHROME_PATH` to use an installed Chrome.

```
npm run test:browser   # plays the guide, practice, a run, the daily and endless; saves screenshots to dist/art/
npm run art            # renders the cover and icon to dist/art/
```

## Not built yet

- Odd-or-even clue tiles. They need solver support, or floor 1 loses its no-guess guarantee.
- A leaderboard for the daily run. It needs a server.
- App wrappers for the Play Store, App Store and Steam.

## Credits

Font: Jersey 15, SIL Open Font License 1.1.

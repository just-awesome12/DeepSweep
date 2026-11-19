# Evaluation: Deepsweep against Infinity Sweeper (19 November 2026)

## 1. Verdict

**GO: keep building, and release it.** Infinity Sweeper has much the same outline, but it is a paid PC game with mixed reviews, and the things its reviewers complain about most are things Deepsweep already does. Deepsweep is also free, in the browser and playable on a phone, which none of the comparables found are confirmed to be.

Sunk cost is not part of this verdict. The game is close to shippable, and that is why continuing is cheap, not why it is right.

## 2. Core loop

Tap a tile to flip it → a number shows how many buried tiles touch it → clear every safe tile to finish the floor, then choose whether to gamble on buried tiles that are either a trap or a coin cache → spend coins in the shop, beat the boss floor → the run ends when your hearts run out.

## 3. Scorecard

| Criterion | Score | Reason |
|---|---|---|
| Simplicity | 5 | Already built: one HTML file, no server, 24 rule tests and a browser playthrough passing. |
| Content cost | 5 | Boards come from a seeded generator checked by a solver; the 100th floor costs nothing. |
| Virality | 3 | A clip is readable but ordinary. The daily run shares plain text only. |
| Monetization | 2 | Free with no ads or purchases. The shop between floors is a natural break, but nothing uses it. |
| Competition gap | 3 | Several direct competitors, with clear complaints in their reviews (see section 4). |
| Trend timing | 3 | Peaking: one release in May 2026 and at least two more listed for 2026. |
| Creator fit | 5 | Programming and automation, no backend, art now in place. |
| **Total** | **26/35** | No score of 1. All hard gates pass. |

Hard gates: no third-party IP; nothing beyond a solo budget; the game is days from release, well inside the window; the mechanic is peaking, not saturated, and the trap-or-cache gamble is a twist a short clip can show, though today the game does not show it loudly.

- **Distance to shippable MVP:** 1 to 3 days (merge the open pull request, upload the existing itch.io zip, write the page from `store/itch-page.md`).
- **Reusable parts if you pivoted:** the seeded generator and logic solver, the balance bot, the run state machine, the art sheets, the one-file build.

## 4. Comparables

| Title | Developer | Launch | Standing | Model | Top complaints |
|---|---|---|---|---|---|
| Infinity Sweeper | Longshot Studio | 7 May 2026 | Steam "Mixed", 58% of 256 reviews in one snapshot; another snapshot shows 71% of 102 | Paid, PC (price not found) | Too easy; boss stages give so much time they "could basically not exist"; roguelite systems "boring, poorly explained"; no tutorial for cards and modifiers; poorly balanced randomness; bugs at launch |
| DemonCrawl | Therefore Games | 5 November 2019 | Steam "Mostly Positive", about 1,230 to 1,331 reviews | Paid, Windows, Mac, Linux | As a roguelike it can feel unfair |
| Sweep Happens | Outstanding Move Games | Listed for Q3 2026 | No reviews found | Not found | None yet |
| Tiled Gambit | Not found | Listed for 24 July 2026, launch not confirmed | Not found | Not found | None found |
| Dungeon Sweeper | Not found | Not found | Not found | Minesweeper mixed with an auto-battler | None found |

What Infinity Sweeper shares with Deepsweep, from reviews: three lives, gold, a shop, cards and relics, boss stages, a daily challenge. What it has that Deepsweep lacks: a leaderboard for the daily, and timed bosses.

## 5. Gaps to exploit

1. **Onboarding.** The most repeated complaint about Infinity Sweeper is that nothing is explained. Deepsweep has a four-page guide and a coached practice run. Put that in the first line of the store page.
2. **Fairness.** Reviewers call its randomness poorly balanced. Deepsweep's first floor needs no guessing, and every later floor states its exact number of dead ends. No comparable found advertises that.
3. **Where it plays.** The comparables are paid PC games. A free game that runs in a phone browser reaches people who will never open Steam for Minesweeper.

## 6. Sharpen

The single change that most raises the score is the **Daily Dig share card** from `reports/2026-11-19-ideas.md`: it lifts Virality from 3 to 4 for under a week of work and changes no rules. A leaderboard would match Infinity Sweeper's daily, but it needs a server, so it stays out.

## 7. Kill switch

The game has no analytics, and I found no current benchmark for a free web puzzle game, so **thresholds are not verified**. What to do:

- Release on itch.io and read its built-in views, plays and ratings for 30 days.
- Treat that month as the baseline. Stop adding features if plays do not grow in the second month after the share card ships.
- Stop sooner if players report that the game is unfair or confusing in the way Infinity Sweeper's reviews do, because that removes the main gap.

## 8. Assumptions and unknowns

- **Assumed:** solo developer, near-zero budget, free web release, no server. Read from the repo, not stated by you.
- **The niche is small. Estimate:** the oldest and best-known title, DemonCrawl, has about 1,300 Steam reviews after seven years. Expect an audience, not an income.
- **I have not played Infinity Sweeper.** Its feature list here comes from reviews and store text.
- **Not verified:** Infinity Sweeper's price; whether its itch.io page offers a browser build; whether Tiled Gambit and Sweep Happens have launched; why the two Steam review snapshots differ.

## Sources

- Infinity Sweeper on Steam: https://store.steampowered.com/app/3161400/Infinity_Sweeper/
- Infinity Sweeper on itch.io: https://longshotstudio.itch.io/infinity-sweeper
- Infinity Sweeper review, Loot Level Chill: https://lootlevelchill.com/reviews/infinity-sweeper-review/
- Infinity Sweeper review, Beefsuplex: https://beefsuplex.com/reviews/infinity-sweeper/
- Infinity Sweeper review, Netto's Game Room: https://www.nettosgameroom.com/2026/05/infinity-sweeper-review.html?m=1
- Infinity Sweeper review, Movies Games and Tech: https://moviesgamesandtech.com/2026/05/06/review-infinity-sweeper/
- Infinity Sweeper review, GameGeeker: https://gamegeeker.com/news/infinity-sweeper-roguelike-plus-minesweeper-review?country=US
- DemonCrawl on Nodal: https://nodal.gg/game/demoncrawl-1141220
- DemonCrawl review, Indie Hell Zone: https://indiehellzone.com/2022/08/02/demoncrawl/
- Sweep Happens: https://www.dekudeals.com/items/sweep-happens
- Tiled Gambit on Steam: https://store.steampowered.com/app/4799630/Tiled_Gambit/

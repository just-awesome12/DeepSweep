"""Drive the itch build in a real browser: play the tutorial by following the coach,
then let a logic bot play runs. Saves store screenshots to dist/art/."""
import os, asyncio, pathlib, sys
from playwright.async_api import async_playwright

ROOT = pathlib.Path(__file__).parent.parent
ART = ROOT / 'dist/art'; ART.mkdir(parents=True, exist_ok=True)
BOT = """() => {
  const run = window.deepsweep.run; if (!run) return 'title';
  const click = (sel) => { const el = document.querySelector(sel); if (el && !el.disabled) { el.click(); return true; } return false; };
  const mode = (m) => click(`[data-mode="${m}"][aria-pressed="false"]`);
  if (run.phase === 'shop' && run.practice) { click('[data-action="buy"]:not(:disabled)'); click('[data-action="leave"]'); return 'practice-shop'; }
  if (run.phase === 'shop') { for (let k = 0; k < 4; k++) { if (!click('[data-action="buy"]:not(:disabled)')) break; } click('[data-action="patch"]'); click('[data-action="leave"]'); return 'shop'; }
  if (run.phase === 'path') { click('[data-action="path"][data-risky="0"]'); return 'path'; }
  if (run.phase === 'bossGate') { click('[data-pay="coins"]') || click('[data-pay="heart"]'); while (click('[data-action="sabotage"]')) {} click('[data-action="enter"]'); return 'gate'; }
  if (run.phase !== 'floor') return run.phase;
  if (run.practice) {
    const box = document.querySelector('.coach-box'); const txt = box ? box.textContent : '';
    if (/Tap Use on the Probe/.test(txt)) { click('[data-action="use"][data-id="probe"][aria-pressed="false"]'); document.querySelector('.cell.coach').click(); return 'practice-probe'; }
    const cells = document.querySelectorAll('.cell.coach'); if (!cells.length || run.cleared) { click('[data-action="descend"]'); return 'practice-leave'; }
    mode(/Switch to Mark/.test(txt) ? 'mark' : 'flip');
    document.querySelector('.cell.coach').click(); return 'practice';
  }
  mode('flip');
  const known = Uint8Array.from(run.found, (v) => (v >= 0 ? 1 : 0));
  if (!run.cleared) {
    const s = new Solver(run.board, run.open, known); let d = s.step(); while (d && !d.safe.length) { s.apply(d); d = s.step(); }
    let i = d ? d.safe[0] : -1;
    if (i < 0) { const risk = s.riskMap(); let p = 2; risk && risk.forEach((v, c) => { if (v < p) { p = v; i = c; } }); }
    document.querySelector(`.cell[data-i="${i}"]`).click(); return 'floor';
  }
  const odds = cacheOdds(run.board, run.open, run.found); let best = -1, p = -1; odds.forEach((v, c) => { if (v > p) { p = v; best = c; } });
  if (best >= 0 && run.cachesFound < 2 && (p === 1 || (run.isBossFloor && !run.bossBeaten))) { document.querySelector(`.cell[data-i="${best}"]`).click(); return 'cache'; }
  click('[data-action="descend"]'); return 'descend';
}"""

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=os.environ.get('CHROME_PATH'), args=['--no-sandbox'])
        ctx = await b.new_context(viewport={'width': 420, 'height': 880}, device_scale_factor=2)
        pg = await ctx.new_page()
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
        await pg.goto(f'file://{ROOT}/dist/itch/index.html'); await pg.wait_for_timeout(900)
        shot = lambda name: pg.screenshot(path=str(ART / f'{name}.png'))
        async def play_shot(name):
            """A floor shot. Scroll the game so the boss panel is at the top and the companion under the board is in view."""
            await pg.evaluate("document.getElementById('scroll').scrollTop = document.getElementById('boss').offsetTop - 14")
            await pg.wait_for_timeout(200); await shot(name)
            await pg.evaluate("document.getElementById('scroll').scrollTop = 0")
        await shot('01-title')
        # guide pages, then the whole practice by following the coach
        await pg.click('[data-action="screen"][data-to="guide"]'); await pg.wait_for_timeout(500); await shot('02-guide')
        while await pg.locator('[data-kind="practice"]').count() == 0:
            await pg.click('[data-action="guide"][data-step="1"]')
        await pg.click('[data-kind="practice"]')
        seen = set()
        for step in range(200):
            if step == 4: await pg.wait_for_timeout(1200); await shot('03-practice')
            state = await pg.evaluate(BOT); seen.add(state)
            if state == 'practiceDone': break
        assert await pg.evaluate("window.deepsweep.run.phase") == 'practiceDone', 'practice did not finish'
        assert {'practice-shop', 'practice-probe'} <= seen, seen
        await pg.click('[data-action="title"]')
        assert await pg.evaluate("window.deepsweep.profile.hasAchievement('tutorial')")
        # runs until one is won; capture each stage once
        got, wins, runs = set(), 0, 0
        while runs < 40 and not {'floor', 'shop', 'fork', 'boss', 'won'} <= got:
            runs += 1
            await pg.click('[data-action="start"][data-kind="run"]')
            for _ in range(500):
                state = await pg.evaluate(BOT)
                info = await pg.evaluate("(() => { const r = window.deepsweep.run; return r ? [r.phase, r.floorIndex, r.items.length, r.openCount] : null; })()")
                if info is None: break
                phase, floor, items, opened = info
                if phase == 'floor' and floor == 1 and opened > 18 and 'floor' not in got: got.add('floor'); await pg.wait_for_timeout(1600); await play_shot('04-floor')
                if phase == 'shop' and state != 'shop' and 'shop' not in got and floor >= 1: got.add('shop'); await pg.wait_for_timeout(1600); await shot('05-shop')
                if phase == 'path' and state != 'path' and 'fork' not in got: got.add('fork'); await pg.wait_for_timeout(900); await shot('06-fork')
                if phase == 'floor' and floor == 3 and opened > 16 and 'boss' not in got: got.add('boss'); await pg.wait_for_timeout(1600); await play_shot('07-boss-floor')
                if phase in ('won', 'lost'):
                    if phase == 'won':
                        wins += 1
                        if 'won' not in got: got.add('won'); await pg.wait_for_timeout(2600); await shot('08-win')
                    await pg.click('[data-action="title"]'); break
        # daily run: plays on the shared seed, result can be shared
        await pg.click('[data-action="start"][data-kind="daily"]')
        assert await pg.evaluate("window.deepsweep.run.mode") == 'daily'
        for _ in range(500):
            await pg.evaluate(BOT)
            if await pg.evaluate("window.deepsweep.run.over"): break
        await pg.click('[data-action="share"]'); await pg.wait_for_timeout(300)
        share = await pg.locator('.share').inner_text(); assert 'Deepsweep daily' in share, share
        await pg.click('[data-action="title"]')
        # endless: a few floors, no boss
        await pg.click('[data-action="start"][data-kind="endless"]')
        for _ in range(700):
            await pg.evaluate(BOT)
            done = await pg.evaluate("(() => { const r = window.deepsweep.run; return r.over || r.stats.floorsCleared >= 5; })()")
            if done: break
        endless = await pg.evaluate("(() => { const r = window.deepsweep.run; return [r.stats.floorsCleared, r.bosses.length, r.phase]; })()")
        if endless[2] in ('won', 'lost'): await pg.click('[data-action="title"]')
        else: await pg.click('[data-action="restart"]'); await pg.click('[data-action="restart"]')
        # stars buy a character; depth picker; achievements screen
        await pg.evaluate("window.deepsweep.profile.set('stars', 50)")
        await pg.click('[data-action="screen"][data-to="achievements"]'); await pg.wait_for_timeout(500); await shot('09-achievements'); await pg.click('[data-action="title"]')
        await pg.click('[data-action="character"][data-id="banker"]')
        owned = await pg.evaluate("[window.deepsweep.profile.get('characters').includes('banker'), window.deepsweep.profile.get('stars'), window.deepsweep.profile.character.id]")
        assert owned == [True, 10, 'banker'], owned
        depth = await pg.evaluate("window.deepsweep.profile.get('depthMax')")
        if depth: await pg.click('[data-action="depth"][data-step="1"]')
        await pg.wait_for_timeout(600); await shot('10-title-progress')
        print('endless', endless, '| share text ok | banker bought', owned, '| depth unlocked', depth)
        print('runs', runs, 'wins', wins, 'captured', sorted(got), 'errors', errs)
        prof = await pg.evaluate("localStorage.getItem('deepsweep.profile.v1')"); print(prof)
        await b.close()
asyncio.run(main())

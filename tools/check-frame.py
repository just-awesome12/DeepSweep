"""Host the itch build the way itch.io does on a phone: inside a frame that blocks scrolling.
A touch swipe must still scroll the game."""
import os, asyncio, pathlib
from playwright.async_api import async_playwright
ROOT = pathlib.Path(__file__).parent.parent
HOST = ROOT / 'dist/_host.html'
HOST.write_text('<!DOCTYPE html><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;height:100%;overflow:hidden}iframe{border:0;width:100%;height:100%}</style><iframe scrolling="no" src="itch/index.html"></iframe>')
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=os.environ.get('CHROME_PATH'), args=['--no-sandbox', '--allow-file-access-from-files'])
        for name, vp in (('landscape', {'width': 915, 'height': 412}), ('portrait', {'width': 412, 'height': 915})):
            ctx = await b.new_context(viewport=vp, has_touch=True, is_mobile=True, device_scale_factor=2)
            pg = await ctx.new_page(); errs = []
            pg.on('pageerror', lambda e: errs.append(str(e)))
            await pg.goto(HOST.as_uri()); await pg.wait_for_timeout(800)
            fr = pg.frames[1]
            before = await fr.evaluate("(() => { const s = document.getElementById('scroll'); return [s.scrollTop, s.scrollHeight, s.clientHeight]; })()")
            cdp = await ctx.new_cdp_session(pg)
            x, y0 = vp['width'] // 2, int(vp['height'] * 0.8)
            await cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [{'x': x, 'y': y0}]})
            for y in range(y0 - 10, int(vp['height'] * 0.2), -20):
                await cdp.send('Input.dispatchTouchEvent', {'type': 'touchMove', 'touchPoints': [{'x': x, 'y': y}]}); await pg.wait_for_timeout(16)
            await cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []})
            await pg.wait_for_timeout(400)
            after = await fr.evaluate("document.getElementById('scroll').scrollTop")
            # a tap after scrolling still reaches a button
            await fr.evaluate("document.getElementById('scroll').scrollTop = 0")
            await fr.locator('[data-action="start"][data-kind="run"]').tap(); await pg.wait_for_timeout(300)
            started = await fr.evaluate("Boolean(window.deepsweep.run)")
            sel = await fr.evaluate("getComputedStyle(document.body).userSelect")
            print(name, 'top/height/view', before, '-> scrollTop after swipe', after, '| tap starts run', started, '| user-select', sel, '| errors', errs)
            assert after > 100 and started
            await ctx.close()
        await b.close()
    HOST.unlink()
asyncio.run(main())

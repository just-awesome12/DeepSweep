"""Render the store cover and icon with the bundled game fonts."""
import os, asyncio, pathlib
from playwright.async_api import async_playwright

ROOT = pathlib.Path(__file__).parent.parent
ART = ROOT / 'dist/art'
ART.mkdir(parents=True, exist_ok=True)
FONTS = (ROOT / 'dist/itch/fonts').as_uri()
BASE = f"""
@font-face {{ font-family: "Jersey 15"; src: url("{FONTS}/jersey-15-latin-400-normal.woff2"); }}
* {{ box-sizing: border-box; }} html, body {{ margin: 0; }}
body {{ background: radial-gradient(ellipse at 30% 20%, #1e2a52 0%, #113540 45%, #080f16 100%); position: relative; overflow: hidden; }}
body::after {{ content: ""; position: absolute; inset: 0; background: repeating-linear-gradient(to bottom, rgba(0,0,0,0.14) 0 1px, transparent 1px 3px), radial-gradient(ellipse at center, transparent 55%, rgba(0,0,0,0.55) 100%); }}
.t {{ border-radius: 12%; display: grid; place-items: center; font: 400 1.2em "Jersey 15"; aspect-ratio: 1; }}
.c {{ background: #5d8797; box-shadow: inset 0 -0.12em 0 #33535f, inset 0 0.05em 0 rgba(255,255,255,0.22); }}
.o {{ background: #111c23; box-shadow: inset 0 0.07em 0 rgba(0,0,0,0.5); }}
.n1 {{ color: #45a9e6; }} .n2 {{ color: #55c887; }} .n3 {{ color: #f4b93e; }}
.trap {{ background: #47201c; box-shadow: inset 0 0 0 0.07em #ee5d44; }}
.trap::after {{ content: ""; width: 38%; aspect-ratio: 1; background: #ee5d44; transform: rotate(45deg); border-radius: 8%; }}
.cache {{ background: #4a3912; box-shadow: inset 0 0 0 0.07em #f4b93e; }}
.cache::after {{ content: ""; width: 44%; aspect-ratio: 1; background: #f4b93e; border-radius: 50%; box-shadow: 0 0.07em 0 #a8791b; }}
"""
tile = lambda k: {'c': '<div class="t c"></div>', 'o': '<div class="t o"></div>', 'T': '<div class="t trap"></div>', 'C': '<div class="t cache"></div>'}.get(k) or f'<div class="t o n{k}">{k}</div>'

COVER = f"""<style>{BASE}
body {{ width: 630px; height: 500px; color: #f4f0e2; }}
h1 {{ font: 400 118px/1 "Jersey 15"; margin: 0; letter-spacing: 0.03em; position: absolute; left: 38px; top: 40px; color: #f4b93e; text-shadow: 0 7px 0 #070c11; }}
p {{ font: 400 28px "Jersey 15"; color: #a4b6bd; margin: 0; position: absolute; left: 42px; top: 150px; }}
p b {{ color: #f4f0e2; font-weight: 400; }}
.g {{ position: absolute; left: 40px; right: 40px; bottom: -50px; display: grid; grid-template-columns: repeat(6, 1fr); gap: 9px; font-size: 52px; transform: rotate(-2deg); }}
</style><h1>DEEPSWEEP</h1><p>A Minesweeper roguelike. <b>Sweep. Gamble. Descend.</b></p>
<div class="g">{''.join(tile(k) for k in 'c1o12cT211C3ccc2cc')}</div>"""

ICON = f"""<style>{BASE}
body {{ width: 512px; height: 512px; display: grid; grid-template-columns: 1fr 1fr; gap: 24px; padding: 48px; font-size: 150px; }}
</style>{''.join(tile(k) for k in '2cCT')}"""

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=os.environ.get('CHROME_PATH'), args=['--no-sandbox', '--allow-file-access-from-files'])
        for name, markup, w, h, scale in (('cover-630x500', COVER, 630, 500, 2), ('icon-512', ICON, 512, 512, 1)):
            src = ROOT / f'dist/_{name}.html'
            src.write_text(f'<!DOCTYPE html><meta charset="utf-8">{markup}')
            pg = await b.new_page(viewport={'width': w, 'height': h}, device_scale_factor=scale)
            await pg.goto(src.as_uri()); await pg.wait_for_timeout(400)
            await pg.screenshot(path=str(ART / f'{name}.png'))
            src.unlink()
        await b.close()
asyncio.run(main())

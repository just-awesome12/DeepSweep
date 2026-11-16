"""Build the game page twice: dist/index.html (Google Fonts link, one self-contained file)
and dist/itch/ plus dist/Deepsweep-itch.zip (fonts bundled, no outside requests, for itch.io).
Run `npm install` first: the bundled font comes from node_modules."""
import pathlib, re, shutil, zipfile

root = pathlib.Path(__file__).parent.parent
strip = lambda s: re.sub(r"\n(const Deepsweep = .*\n)?if \(typeof module !== 'undefined'\).*\n", "\n", s)
html = (root / 'src/game.src.html').read_text()
for mark, name in (('/*__ENGINE__*/', 'engine.js'), ('/*__RUN__*/', 'run.js'), ('/*__META__*/', 'meta.js'), ('/*__UI__*/', 'ui.js')):
    html = html.replace(mark, strip((root / 'src' / name).read_text()))
dist = root / 'dist'
dist.mkdir(exist_ok=True)
(dist / 'index.html').write_text(html)

FONTS = [('Jersey 15', 'jersey-15', (400,))]
itch = dist / 'itch'
shutil.rmtree(itch, ignore_errors=True)
(itch / 'fonts').mkdir(parents=True)
faces = []
for family, pkg, weights in FONTS:
    src = root / 'node_modules/@fontsource' / pkg
    shutil.copy(src / 'LICENSE', itch / 'fonts' / f'{pkg}-LICENSE.txt')
    for w in weights:
        file = f'{pkg}-latin-{w}-normal.woff2'
        shutil.copy(src / 'files' / file, itch / 'fonts' / file)
        faces.append(f'@font-face {{ font-family: "{family}"; font-weight: {w}; font-display: swap; src: url("fonts/{file}") format("woff2"); }}')
local = re.sub(r'<!--FONTS-->.*?<!--/FONTS-->', '<style>\n' + '\n'.join(faces) + '\n</style>', html, flags=re.S)
assert 'googleapis' not in local
(itch / 'index.html').write_text(local)
with zipfile.ZipFile(dist / 'Deepsweep-itch.zip', 'w', zipfile.ZIP_DEFLATED) as z:
    for f in sorted(itch.rglob('*')):
        if f.is_file():
            z.write(f, f.relative_to(itch).as_posix())
print('built', len(html), 'zip', (dist / 'Deepsweep-itch.zip').stat().st_size)

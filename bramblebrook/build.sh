#!/usr/bin/env bash
# Builds Bramblebrook Farm from src/.
#   game.html          the Artifact page (no <html>/<head>: the Artifact publisher adds them)
#   public/            the live site: index.html, content.json, atlas.png, manifest, icons
# content.json merges src/content/*.json; atlas.png comes from tools/build_atlas.py (committed in assets/).
set -euo pipefail
cd "$(dirname "$0")"
node tools/validate.js >/dev/null || { node tools/validate.js; exit 1; }
mkdir -p public
node - <<'JS'
const fs = require('fs');
const read = f => JSON.parse(fs.readFileSync('src/content/' + f, 'utf8'));
const maybe = f => (fs.existsSync('src/content/' + f) ? read(f) : null);
const content = { core: read('core.json'), story: read('story.json'), people: read('people.json'), adventures: read('adventures.json'), art: read('art.json'), tours: read('tours.json'), bestiary: maybe('bestiary.json'), delves: maybe('delves.json'), companions: maybe('companions.json') };
fs.writeFileSync('public/content.json', JSON.stringify(content));
const css = fs.readFileSync('src/style.css', 'utf8');
const js = fs.readdirSync('src/js').filter(f => f.endsWith('.js')).sort().map(f => fs.readFileSync('src/js/' + f, 'utf8')).join('\n');
const page = fs.readFileSync('src/shell.html', 'utf8').replace('/*@STYLE@*/', () => css).replace('/*@SCRIPT@*/', () => js);
fs.writeFileSync('game.html', page);
const head = [
  '<!doctype html>', '<html lang="en">', '<head>', '<meta charset="utf-8">',
  '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">',
  '<meta name="theme-color" content="#0E0F1E">',
  '<meta name="description" content="A cozy, menu-based farming RPG. Grow crops, explore, fish, mine, cook, befriend the villagers and ring the Bramble Bell again.">',
  '<link rel="manifest" href="manifest.webmanifest">', '<link rel="icon" href="icon.svg" type="image/svg+xml">',
  '<link rel="apple-touch-icon" href="icon-180.png">', '<meta name="apple-mobile-web-app-capable" content="yes">',
  '<meta name="apple-mobile-web-app-title" content="Bramblebrook">',
  '<style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0}img{max-width:100%}[hidden]{display:none!important}</style>',
  '</head>', '<body>',
].join('\n');
fs.writeFileSync('public/index.html', head + '\n' + page + '\n</body>\n</html>\n');
console.log(`game.html ${(page.length / 1024).toFixed(0)} KB, content.json ${(JSON.stringify(content).length / 1024).toFixed(0)} KB`);
JS
cp assets/atlas.png assets/stage.png assets/icon.svg assets/manifest.webmanifest assets/icon-180.png assets/icon-192.png assets/icon-512.png public/
echo "Built game.html and public/"

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
const content = { core: read('core.json'), story: read('story.json'), people: read('people.json'), adventures: read('adventures.json'), art: read('art.json'), tours: read('tours.json'), bestiary: maybe('bestiary.json'), delves: maybe('delves.json'), companions: maybe('companions.json'), classes: maybe('classes.json'), foes: maybe('foes.json') };
fs.writeFileSync('public/content.json', JSON.stringify(content));
const css = fs.readFileSync('src/style.css', 'utf8');
const js = fs.readdirSync('src/js').filter(f => f.endsWith('.js')).sort().map(f => fs.readFileSync('src/js/' + f, 'utf8')).join('\n');
const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
const page = fs.readFileSync('src/shell.html', 'utf8').replace('/*@STYLE@*/', () => css).replace('/*@SCRIPT@*/', () => js).replace('/*@BUILD@*/', () => stamp);
fs.writeFileSync('game.html', page);
// the rules engine for the server: the same game code with no page (src/engine-preamble.js, src/js/99-engine.js)
fs.mkdirSync('supabase/functions/_engine', { recursive: true });
const ENV = ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'requestAnimationFrame', 'cancelAnimationFrame', 'document', 'window', 'addEventListener', 'removeEventListener', 'localStorage', 'sessionStorage', 'fetch', 'confirm', 'alert', 'matchMedia', 'navigator', 'location'];
const engineJs = fs.readFileSync('src/engine-preamble.js', 'utf8') + `(function (${ENV.join(', ')}) {\n'use strict';\n` + js.replace('/*@BUILD@*/', () => stamp) + `})(${ENV.map(k => '__engineEnv.' + k).join(', ')});\n`;
fs.writeFileSync('supabase/functions/_engine/engine.js', engineJs);
fs.writeFileSync('public/engine.js', engineJs);   // the server loads the rules from the site, so both always run the same ones
fs.writeFileSync('supabase/functions/_engine/content.json', JSON.stringify(content));
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
// The website and the phone app: the script is its own file (so the site can forbid inline scripts), and the
// fonts come from this site, not Google. game.html above stays one self-contained page for the Artifact.
const SCRIPT_TAG = '<script>\n(() => {\n\'use strict\';\n';
const at = page.indexOf(SCRIPT_TAG);
if (at < 0) throw new Error('shell.html script block not found');
const end = page.lastIndexOf('})();\n</script>');
const gameJs = "(() => {\n'use strict';\n" + page.slice(at + SCRIPT_TAG.length, end) + '})();\n';
const sitePage = (page.slice(0, at) + '<script src="game.js"></script>' + page.slice(end + '})();\n</script>'.length))
  .replace(/<link rel="preconnect"[^>]*>\n/g, '')
  .replace(/<link rel="stylesheet" href="https:\/\/fonts\.googleapis\.com[^>]*>/, '<link rel="stylesheet" href="fonts.css">');
if (/<script>/.test(sitePage) || /onclick=/.test(sitePage)) throw new Error('inline script left in the site page');
fs.writeFileSync('public/game.js', gameJs);
fs.writeFileSync('public/index.html', head + '\n' + sitePage + '\n</body>\n</html>\n');
// privacy, terms and help pages
const SUPPORT_EMAIL = process.env.SUPPORT_EMAIL || fs.existsSync('support-email.txt') && fs.readFileSync('support-email.txt', 'utf8').trim() || '';
const shell = fs.readFileSync('src/pages/_page.html', 'utf8');
for (const f of fs.readdirSync('src/pages').filter(f => f.endsWith('.md.html'))) {
  const src = fs.readFileSync('src/pages/' + f, 'utf8');
  const title = (src.match(/<!-- TITLE: (.*?) -->/) || [])[1] || 'Bramblebrook Farm';
  const desc = (src.match(/<!-- DESC: (.*?) -->/) || [])[1] || '';
  const body = src.replace(/<!--.*?-->\n/g, '').replace('@EMAIL@', SUPPORT_EMAIL ? `<p>Or email <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a>.</p>` : '');
  fs.writeFileSync('public/' + f.replace('.md.html', '.html'), shell.replace(/@TITLE@/g, title).replace('@DESC@', desc).replace('@BODY@', () => body));
}
console.log(`game.html ${(page.length / 1024).toFixed(0)} KB, content.json ${(JSON.stringify(content).length / 1024).toFixed(0)} KB`);
JS
cp assets/atlas.png assets/stage.png assets/boss.webp assets/icon.svg assets/manifest.webmanifest assets/icon-180.png assets/icon-192.png assets/icon-512.png public/
mkdir -p public/fonts && cp assets/fonts/*.woff2 public/fonts/ && cp assets/fonts/fonts.css public/fonts.css
echo "Built game.html and public/"

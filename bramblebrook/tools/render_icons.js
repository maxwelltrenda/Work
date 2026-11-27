/* Renders every app icon and the iPhone splash from assets/icon.svg, so changing the icon is one file.
     NODE_PATH=$(npm root -g) node tools/render_icons.js
   Rounded with see-through corners: icon-192, icon-512 (the website's install icons).
   Square, edge to edge: icon-180 (iPhone home screen from Safari) and the 1024 App Store icon, because iOS cuts
   its own rounded corners and fills see-through ones with black. The splash is the rounded icon on the page colour. */
const fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const ROOT = path.join(__dirname, '..');
const BG = '#09060A';
const svg = fs.readFileSync(path.join(ROOT, 'assets/icon.svg'), 'utf8');
const square = svg.replace('<rect width="512" height="512" rx="112"/>', '<rect width="512" height="512"/>');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const shot = async (src, size, out, opts = {}) => {
    await page.setViewportSize({ width: size, height: size });
    const icon = opts.inset ? `<div style="position:absolute;left:50%;top:50%;width:${opts.inset}px;height:${opts.inset}px;transform:translate(-50%,-50%)">${src}</div>` : src;
    await page.setContent(`<html><body style="margin:0;width:${size}px;height:${size}px;position:relative;background:${opts.bg || 'transparent'}"><style>svg{display:block;width:100%;height:100%}</style>${icon}</body></html>`);
    await page.screenshot({ path: path.join(ROOT, out), omitBackground: !opts.bg });
    console.log('wrote', out);
  };
  await shot(svg, 192, 'assets/icon-192.png');
  await shot(svg, 512, 'assets/icon-512.png');
  await shot(square, 180, 'assets/icon-180.png', { bg: BG });
  await shot(square, 1024, 'app/ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png', { bg: BG });
  for (const n of ['splash-2732x2732.png', 'splash-2732x2732-1.png', 'splash-2732x2732-2.png'])
    await shot(svg, 2732, 'app/ios/App/App/Assets.xcassets/Splash.imageset/' + n, { bg: BG, inset: 546 });
  await browser.close();
})();

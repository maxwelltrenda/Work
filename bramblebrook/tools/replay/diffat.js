const fs = require('fs');
const path = require('path');
const [REC, ENGINE_DIR] = process.argv.slice(2).map(p => p && path.resolve(p));
require(ENGINE_DIR + '/engine.js');
const E = globalThis.__engine; E.load(JSON.parse(fs.readFileSync(ENGINE_DIR + '/content.json', 'utf8')));
const rec = JSON.parse(fs.readFileSync(REC, 'utf8'));
const i = +process.env.SNAP;
const r = E.replay(rec.s0, rec.log.slice(0, i), { at: rec.log[i].t });
const a = rec.snap, b = r.state;
console.log('client snap hash', E.hashState(a), 'server', r.hash, 'recorded', rec.log[i].h);
const skip = new Set(['tab', 'sub', 'opts', 'toursSeen', 'visited', 'savedAt', 'innSeen', 'revealed']);
const walk = (x, y, p) => {
  if (JSON.stringify(x) === JSON.stringify(y)) return;
  if (x && y && typeof x === 'object' && typeof y === 'object') { for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) walk(x[k], y[k], p + '.' + k); return; }
  console.log(`  ${p}: client ${JSON.stringify(x)} | server ${JSON.stringify(y)}`);
};
for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) if (!skip.has(k)) walk(a[k], b[k], k);

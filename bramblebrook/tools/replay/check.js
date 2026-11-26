// Replays a recorded bot run through the server engine and compares the farms.
const fs = require('fs');
const path = require('path');
const [REC, ENGINE_DIR] = process.argv.slice(2).map(p => p && path.resolve(p));
require(ENGINE_DIR + '/engine.js');
const E = globalThis.__engine; E.load(JSON.parse(fs.readFileSync(ENGINE_DIR + '/content.json', 'utf8')));
const rec = JSON.parse(fs.readFileSync(REC, 'utf8'));
const t0 = Date.now();
const r = E.replay(rec.s0, rec.log, { at: rec.at });
console.log(`moves ${rec.log.length}, replay ${Date.now() - t0} ms, notes ${r.notes.length}${r.notes.length ? ': ' + r.notes.slice(0, 5).join(' | ') : ''}`);
console.log('client', rec.hash, 'server', r.hash, rec.hash === r.hash ? 'MATCH' : 'DIFFERENT');
const counts = {}; rec.log.forEach(m => { const k = m.n === 'h' ? 'h:' + m.a.act : m.n; counts[k] = (counts[k] || 0) + 1; });
console.log('moves by kind:', JSON.stringify(counts));
if (rec.hash !== r.hash) {
  const skip = new Set(['tab', 'sub', 'opts', 'toursSeen', 'visited', 'savedAt', 'innSeen', 'revealed']);
  const a = rec.st, b = r.state;
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (skip.has(k)) continue;
    const x = JSON.stringify(a[k]), y = JSON.stringify(b[k]);
    if (x !== y) console.log(`  ${k}:\n    client ${String(x).slice(0, 400)}\n    server ${String(y).slice(0, 400)}`);
  }
}
// find the first move whose before-hash the server doesn't reproduce
if (rec.hash !== r.hash && rec.log[0] && rec.log[0].h) {
  const at = i => E.replay(rec.s0, rec.log.slice(0, i), { at: rec.log[i].t });
  let lo = 0, hi = rec.log.length - 1;
  if (at(hi).hash === rec.log[hi].h) console.log('all before-hashes match; the end differs');
  else {
    while (lo < hi) { const mid = (lo + hi) >> 1; if (at(mid).hash === rec.log[mid].h) lo = mid + 1; else hi = mid; }
    const i = lo;
    console.log(`first difference before move ${i} of ${rec.log.length}`);
    for (let k = Math.max(0, i - 6); k <= Math.min(rec.log.length - 1, i + 1); k++) console.log(`   ${k === i ? '>>' : '  '} #${k} t+${((rec.log[k].t - rec.log[0].t) / 1000).toFixed(1)}s ${rec.log[k].n} ${JSON.stringify(rec.log[k].a)}`);
    globalThis.__probe = { i };
  }
}

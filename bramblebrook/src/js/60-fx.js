/* ---------- sound and motion ----------
   Every sound is synthesised with Web Audio: short, soft, a note or two. Nothing loads from files.
   Motion is CSS: things you gain drift up from where you tapped; big moments get the bell and a bloom of light. */
const FX = { ctx: null, master: null, last: {}, coins: null, coinTween: 0 };
const soundOn = () => !(state && state.opts && state.opts.soundOff);
const volume = () => (state && state.opts && state.opts.volume != null ? state.opts.volume : 0.6);
function audio() {
  if (!soundOn()) return null;
  if (!FX.ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try { FX.ctx = new AC(); } catch (e) { return null; }
    FX.master = FX.ctx.createGain();
    FX.master.gain.value = volume() * 0.85;
    // a short, soft echo gives everything a little room
    const delay = FX.ctx.createDelay(), fb = FX.ctx.createGain(), wet = FX.ctx.createGain(), lp = FX.ctx.createBiquadFilter();
    delay.delayTime.value = 0.13; fb.gain.value = 0.22; wet.gain.value = 0.16; lp.type = 'lowpass'; lp.frequency.value = 2600;
    FX.master.connect(FX.ctx.destination);
    FX.master.connect(delay); delay.connect(lp); lp.connect(fb); fb.connect(delay); lp.connect(wet); wet.connect(FX.ctx.destination);
  }
  if (FX.ctx.state === 'suspended') FX.ctx.resume().catch(() => {});
  return FX.ctx;
}
function setVolume(v) { if (FX.master) FX.master.gain.value = v * 0.85; }
function tone(c, t, f, o = {}) {
  const osc = c.createOscillator(), g = c.createGain();
  osc.type = o.type || 'sine';
  osc.frequency.setValueAtTime(f, t);
  if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t + (o.glide || o.dur || 0.15));
  const v = o.vol == null ? 0.25 : o.vol, dur = o.dur || 0.18;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(v, t + (o.attack || 0.004));
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g); g.connect(FX.master);
  osc.start(t); osc.stop(t + dur + 0.05);
}
function noise(c, t, o = {}) {
  const dur = o.dur || 0.1, buf = c.createBuffer(1, Math.ceil(c.sampleRate * dur), c.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
  src.buffer = buf; f.type = o.type || 'bandpass'; f.frequency.setValueAtTime(o.f || 1800, t); f.Q.value = o.q || 0.8;
  if (o.to) f.frequency.exponentialRampToValueAtTime(o.to, t + dur);
  g.gain.setValueAtTime(o.vol || 0.12, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f); f.connect(g); g.connect(FX.master); src.start(t);
}
const pluck = (c, t, f, v = 0.22) => { tone(c, t, f, { vol: v, dur: 0.28 }); tone(c, t, f * 4, { vol: v * 0.12, dur: 0.08 }); };
const NOTE = { C5: 523.25, D5: 587.33, E5: 659.25, G5: 783.99, A5: 880, C6: 1046.5, E6: 1318.5, G6: 1568, A4: 440, G4: 392, E4: 329.63, C4: 261.63, G3: 196 };
const SOUNDS = {
  tick: (c, t) => tone(c, t, 1800, { vol: 0.035, dur: 0.03, type: 'triangle' }),
  voice: (c, t) => tone(c, t, 330 * (FX.voicePitch || 1) * (0.92 + Math.random() * 0.16), { vol: 0.022, dur: 0.04, type: 'triangle' }),
  page: (c, t) => noise(c, t, { f: 3200, type: 'highpass', vol: 0.05, dur: 0.05 }),
  sow: (c, t) => { noise(c, t, { f: 500, type: 'lowpass', vol: 0.16, dur: 0.09 }); tone(c, t + 0.01, 160, { vol: 0.1, dur: 0.1, to: 110 }); },
  harvest: (c, t) => { pluck(c, t, NOTE.G4); pluck(c, t + 0.07, NOTE.C5); },
  pick: (c, t) => pluck(c, t, NOTE.E5, 0.16),
  rustle: (c, t) => { noise(c, t, { f: 2400, vol: 0.07, dur: 0.12, to: 1400 }); pluck(c, t + 0.05, NOTE.A4, 0.1); },
  sparkle: (c, t) => [NOTE.E6, NOTE.G6, NOTE.C6 * 2].forEach((f, i) => tone(c, t + i * 0.05, f, { vol: 0.11, dur: 0.22, type: 'triangle' })),
  thud: (c, t) => { noise(c, t, { f: 380, type: 'lowpass', vol: 0.22, dur: 0.1 }); tone(c, t, 120, { vol: 0.14, dur: 0.12, to: 70 }); },
  stairs: (c, t) => [NOTE.C5, NOTE.G4, NOTE.E4].forEach((f, i) => pluck(c, t + i * 0.09, f, 0.15)),
  coins: (c, t) => { tone(c, t, NOTE.E6, { vol: 0.13, dur: 0.16, type: 'triangle' }); tone(c, t + 0.06, NOTE.A5 * 2, { vol: 0.11, dur: 0.22, type: 'triangle' }); },
  knock: (c, t) => { tone(c, t, 310, { vol: 0.18, dur: 0.07, type: 'triangle' }); tone(c, t + 0.09, 250, { vol: 0.14, dur: 0.08, type: 'triangle' }); },
  clink: (c, t) => { tone(c, t, 2100, { vol: 0.07, dur: 0.25 }); tone(c, t + 0.01, 3150, { vol: 0.04, dur: 0.2 }); },
  chime: (c, t) => [NOTE.C5, NOTE.E5, NOTE.G5].forEach((f, i) => pluck(c, t + i * 0.07, f, 0.14)),
  heart: (c, t) => { tone(c, t, NOTE.E5, { vol: 0.12, dur: 0.2 }); tone(c, t + 0.12, NOTE.A5, { vol: 0.12, dur: 0.32 }); },
  level: (c, t) => [NOTE.C5, NOTE.E5, NOTE.G5, NOTE.C6].forEach((f, i) => pluck(c, t + i * 0.075, f, 0.15)),
  feat: (c, t) => { [NOTE.G5, NOTE.C6, NOTE.E6].forEach((f, i) => tone(c, t + i * 0.06, f, { vol: 0.11, dur: 0.3, type: 'triangle' })); },
  cast: (c, t) => { noise(c, t, { f: 900, type: 'bandpass', vol: 0.16, dur: 0.22, to: 3500 }); noise(c, t + 0.22, { f: 700, type: 'lowpass', vol: 0.14, dur: 0.12 }); },
  bite: (c, t) => tone(c, t, 620, { vol: 0.16, dur: 0.14, to: 260, glide: 0.12 }),
  catch: (c, t) => { noise(c, t, { f: 1200, vol: 0.08, dur: 0.12 }); [NOTE.G4, NOTE.C5, NOTE.E5].forEach((f, i) => pluck(c, t + 0.04 + i * 0.06, f, 0.15)); },
  bigcatch: (c, t) => { noise(c, t, { f: 1000, vol: 0.1, dur: 0.16 }); [NOTE.C5, NOTE.E5, NOTE.G5, NOTE.C6, NOTE.E6].forEach((f, i) => pluck(c, t + 0.04 + i * 0.06, f, 0.14)); },
  miss: (c, t) => { tone(c, t, 330, { vol: 0.07, dur: 0.16, type: 'triangle' }); tone(c, t + 0.1, 262, { vol: 0.06, dur: 0.22, type: 'triangle' }); },
  dice: (c, t) => { for (let i = 0; i < 7; i++) tone(c, t + i * 0.07 + Math.random() * 0.02, 900 + Math.random() * 700, { vol: 0.05, dur: 0.035, type: 'triangle' }); noise(c, t + 0.5, { f: 1600, vol: 0.06, dur: 0.05 }); },
  crit: (c, t) => { [NOTE.C5, NOTE.G5, NOTE.C6, NOTE.E6, NOTE.G6].forEach((f, i) => pluck(c, t + i * 0.06, f, 0.14)); tone(c, t + 0.3, NOTE.C6 * 2, { vol: 0.06, dur: 0.6, type: 'triangle' }); },
  fumble: (c, t) => { tone(c, t, 392, { vol: 0.1, dur: 0.14, type: 'triangle' }); tone(c, t + 0.13, 330, { vol: 0.09, dur: 0.14, type: 'triangle' }); tone(c, t + 0.26, 220, { vol: 0.1, dur: 0.35, to: 160, glide: 0.3, type: 'triangle' }); },
  // the Bramble Bell: a low bell with uneven partials and a long, soft tail
  bell: (c, t) => {
    const f = NOTE.G3;
    [[1, 0.2, 3.2], [2, 0.12, 2.4], [2.76, 0.08, 1.8], [5.4, 0.04, 1.1], [8.93, 0.02, 0.7]].forEach(([m, v, d]) => tone(c, t, f * m, { vol: v, dur: d, attack: 0.008 }));
  },
};
function play(name, delay = 0) {
  if (!soundOn()) return;
  const c = audio();
  if (!c || !SOUNDS[name]) return;
  const nowMs = performance.now();
  if (FX.last[name] && nowMs - FX.last[name] < 70) return;   // no machine-gun repeats
  FX.last[name] = nowMs;
  try { SOUNDS[name](c, c.currentTime + 0.01 + delay); } catch (e) { /* audio is a nicety; never break play */ }
}

/* Motion helpers */
const reducedMotion = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
function floatAt(rect, html, i = 0) {
  if (!rect || reducedMotion() || !rect.width) return;
  const el = document.createElement('div');
  el.className = 'fx-float';
  el.innerHTML = html;
  el.style.left = (rect.left + rect.width / 2 + (i - 1) * 26) + 'px';
  el.style.top = (rect.top + Math.min(rect.height / 2, 40)) + 'px';
  el.style.animationDelay = (i * 70) + 'ms';
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1300 + i * 70);
}
function pulse(el) {
  if (!el || reducedMotion()) return;
  el.classList.remove('fx-pulse'); void el.offsetWidth; el.classList.add('fx-pulse');
}
function bloom() {
  if (reducedMotion()) return;
  const el = document.createElement('div');
  el.className = 'fx-bloom';
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1700);
}
function ripple(host) {
  if (!host || reducedMotion()) return;
  const b = host.querySelector('.bobber');
  const r = document.createElement('span');
  r.className = 'fx-ripple';
  if (b) { r.style.left = b.offsetLeft + 13 + 'px'; r.style.top = b.offsetTop + 13 + 'px'; }
  host.appendChild(r);
  setTimeout(() => r.remove(), 900);
}
/* Coins count up to their new value instead of jumping. */
function showCoins(v) {
  const el = $('#coins');
  if (!el) return;
  if (FX.coins == null || reducedMotion() || Math.abs(v - FX.coins) < 2) { FX.coins = v; el.textContent = fmtShort(v); el.title = fmtN(v) + ' coins'; return; }
  const from = FX.coins, start = performance.now(), dur = 420;
  if (v > from) pulse($('.coin'));
  FX.coins = v;
  cancelAnimationFrame(FX.coinTween);
  const stepFn = ts => {
    const k = Math.min(1, (ts - start) / dur), e = 1 - Math.pow(1 - k, 3);
    el.textContent = fmtShort(Math.round(from + (v - from) * e)); el.title = fmtN(v) + ' coins';
    if (k < 1) FX.coinTween = requestAnimationFrame(stepFn);
  };
  FX.coinTween = requestAnimationFrame(stepFn);
}

/* After any action: compare before and after, then play and show what changed. */
function fxSnap(el) {
  return { rect: el && el.getBoundingClientRect ? el.getBoundingClientRect() : null, inv: Object.assign({}, state.inv), over: Object.assign({}, state.overflow), coins: state.coins, stairs: state.mine.stairs, planted: state.plots.filter(p => p.crop).length };
}
const ACT_SOUND = {
  plot: 'harvest', 'harvest-all': 'harvest', 'sow-all': 'sow', explore: 'rustle', dig: 'thud', descend: 'stairs', lift: 'stairs',
  craft: 'knock', cook: 'knock', 'bench-collect': 'knock', 'bench-queue': 'knock', eat: 'pick',
  sell: 'coins', 'sell-type': 'coins', 'ex-sell': 'coins', 'saffi-sell': 'coins', 'saffi-buy': 'coins', buy: 'coins', 'buy-plot': 'sow', 'buy-barn': 'knock', 'buy-animal': 'heart',
  deliver: 'chime', 'fest-deliver': 'chime', chore: 'chime', 'chore-bonus': 'chime', 'login-claim': 'chime', 'letter-gift': 'chime',
  'gift-pick': 'heart', chat: 'pick', heart: 'heart', collect: 'pick', 'collect-all': 'pick', pet: 'heart', 'pet-pen': 'heart', 'pet-one': 'heart', tree: 'pick', 'harvest-trees': 'pick',
  'plant-tree': 'sow', 'net-set': 'cast', 'net-collect': 'catch', 'cask-fill': 'knock', 'cask-bottle': 'clink', 'pet-collect': 'pick', 'pet-feed': 'heart', 'pet-adopt': 'heart',
  perk: 'sparkle', install: 'knock', 'charm-on': 'clink', 'charm-off': 'tick', tonic: 'sparkle', 'take-overflow': 'pick', 'fest-buy': 'coins',
};
function fxAfter(act, el, snap) {
  if (!snap) return;
  const gained = [];
  for (const id of new Set([...Object.keys(state.inv), ...Object.keys(state.overflow || {})])) {
    const d = (state.inv[id] || 0) + ((state.overflow || {})[id] || 0) - (snap.inv[id] || 0) - (snap.over[id] || 0);
    if (d > 0) gained.push([id, d]);
  }
  let sound = ACT_SOUND[act];
  if (act === 'plot') sound = state.plots.filter(p => p.crop).length > snap.planted ? 'sow' : gained.length ? 'harvest' : null;
  if (act === 'explore' || act === 'dig') {
    const a = I.area[state.area];
    const rare = gained.some(([id]) => (act === 'explore' ? (a.drops[id] || 99) : (mineBand(state.mine.floor).drops[id] || (id === 'starshard' ? 1 : 99))) < 3);
    if (rare) play('sparkle', 0.08);
    if (act === 'dig' && !snap.stairs && state.mine.stairs) play('stairs', 0.12);
  }
  if (sound && (gained.length || state.coins !== snap.coins || !['plot', 'explore', 'dig'].includes(act))) play(sound);
  gained.sort((a, b) => b[1] - a[1]).slice(0, 3).forEach(([id, n], i) => floatAt(snap.rect, `${pic(id, 24)}<span>+${fmtN(n)}</span>`, i));
  if (!gained.length && state.coins > snap.coins) floatAt(snap.rect, `<span class="coin"></span><span>+${fmtShort(state.coins - snap.coins)}</span>`);
  if (act === 'plot' || act === 'sow-all') requestAnimationFrame(() => $$('.plot .sprout').forEach(s => { if (s.closest('.plot').dataset.stage === '1') s.classList.add('fx-sow'); }));
}

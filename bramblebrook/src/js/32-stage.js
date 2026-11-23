/* ---------- story stage: a moonlit backdrop, the cast walking on, emotes, and text that types itself ---------- */
// where each person is found, and what each place looks like: "biome:building" (building is optional)
const STAGE_HOME = {
  oakley: 'town:Chieftains_Hall', hazel: 'farm:Village_Home_1', tobin: 'river:docks', mira: 'town:blacksmiths',
  clem: 'town:Village_Home_2', pip: 'meadow:Village_Home_3', rook: 'coast:viking_watch_tower', ingrid: 'highlands:longhouse',
  wren: 'highlands:Village_Home_4', saffi: 'town:Carpenters_Workshop', tess: 'town:longhouse',
};
const STAGE_PLACE = {
  farm: 'farm:Village_Home_1', meadow: 'meadow:', woods: 'woods:', banks: 'river:docks', river: 'river:Boat_Builders_Workshop',
  cove: 'coast:docks', beach: 'coast:', quarry: 'quarry:Stone_Masons_Workshop', highlands: 'highlands:viking_watch_tower',
  tarn: 'highlands:', pasture: 'meadow:Village_Home_4', mine: 'mine:', town: 'town:Village_Home_5',
};
const STAGE_SLOTS = [60, 77, 92];   // where villagers stand, % across; you stand at 17%
let stg = null;                     // { key, cast: { id: { el, x } }, used, last }
let stageSerial = 0;
let typing = null;

function stagePlace(where, lines) {
  const w = [].concat(where || []);
  const here = w.find(p => p === state.area) || w[0];
  if (here && STAGE_PLACE[here]) return STAGE_PLACE[here];
  const first = (lines || []).find(l => l && l.who && STAGE_HOME[l.who]);
  return first ? STAGE_HOME[first.who] : 'town:Village_Home_5';
}
function newStage(place) { return { key: 'st' + (++stageSerial), place }; }
function stageHTML(place) {
  const [biome, bld] = place.split(':');
  const sm = C.art && C.art.stage;
  const i = sm && bld && sm.map[bld] != null ? sm.map[bld] : -1;
  return `<div class="stage" data-biome="${biome}" aria-hidden="true"><div class="st-stars"></div><div class="st-far"></div>
    ${i >= 0 ? `<div class="st-bld" style="--i:${i};--n:${sm.count}"></div>` : ''}<div class="st-ground"></div><div class="st-cast"></div></div>`;
}
/* Mount a fresh stage after its scene has been drawn: you walk on from the left, any companion from the right. */
function mountStage(st, extras = []) {
  stg = { key: st.key, cast: {}, used: 0, last: null };
  if (state.face) addActor('you');
  extras.forEach(id => addActor(id));
}

/* Actors: the bought villager sheets, standing frame and a three-frame side walk (played 0-1-2-1). */
function actorBase(id) { return id === 'you' ? (state.face ? 'face:' + state.face : '') : (I.art['folk:' + id] ? id : ''); }
function setFrame(el, id, f) {
  const b = actorBase(id);
  const stand = id === 'you' ? b : 'folk:' + b;
  const a = (f >= 0 && I.art[`walk:${b}:${f}`]) || I.art[stand];
  if (a) { el.style.setProperty('--c', a[0]); el.style.setProperty('--r', a[1]); }
}
function addActor(id) {
  if (!stg || stg.cast[id] || !actorBase(id)) return null;
  const cast = $('#scene-root .st-cast');
  if (!cast) return null;
  const mine = id === 'you';
  if (!mine && stg.used >= STAGE_SLOTS.length) return null;
  const x = mine ? 17 : STAGE_SLOTS[stg.used++];
  const el = document.createElement('div');
  el.className = 'actor' + (mine ? ' from-left' : '');
  el.dataset.who = id;
  el.innerHTML = '<span class="st-shadow"></span><span class="st-body"><i class="px" style="--s:64px;--h:1"></i></span><span class="st-emote"></span>';
  const spr = el.querySelector('.px');
  stg.cast[id] = { el, x };
  cast.appendChild(el);
  if (reducedMotion()) { el.style.left = x + '%'; setFrame(spr, id, -1); return el; }
  el.style.left = (mine ? -10 : 110) + '%';
  el.classList.add('walking');
  const seq = [0, 1, 2, 1];
  let f = 0;
  setFrame(spr, id, 0);
  const timer = setInterval(() => { if (!el.isConnected) { clearInterval(timer); return; } setFrame(spr, id, seq[++f % 4]); }, 130);
  let done = false;
  const arrive = () => { if (done) return; done = true; clearInterval(timer); el.classList.remove('walking'); setFrame(spr, id, -1); };
  el.addEventListener('transitionend', arrive, { once: true });
  setTimeout(arrive, 1100);
  requestAnimationFrame(() => requestAnimationFrame(() => { el.style.left = x + '%'; }));
  return el;
}

/* Who is talking: they hop and may show a bubble; everyone else listens a little dimmer. */
function emoteFor(line) {
  if (line.emote) return line.emote;
  const s = (line.say || '').trim();
  if (/^(\.\.\.|…)|(\.\.\.|…)$/.test(s)) return 'dots';
  if (/\b(love|dear heart|sweetheart|bless you)/i.test(s)) return 'heart';
  if (/\b(thank|ha!|haha|hah\b|hooray|wonderful|splendid|marvell?ous)/i.test(s)) return 'happy';
  if (/\b(sorry|alas|i miss|gone now|lonely)\b/i.test(s)) return 'sad';
  if (/\?$/.test(s)) return 'ask';
  if (/!$/.test(s) && s.length < 70) return 'bang';
  return '';
}
function stageLine(who, line) {
  if (!stg) return;
  const root = $('#scene-root .stage');
  if (!root) return;
  if (who && !stg.cast[who]) addActor(who);
  for (const [id, a] of Object.entries(stg.cast)) {
    a.el.classList.toggle('quiet', id !== who);
    a.el.classList.remove('talk');
    a.el.querySelector('.st-emote').innerHTML = '';
  }
  root.classList.toggle('narrating', !who);
  const a = who && stg.cast[who];
  if (a) { const m = $('#scene-root .scene-body .speaker .mono'); if (m) m.remove(); }
  const changed = stg.last !== who;
  stg.last = who || null;
  if (!a) return;
  void a.el.offsetWidth;   // restart the hop
  a.el.classList.add('talk');
  const e = line ? emoteFor(line) : '';
  if (e && I.art['emote:' + e] && (changed || line.emote || e === 'heart' || e === 'sad' || e === 'happy')) a.el.querySelector('.st-emote').innerHTML = artCell('emote:' + e, 32);
}
const onStage = id => !!(stg && stg.cast[id]);

/* Typewriter: the whole line is laid out invisibly first so the card never jumps as it fills. */
function voicePitch(who) {
  if (!who) return 1;
  if (who === 'you') return 1.05;
  let h = 0;
  for (const ch of who) h = (h * 31 + ch.charCodeAt(0)) % 997;
  return 0.78 + (h % 50) / 100;
}
function typeLine(el, text, who, onDone) {
  stopTyping();
  el.innerHTML = `<span class="say-ghost">${esc(text)}</span><span class="say-live"></span>`;
  const live = el.querySelector('.say-live');
  if (reducedMotion() || (state.opts && state.opts.instantText)) { live.textContent = text; if (onDone) onDone(); return; }
  FX.voicePitch = voicePitch(who);
  let i = 0, next = 0;
  const step = t => {
    if (!typing || !live.isConnected) { typing = null; return; }
    if (!next) next = t;
    let spoke = false;
    while (t >= next && i < text.length) {
      i++;
      const ch = text[i - 1];
      next += /[.!?…]/.test(ch) && /\s/.test(text[i] || ' ') ? 170 : /[,;:—]/.test(ch) ? 80 : 16;
      if (!spoke && who && /[a-z]/i.test(ch)) { play('voice'); spoke = true; }
    }
    live.textContent = text.slice(0, i);
    if (i >= text.length) { const d = typing.onDone; typing = null; if (d) d(); return; }
    typing.raf = requestAnimationFrame(step);
  };
  typing = { live, text, onDone, raf: requestAnimationFrame(step) };
}
function finishTyping() {
  if (!typing) return false;
  const t = typing;
  typing = null;
  cancelAnimationFrame(t.raf);
  t.live.textContent = t.text;
  if (t.onDone) t.onDone();
  return true;
}
function stopTyping() { if (typing) { cancelAnimationFrame(typing.raf); typing = null; } }

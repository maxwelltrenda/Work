/* ---------- story, scenes and adventures ---------- */

/* Main story */
const curChapter = () => I.chapters[state.story.ci] || null;
function chapterLabel(ci) {
  const ch = I.chapters[ci];
  if (!ch) return '';
  return ch.id === 'prologue' ? 'Prologue' : ch.id === 'epilogue' ? 'Epilogue' : `Chapter ${ci}`;
}
function curStep() { const ch = curChapter(); return ch && state.story.started ? ch.steps[state.story.si] || null : null; }
const autoStep = s => ['gather', 'stat', 'level', 'mine', 'adventure'].includes(s.type);
function setStepBase() {
  const s = curStep();
  state.story.base = !s ? 0 : s.type === 'gather' ? (state.got[s.item] || 0) : s.type === 'stat' ? (state.stats[s.stat] || 0) : 0;
}
function stepProgress(s) {
  switch (s.type) {
    case 'gather': return [Math.max(0, (state.got[s.item] || 0) - state.story.base), s.n];
    case 'stat': return [Math.max(0, (state.stats[s.stat] || 0) - state.story.base), s.n];
    case 'level': return [lvl(s.skill), s.lvl];
    case 'mine': return [state.mine.deepest, s.floor];
    case 'adventure': return [state.advDone[s.id] ? 1 : 0, 1];
    case 'deliver': { const w = Object.entries(s.want); return [w.filter(([id, n]) => have(id) >= n).length, w.length]; }
    default: return [0, 1];
  }
}
function stepReady(s) {
  if (autoStep(s)) { const [a, b] = stepProgress(s); return a >= b; }
  if (s.type === 'deliver') return hasAll(s.want);
  return true;
}
function beginChapter() {
  const ch = curChapter();
  if (!ch || state.story.started) return;
  playScene(ch.intro, { title: `${chapterLabel(state.story.ci)} · ${ch.n}`, onDone: () => { state.story.started = true; setStepBase(); toast(`Story: ${fill(ch.steps[0].t)}`); commit(); } });
}
function advanceStory() {
  const ch = curChapter(), s = curStep();
  if (!s) return;
  const lines = applyGive(s.give);
  if (lines.length) toast(lines.join(' · '));
  state.story.si++;
  if (state.story.si >= ch.steps.length) finishChapter();
  else { setStepBase(); toast(`Story: ${fill(ch.steps[state.story.si].t)}`); }
}
function finishChapter() {
  const ch = curChapter();
  const rewards = applyGive(ch.give);
  state.story.done[ch.id] = now();
  play('bell', 0.2); bloom();
  gainInsp(1, 'a chapter finished');
  state.story.queue.push({ title: `${ch.n} · Chapter complete`, lines: ch.outro, rewards });
  state.story.ci++; state.story.si = 0; state.story.started = false; state.story.base = 0;
  toast(`Chapter complete: ${ch.n}`, 'lvl', 4500);
}
function storyCheck() {
  for (let guard = 0; guard < 12; guard++) {
    const s = curStep();
    if (!s || !autoStep(s) || !stepReady(s)) break;
    if (s.scene) state.story.queue.push({ title: fill(s.t), lines: s.scene });
    advanceStory();
  }
}
function storyAction() {
  if (state.story.queue.length) return playQueue();
  const ch = curChapter();
  if (!ch) return openJournal();
  if (!state.story.started) return beginChapter();
  const s = curStep();
  if (!s) return openJournal();
  if (s.type === 'talk') {
    closeSheet();
    playScene(s.scene, { title: fill(s.t), onDone: () => { advanceStory(); commit(); } });
    return;
  }
  if (s.type === 'deliver') {
    if (!hasAll(s.want)) return openJournal();
    closeSheet();
    takeAll(s.want);
    advanceStory();
    commit();
    playScene(s.scene || [{ who: s.to, say: 'Thank you, {name}. This means a great deal.' }], { title: fill(s.t) });
    return;
  }
  if (s.type === 'adventure') {
    const a = I.adv[s.id];
    if (a && reqMet(a.req)) { closeSheet(); startQuest(a); return; }
  }
  openJournal();
}
function playQueue() {
  const q = state.story.queue.splice(0);
  commit();
  closeSheet();
  q.forEach(item => playScene(item.lines, { title: item.title, rewards: item.rewards }));
}
/* What the story wants right now, for banners and badges. */
function storyStatus() {
  if (state.story.queue.length) return { kind: 'queue', title: 'Something happened', text: state.story.queue[0].title, btn: 'Read', ready: true };
  const ch = curChapter();
  if (!ch) return { kind: 'end', title: 'The Bell rings on', text: 'The story is complete. The valley keeps growing.', btn: 'Journal', ready: false };
  if (!state.story.started) return { kind: 'begin', title: `${chapterLabel(state.story.ci)} · ${ch.n}`, text: ch.blurb, btn: 'Begin', ready: true };
  const s = curStep();
  const [a, b] = stepProgress(s);
  if (s.type === 'talk') return { kind: 'talk', title: ch.n, text: fill(s.t), btn: `Talk to ${vilShort(s.to)}`, ready: true, who: s.to };
  if (s.type === 'deliver') {
    const ok = hasAll(s.want);
    return { kind: 'deliver', title: ch.n, text: fill(s.t), btn: ok ? 'Give items' : 'See what is needed', ready: ok, who: s.to, want: s.want };
  }
  if (s.type === 'adventure') {
    const adv = I.adv[s.id];
    const ok = adv && reqMet(adv.req);
    return { kind: 'adventure', title: ch.n, text: fill(s.t), btn: ok ? 'Set out' : 'Journal', ready: !!ok };
  }
  return { kind: 'progress', title: ch.n, text: fill(s.t), progress: [Math.min(a, b), b], btn: 'Journal', ready: false };
}

/* Scene player: one line at a time, portrait and name, optional flavor choices at the end. */
const sceneQ = [];
let sceneOpen = false;
function playScene(lines, opts = {}) {
  sceneQ.push({ lines: (lines || []).filter(Boolean), opts });
  if (!sceneOpen && !advRun) nextScene();
}
function nextScene() {
  const s = sceneQ.shift();
  stopTyping();
  if (!s) { sceneOpen = false; stg = null; $('#scene-root').innerHTML = ''; renderAll(); flushToasts(); return; }
  if (s.adv) { sceneOpen = false; stg = null; $('#scene-root').innerHTML = ''; startAdventure(s.adv, s.isEnc, s.companion); return; }
  sceneOpen = true;
  holdToasts();
  const lines = s.lines.slice();
  if (!lines.length) lines.push({ say: '…' });
  const st = newStage(stagePlace(s.opts.where, lines));
  const opts = { ...s.opts, stage: st };
  let i = 0;
  const show = inner => { if (renderScene(opts, inner)) mountStage(st); };
  const draw = () => {
    const l = lines[i];
    const last = i === lines.length - 1;
    if (l.choices) {
      show(`<div class="choices">${l.choices.map((c, j) => `<button class="choice" data-scene-choice="${j}">${esc(fill(c.t))}</button>`).join('')}</div>`);
      stageLine('you', null);
      $$('[data-scene-choice]').forEach(b => b.addEventListener('click', () => {
        const c = l.choices[+b.dataset.sceneChoice];
        lines.splice(i, 1, ...(c.reply && c.reply.length ? c.reply : [{ who: 'you', say: c.t }]));
        play('tick');
        draw();
      }));
      focusScene();
      return;
    }
    const who = l.who;
    const rewards = last && s.opts.rewards && s.opts.rewards.length ? `<div class="row">${s.opts.rewards.map(r => `<span class="chip plain gold">${esc(r)}</span>`).join('')}</div>` : '';
    show(`${speakerHead(who)}<div class="say ${who ? (who === 'you' ? 'you' : '') : 'narration'}" data-scene-next></div>${rewards}
      <div class="scene-foot"><span class="progress-dots">${lines.length > 1 ? lines.map((_, j) => `<i class="${j <= i ? 'on' : ''}"></i>`).join('') : ''}</span>
      <button class="btn" data-scene-next>${last ? 'Done' : 'Next'}</button></div>`);
    stageLine(who, l);
    typeLine($('#scene-root .say'), fill(l.say), who);
    $$('#scene-root [data-scene-next]').forEach(b => b.addEventListener('click', () => {
      if (finishTyping()) return;   // the first tap finishes the line, the next one moves on
      if (i < lines.length - 1) { i++; play('page'); draw(); return; }
      if (s.opts.onDone) s.opts.onDone();
      nextScene();
    }));
    const stage = $('#scene-root .stage');
    if (stage && !stage.dataset.tap) { stage.dataset.tap = 1; stage.addEventListener('click', () => { const n = $('#scene-root .scene-foot [data-scene-next]'); if (n) n.click(); }); }
    focusScene();
  };
  draw();
}
/* The name over a line: the portrait only when that person isn't standing on the stage. */
function speakerHead(who) {
  if (!who) return '';
  if (who === 'you') return `<div class="speaker"><div><b>${esc(state.name || 'You')}</b><small>You</small></div></div>`;
  const standing = onStage(who) || (stg && actorBase(who) && stg.used < STAGE_SLOTS.length);
  return `<div class="speaker">${standing ? '' : folk(who, 48)}<div><b>${esc(vilName(who))}</b><small>${esc((I.vil[who] || {}).role || '')}</small></div></div>`;
}
function sceneShell(opts, inner) {
  const again = !!$('#scene-root .scene-wrap');   // only the first card of a scene slides up
  const st = opts.stage;
  return `<div class="scene-wrap${again ? ' again' : ''}"${st ? ` data-stage="${st.key}"` : ''}><div class="scene${st ? ' staged' : ''}" role="dialog" aria-modal="true" aria-label="${esc(opts.title || 'Story')}">${st ? stageHTML(st.place) : ''}<div class="scene-body">${opts.title ? `<div class="scene-title">${esc(fill(opts.title))}</div>` : ''}${inner}</div></div></div>`;
}
/* Draws a scene card. A card for the stage already showing keeps that stage and its cast; returns true when the stage is new. */
function renderScene(opts, inner) {
  const st = opts.stage, wrap = $('#scene-root .scene-wrap');
  if (st && wrap && wrap.dataset.stage === st.key) {
    wrap.querySelector('.scene-body').innerHTML = `${opts.title ? `<div class="scene-title">${esc(fill(opts.title))}</div>` : ''}${inner}`;
    return false;
  }
  $('#scene-root').innerHTML = sceneShell(opts, inner);
  return !!st;
}
function focusScene() { const b = $('#scene-root .scene .btn, #scene-root .choice'); if (b) b.focus({ preventScroll: true }); }

/* Adventures and encounters: a graph of nodes with choices, requirements, costs and chance rolls. */
let advRun = null;
function playAdventure(def, isEnc, companion) {
  if (advRun || !def) return;
  if (sceneOpen) { sceneQ.push({ adv: def, isEnc, companion }); return; }
  startAdventure(def, isEnc, companion);
}
function startAdventure(def, isEnc, companion) {
  holdToasts();
  advRun = { def, isEnc, cur: null, given: new Set(), rewards: [], last: '', companion: companion || '', joined: false, stage: newStage(def.floor ? 'mine:' : stagePlace(def.where || (isEnc ? state.area : 'town'))) };
  play(isEnc ? 'pick' : 'page');
  enterNode(def.start);
}
function rollChance(r) { return clamp(r.base + (r.per || 0) * lvl(r.skill), 0.02, r.max || 0.95); }
function enterNode(id) {
  const n = advRun.def.nodes[id];
  if (!n) { finishAdventure(); return; }
  advRun.cur = id;
  if (n.give && !advRun.given.has(id)) { advRun.given.add(id); advRun.rewards.push(...applyGive(n.give)); }
  drawAdventure();
}
function drawAdventure() {
  const { def, isEnc, cur } = advRun;
  const n = def.nodes[cur];
  const speaker = speakerHead(n.who);
  const title = isEnc ? 'Something happens…' : def.n;
  let body = `${speaker}<div class="say${n.who ? '' : ' narration'}"></div>`;
  if (advRun.companion && !advRun.joined) {
    advRun.joined = true;
    const cj = C.companions.companions[advRun.companion];
    if (cj && cj.join) body = `<p class="dice-quip">${folk(advRun.companion, 28)}<i>“${esc(fill(cj.join))}”</i></p>` + body;
  }
  if (advRun.last) body = `<p class="muted" style="font-size:13px">${esc(advRun.last)}</p>` + body;
  if (n.end) {
    const won = n.end === 'win';
    body += `<div class="card" style="gap:8px"><b>${won ? (isEnc ? 'Done' : 'Adventure complete') : 'Not this time'}</b>
      ${advRun.rewards.length ? `<div class="row">${advRun.rewards.map(r => `<span class="chip plain gold">${esc(r)}</span>`).join('')}</div>` : ''}
      ${!won && !isEnc ? '<p class="sub">You can try this adventure again later.</p>' : ''}</div>
      <button class="btn big" data-adv-done>${won ? 'Done' : 'Head home'}</button>`;
  } else {
    body += `<div class="choices later">${n.ch.map((c, i) => {
      const probs = reqProblems(c.req), costs = costProblems(c.cost);
      const notes = [];
      if (probs.length) notes.push('Needs ' + probs.join(', '));
      if (c.cost) notes.push('Costs ' + costText(c.cost) + (costs.length ? ` (you're short)` : ''));
      if (c.roll) { const ck = checkFor(c.roll); notes.push(`🎲 ${skillName(ck.sk)} roll: need ${ck.dc} or more · ${Math.round(chanceOf(ck) * 100)}% chance${ck.adv ? ` · ${ck.adv === 'Lucky' ? 'feeling lucky' : esc(ck.adv) + ' helps'}: best of two dice` : ''}`); }
      return `<button class="choice" data-adv-choice="${i}" ${probs.length || costs.length ? 'disabled' : ''}>${esc(fill(c.t))}${notes.length ? `<small>${esc(notes.join(' · '))}</small>` : ''}</button>`;
    }).join('')}</div>
    ${isEnc ? '' : '<div class="scene-foot"><span></span><button class="btn small ghost" data-adv-leave>Leave for now</button></div>'}`;
  }
  if (renderScene({ title, stage: advRun.stage }, body)) mountStage(advRun.stage, advRun.companion ? [advRun.companion] : []);
  stageLine(n.who || null, n);
  const reveal = () => {
    const ch = $('#scene-root .choices.later');
    if (ch) ch.classList.remove('later');
    if (!n.end && n.ch.some(c => c.roll)) setTimeout(() => $('#scene-root .choice small') && !$('#scene-root .d20') && maybeTourNow('dice-choice'), 150);
  };
  typeLine($('#scene-root .say'), fill(n.say), n.who, reveal);
  { const sy = $('#scene-root .say'); if (sy) sy.addEventListener('click', finishTyping); const sg = $('#scene-root .stage'); if (sg) sg.onclick = finishTyping; }
  $$('[data-adv-choice]').forEach(b => b.addEventListener('click', () => chooseAdv(+b.dataset.advChoice)));
  const d = $('[data-adv-done]'); if (d) d.addEventListener('click', finishAdventure);
  const l = $('[data-adv-leave]'); if (l) l.addEventListener('click', () => { stopTyping(); advRun = null; stg = null; $('#scene-root').innerHTML = ''; commit(); if (sceneQ.length) nextScene(); });
  focusScene();
}
function chooseAdv(i) {
  const n = advRun.def.nodes[advRun.cur];
  const c = n.ch[i];
  if (!c || reqProblems(c.req).length || costProblems(c.cost).length) return;
  payCost(c.cost);
  if (c.give) advRun.rewards.push(...applyGive(c.give));
  advRun.last = '';
  if (c.roll) { showDice(c, checkFor(c.roll), ok => enterNode(ok ? c.go : c.fail)); return; }
  play('page');
  enterNode(c.go);
}
function finishAdventure() {
  const { def, isEnc, cur } = advRun;
  const n = def.nodes[cur] || {};
  if (isEnc) { if (def.once && (n.end === 'win' || !def.creature)) state.encDone[def.id] = now(); }
  else if (def.floor) { if (n.end === 'win' && !state.delvesDone[def.id]) { state.delvesDone[def.id] = now(); toast(`Delve complete: ${def.n}`, 'lvl'); play('feat'); } }
  else if (n.end === 'win' && !state.advDone[def.id]) { state.advDone[def.id] = now(); toast(`Adventure complete: ${def.n}`, 'lvl'); play('feat'); }
  if (n.end === 'win' && advRun.companion) {
    state.stats.partywins = (state.stats.partywins || 0) + 1;
    addFriend(advRun.companion, 10);
    const cw = C.companions.companions[advRun.companion];
    if (cw && cw.win) toast(`${vilShort(advRun.companion)}: “${fill(cw.win)}”`);
  }
  advRun = null; stg = null; stopTyping();
  $('#scene-root').innerHTML = '';
  commit();
  if (sceneQ.length) nextScene();
}

/* First launch: ask for a name, then open the prologue. */
function askName() {
  if (onlineAvailable() && !online && !askName.skip) {   // on the website: make an account before anything else
    $('#scene-root').innerHTML = sceneShell({ title: 'Bramblebrook' }, `
      <div class="say">A letter came for you, sealed with a pressed clover. Your great-aunt Wren's farm in Bramblebrook is yours now, if you want it.</div>
      <p class="sub">First, make a free account. Your farm saves online, follows you to any device, and lets you team up with other players.</p>
      <div class="choices" id="welcome">
        <button class="btn big" data-act="online-open" data-id="signup">Create an account</button>
        <button class="btn ghost" data-act="online-open" data-id="signin">I already have an account</button>
      </div>
      <p class="sub" style="text-align:center"><button class="linkish" data-act="play-offline">Play without an account</button></p>`);
    return;
  }
  $('#scene-root').innerHTML = sceneShell({ title: 'Bramblebrook' }, `
    <div class="say">A letter came for you, sealed with a pressed clover. Your great-aunt Wren's farm in Bramblebrook is yours now, if you want it.</div>
    <form id="name-form" class="choices">
      <label class="label" for="name-in">What should folks call you?</label>
      <input type="text" id="name-in" maxlength="20" autocomplete="nickname" placeholder="Your name">
      <button class="btn big" type="submit">Head to the valley</button>
    </form>
    <p class="sub" id="name-online" style="text-align:center">${nameOnlineLine()}</p>`);
  $('#name-in').focus();
  $('#name-form').addEventListener('submit', e => {
    e.preventDefault();
    state.name = ($('#name-in').value || '').trim().slice(0, 20) || 'Farmer';
    commit();
    createCharacter(true);
  });
}

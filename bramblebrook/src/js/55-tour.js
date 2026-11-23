/* ---------- guided tours: the screen dims, the thing being explained glows, a card explains it ---------- */
let tour = null;   // { id, steps, i }
const tourDefs = () => (C.tours && C.tours.tours) || {};
const screenKey = () => (state.tab === 'fish' ? 'fish' : `${state.tab}-${sub(state.tab)}`);
function tourReady(id) {
  const t = tourDefs()[id];
  return !!t && (!t.unlock || unlocked(t.unlock));
}
function maybeTour() {
  if (!state || tour || sceneOpen || advRun || !state.name || (state.opts && state.opts.tipsOff)) return;
  if (sheetOpen()) return;
  const id = screenKey();
  if ((state.toursSeen || {})[id] || !tourReady(id)) return;
  if (id === 'farm-fields' && !state.story.started && !chapterDone('prologue')) return;   // wait until the prologue has begun
  startTour(id);
}
function maybeTourNow(id) {
  if (!state || tour || (state.opts && state.opts.tipsOff) || (state.toursSeen || {})[id] || !tourReady(id)) return;
  startTour(id);
}
function maybeSheetTour(id) {
  if (!state || tour || (state.opts && state.opts.tipsOff) || (state.toursSeen || {})[id] || !tourReady(id)) return;
  setTimeout(() => { if (sheetOpen() && !tour) startTour(id); }, 120);
}
function startTour(id) {
  const t = tourDefs()[id];
  if (!t || !t.steps || !t.steps.length) return;
  if (!state.toursSeen) state.toursSeen = {};
  state.toursSeen[id] = now();
  saveLocal();
  tour = { id, steps: t.steps, i: 0 };
  holdToasts();
  document.body.classList.add('touring');
  $('#tour-root').innerHTML = `<div class="tour" role="dialog" aria-modal="true" aria-label="${esc(t.title || 'Tour')}">
    <div class="tour-hole" id="tour-hole"></div>
    <div class="tour-card" id="tour-card"><span class="tour-title" id="tour-title"></span><p id="tour-text"></p>
      <div class="tour-foot"><button class="tour-skip" data-tour-act="skip">Skip tour</button><span class="tour-count" id="tour-count"></span>
      <span class="row" style="gap:6px"><button class="btn small ghost" data-tour-act="back">Back</button><button class="btn small" data-tour-act="next">Next</button></span></div></div></div>`;
  $$('#tour-root [data-tour-act]').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); tourAct(b.dataset.tourAct); }));
  drawTour();
}
function tourTarget(sel) {
  if (!sel) return null;
  for (const s of sel.split(',')) {
    for (const el of $$(s.trim())) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) return el;
    }
  }
  return null;
}
function drawTour() {
  if (!tour) return;
  const step = tour.steps[tour.i];
  $('#tour-title').textContent = fill(step.title || '');
  $('#tour-text').textContent = fill(step.text || '');
  $('#tour-count').textContent = `${tour.i + 1} of ${tour.steps.length}`;
  const back = $('#tour-root [data-tour-act="back"]'), next = $('#tour-root [data-tour-act="next"]');
  back.disabled = tour.i === 0;
  next.textContent = tour.i === tour.steps.length - 1 ? 'Done' : 'Next';
  const el = tourTarget(step.target);
  if (el) el.scrollIntoView({ block: 'center', inline: 'nearest' });
  requestAnimationFrame(() => placeTour(el));
  next.focus({ preventScroll: true });
}
function placeTour(el) {
  const hole = $('#tour-hole'), card = $('#tour-card');
  if (!hole || !card) return;
  const vw = window.innerWidth, vh = window.innerHeight, pad = 6, gap = 14;
  const cw = card.offsetWidth, ch = card.offsetHeight;
  if (!el) {
    hole.classList.add('none');
    card.style.left = Math.max(16, (vw - cw) / 2) + 'px';
    card.style.top = Math.max(16, (vh - ch) / 2) + 'px';
    return;
  }
  hole.classList.remove('none');
  const r = el.getBoundingClientRect();
  const top = Math.max(4, r.top - pad), left = Math.max(4, r.left - pad);
  const bottom = Math.min(vh - 4, r.bottom + pad), right = Math.min(vw - 4, r.right + pad);
  Object.assign(hole.style, { top: top + 'px', left: left + 'px', width: Math.max(0, right - left) + 'px', height: Math.max(0, bottom - top) + 'px' });
  let y;
  if (bottom + gap + ch <= vh - 12) y = bottom + gap;
  else if (top - gap - ch >= 12) y = top - gap - ch;
  else y = vh - ch - 16;
  const x = clamp(r.left + r.width / 2 - cw / 2, 16, Math.max(16, vw - cw - 16));
  card.style.left = x + 'px';
  card.style.top = Math.max(12, y) + 'px';
}
function tourAct(a) {
  if (!tour) return;
  if (a === 'skip') return endTour();
  if (a === 'back' && tour.i > 0) { tour.i--; play('tick'); drawTour(); return; }
  if (a === 'next') {
    play('tick'); if (tour.i < tour.steps.length - 1) { tour.i++; drawTour(); } else endTour(); }
}
function endTour() {
  tour = null;
  document.body.classList.remove('touring');
  $('#tour-root').innerHTML = '';
  window.scrollTo(0, 0);
  commit();
}
function replayTour() {
  const id = sheetOpen() && $('#sheet-root .sheet .steps, #sheet-root .sheet .inv') ? 'journal' : screenKey();
  if (tourReady(id)) startTour(id);
}
window.addEventListener('resize', () => { if (tour) placeTour(tourTarget(tour.steps[tour.i].target)); });
document.addEventListener('keydown', e => {
  if (!tour) return;
  if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); endTour(); }
  else if (e.key === 'ArrowRight') { e.preventDefault(); e.stopImmediatePropagation(); tourAct('next'); }
  else if (e.key === 'ArrowLeft') { e.preventDefault(); e.stopImmediatePropagation(); tourAct('back'); }
  else if (e.key === ' ' && !e.target.closest('button')) { e.preventDefault(); e.stopImmediatePropagation(); }
}, true);

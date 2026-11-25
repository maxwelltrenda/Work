/* ---------- saving, ticking, boot ---------- */
const cloud = { ref: null, ready: false, busy: false, again: false, timer: 0 };
let localTimer = 0;

function commit() {
  setTimeout(flushToasts, 0);
  if (!state) return;
  const before = Object.keys(state.revealed || {}).length;
  settleOnOwn(false);   // storyCheck, checkMail, checkAchievements, checkReveals (99-engine.js)
  if (Object.keys(state.revealed).length !== before) renderTabs();
  state.savedAt = now();
  clearTimeout(localTimer);
  localTimer = setTimeout(saveLocal, 300);
  if (cloud.ready) { clearTimeout(cloud.timer); cloud.timer = setTimeout(saveCloud, 4000); }
  onlineChanged();
  updateHeader();
  renderView();
  updateBadges();
  if (sheetFn && sheetOpen()) $('#sheet-root .sheet').innerHTML = sheetFn();
}
function saveLocal() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(state)); } catch (e) { /* storage blocked; the cloud copy or this session holds it */ } }
function loadLocal() { try { const raw = localStorage.getItem(SAVE_KEY); return raw ? JSON.parse(raw) : null; } catch (e) { return null; } }
async function saveCloud() {
  if (!cloud.ready || !cloud.ref) return;
  if (cloud.busy) { cloud.again = true; return; }
  cloud.busy = true;
  try { await cloud.ref.set({ json: JSON.stringify(state), savedAt: state.savedAt }); }
  catch (e) { if (e && ['invalid_argument', 'revoked', 'not_granted', 'quota_exceeded'].includes(e.code)) cloud.ready = false; }
  cloud.busy = false;
  if (cloud.again) { cloud.again = false; saveCloud(); }
}
async function initCloud() {
  const c = window.claude;
  if (!c || typeof c.use !== 'function') return;
  try {
    const [db, user] = await Promise.all([c.use('db'), c.use('user')]);
    if (!db || !user) return;
    const uid = await user.id();
    if (!uid) return;
    const ref = db.doc('data/users/' + uid + '/save');
    const snap = await ref.get();
    if (snap.exists) {
      const d = snap.data();
      if (d && typeof d.json === 'string') {
        const remote = JSON.parse(d.json);
        if (remote.v === 2 && (remote.savedAt || 0) > (state.savedAt || 0) && !readOnline()) {
          state = migrate(remote);
          saveLocal();
          if (!sceneOpen && !advRun) $('#scene-root').innerHTML = '';
          renderAll();
          toast('Loaded your farm from your Claude account');
        }
      }
    }
    cloud.ref = ref; cloud.ready = true;
    if (!snap.exists && state.savedAt) saveCloud();
  } catch (e) { /* keep playing on this device only */ }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden' && state) {
    saveLocal();
    if (cloud.ready && cloud.timer) { clearTimeout(cloud.timer); cloud.timer = 0; saveCloud(); }
    onlineFlush();
  }
});

let ticks = 0;
function tick() {
  if (!state) return;
  ticks++;
  updateHeader();
  if (state.tab === 'farm') {
    if (sub('farm') === 'fields') tickFarm();
    else if (ticks % 5 === 0 && !sheetOpen()) renderView();
  }
  if (state.tab === 'wilds') {
    $$('[data-stam-line]').forEach(el => { el.textContent = staminaLine(); });
    $$('[data-need]').forEach(b => { b.disabled = state.stamina < +b.dataset.need; });
  }
  if (ticks % 30 === 0) { const seen = Object.keys(state.revealed || {}).length; settleOnOwn(true); if (Object.keys(state.revealed || {}).length !== seen) renderTabs(); }
  if (state.tab === 'make' && ['bench', 'cellar'].includes(sub('make')) && ticks % 5 === 0 && !sheetOpen()) renderView();
  if (state.tab === 'fish' && fishing.phase !== 'waiting' && fishing.phase !== 'bite' && ticks % 10 === 0 && !sheetOpen()) renderView();
  updateBadges();
}
function start(data) {
  const fromHot = data && data.state;
  state = migrate(fromHot ? data.state : loadLocal());
  if (state.vperks === undefined) state.vperks = vil.perks || null;   // village perks used to live beside the save
  startChecking(true);   // signed in on this device: record moves from the first tap (71-check.js)
  ensureChores();
  checkLogin();
  checkReveals(true);
  renderAll();
  setInterval(tick, 1000);
  if (!state.name) askName();
  else if (!state.bg) createCharacter(false);
  else storyCheck();
  initCloud();
  initOnline();
}
async function boot() {
  try {
    const res = await fetch('content.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(res.status);
    indexContent(await res.json());
  } catch (e) {
    $('#view').innerHTML = '<div class="boot"><div><p>The valley didn\'t load.</p><p><a class="btn" href="">Try again</a></p></div></div>';
    return;
  }
  const hot = window.claude && window.claude.hot;
  if (hot && typeof hot.snapshot === 'function') hot.snapshot(() => ({ state }));
  if (hot && typeof hot.ready === 'function') hot.ready(start); else start((hot && hot.data) || {});
}
if (!ENGINE) boot();

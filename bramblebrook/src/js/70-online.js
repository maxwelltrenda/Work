/* ---------- online: accounts and cloud saves (Supabase), on the website ----------
   A username and password make an account; the farm then saves online a few seconds after each change and when
   the page is put away, and follows the player to any device. Inside Claude (the Artifact) the game first checks
   whether the page may reach the server at all; if it may not, the Online card points to the website instead. */
const ONLINE = {
  url: 'https://rsjzatmbkrquzfczywsz.supabase.co',
  key: 'sb_publishable_ecWCRes8YT9knvVJyEULkw_B4l393GE',   // publishable: safe in the page, row-level security guards the data
  domain: 'players.bramblebrook.invalid',                   // sign-in address for a username; no mail is ever sent
};
const ONLINE_STORE = 'bramblebrook-online';
let online = null;          // { user, username, at, rt, exp, cloudAt, syncedAt, dirty }
const onl = { busy: false, err: '', timer: 0, pending: null, reach: '' };   // reach: '' not checked, 'checking', 'ok', 'blocked'
const SITE_URL = 'https://bramblebrook-farm.vercel.app';
const inClaude = () => !!(window.claude && typeof window.claude.use === 'function');
const onlineAvailable = () => typeof fetch === 'function' && (!inClaude() || onl.reach === 'ok');
/* Inside Claude, try one harmless request to the server; the answer decides whether online play can work here. */
async function probeOnline() {
  if (!inClaude()) { onl.reach = 'ok'; return true; }
  onl.reach = 'checking';
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 7000);
    const res = await fetch(ONLINE.url + '/auth/v1/health', { headers: { apikey: ONLINE.key }, signal: ctl.signal });
    clearTimeout(t);
    onl.reach = res.ok ? 'ok' : 'blocked';
    if (!res.ok) onl.reachWhy = 'The server answered ' + res.status;
  } catch (e) { onl.reach = 'blocked'; onl.reachWhy = String((e && e.message) || e).slice(0, 80); }
  if (state && state.tab === 'bag' && !sheetOpen()) renderView();
  if (onl.reach === 'ok') {
    const f = $('#name-form');   // the first screen was drawn before the answer came back
    if (f && !$('#scene-root [data-act="online-open"]')) f.insertAdjacentHTML('afterend', '<p class="sub" style="text-align:center">Already have a farm online? <button class="linkish" data-act="online-open" data-id="signin">Sign in</button></p>');
  }
  return onl.reach === 'ok';
}

function storeOnline() { try { if (online) localStorage.setItem(ONLINE_STORE, JSON.stringify(online)); else localStorage.removeItem(ONLINE_STORE); } catch (e) { /* storage blocked */ } }
function readOnline() { try { const raw = localStorage.getItem(ONLINE_STORE); return raw ? JSON.parse(raw) : null; } catch (e) { return null; } }

async function onlineApi(path, opts = {}) {
  const headers = { apikey: ONLINE.key, 'Content-Type': 'application/json', ...(opts.headers || {}) };
  if (opts.auth) { await freshToken(); headers.Authorization = 'Bearer ' + online.at; }
  const res = await fetch(ONLINE.url + path, { method: opts.method || 'GET', headers, body: opts.body ? JSON.stringify(opts.body) : undefined, keepalive: !!opts.keepalive });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (e) { /* not JSON */ }
  if (!res.ok) {
    const msg = (data && (data.error_description || data.msg || data.message || data.error)) || ('Error ' + res.status);
    throw new Error(/invalid login credentials/i.test(msg) ? 'That username and password do not match.' : msg);
  }
  return data;
}
function takeSession(d, username) {
  online = Object.assign(online || {}, { user: d.user.id, username: username || (online && online.username), at: d.access_token, rt: d.refresh_token, exp: Date.now() + d.expires_in * 1000 });
  storeOnline();
}
async function freshToken() {
  if (!online) throw new Error('Not signed in.');
  if (Date.now() < online.exp - 60000) return;
  const d = await onlineApi('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: online.rt } });
  takeSession(d);
}

/* What a farm looks like at a glance, for the "which farm?" choice. */
function farmSummary(s) {
  const levels = Object.values(s.xp || {}).reduce((a, x) => a + levelInfo(x).lvl, 0);
  return { name: s.name || 'Your farmer', day: Math.floor(((s.savedAt || Date.now()) - (s.created || Date.now())) / 86400000) + 1, levels, coins: Math.floor(s.coins || 0), chapter: (s.story && s.story.ci) || 0, savedAt: s.savedAt || 0 };
}
// only a device that has not started a farm yet (still on the name screen) is replaced without asking
const freshFarm = s => !s || !s.name;

async function onlineSignUp(username, password) {
  const u = String(username || '').trim().toLowerCase();
  await onlineApi('/functions/v1/signup', { method: 'POST', body: { username: u, password, farm: state && state.name ? `${state.name}'s farm` : '' } });
  return onlineSignIn(u, password, true);
}
async function onlineSignIn(username, password, isNew) {
  const u = String(username || '').trim().toLowerCase();
  const d = await onlineApi('/auth/v1/token?grant_type=password', { method: 'POST', body: { email: `${u}@${ONLINE.domain}`, password } });
  online = null;
  takeSession(d, u);
  await afterSignIn(isNew);
}
function onlineSignOut() {
  online = null; storeOnline(); onl.err = '';
  toast('Signed out. Your farm stays on this device.');
}

async function fetchCloud() {
  const rows = await onlineApi(`/rest/v1/saves?select=data,summary,updated_at&user_id=eq.${online.user}`, { auth: true });
  return rows && rows[0] ? rows[0] : null;
}
async function pushCloud(keepalive) {
  if (!online || !state || !state.name) return;
  if (onl.busy) { onl.again = true; return; }
  onl.busy = true;
  try {
    const rows = await onlineApi('/rest/v1/saves', {
      method: 'POST', auth: true, keepalive,
      headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
      body: { user_id: online.user, data: state, summary: farmSummary(state), device: (navigator.userAgent || '').slice(0, 60) },
    });
    online.cloudAt = rows && rows[0] ? rows[0].updated_at : online.cloudAt;
    online.syncedAt = Date.now(); online.dirty = false; onl.err = '';
    storeOnline();
  } catch (e) { onl.err = navigator.onLine === false ? 'Offline. Your farm will save online when you are back.' : String(e.message || e); }
  onl.busy = false;
  if (onl.again) { onl.again = false; pushCloud(); }
}
/* Called from commit(): save online a few seconds after the last change. */
function onlineChanged() {
  if (!online) return;
  if (!online.dirty) { online.dirty = true; storeOnline(); }
  clearTimeout(onl.timer);
  onl.timer = setTimeout(() => pushCloud(), 5000);
}
function onlineFlush() { if (online && online.dirty) { clearTimeout(onl.timer); pushCloud(true); } }

function useCloud(row) {
  state = migrate(row.data);
  online.cloudAt = row.updated_at; online.syncedAt = Date.now(); online.dirty = false; storeOnline();
  saveLocal();
  if (!sceneOpen && !advRun) $('#scene-root').innerHTML = '';
  closeSheet();
  renderAll();
  if (!state.bg) createCharacter(false);
  toast(`Loaded ${state.name ? state.name + "'s" : 'your'} farm from your account`);
}
/* Both this device and the account have a farm that the other has not seen: the player picks. */
function chooseFarm(row) {
  onl.pending = row;
  const a = farmSummary(state), b = Object.assign(farmSummary(row.data), row.summary || {});
  const card = (s, label, act) => `<div class="card farm-pick"><div class="row between"><b>${esc(label)}</b><span class="chip plain">${s.savedAt ? agoText(s.savedAt) : ''}</span></div>
      <p class="sub">${esc(s.name)} · day ${s.day} · ${s.levels} skill levels · ${fmtN(s.coins)} coins</p><button class="btn small" data-act="${act}">Play this farm</button></div>`;
  openSheet(`<h2>Which farm?</h2><p class="sub">Your account has a farm saved online, and this device has a different one. Pick the one to keep playing. The other is replaced.</p>
    ${card(b, 'Saved online', 'online-use-cloud')}${card(a, 'On this device', 'online-keep-local')}
    <div class="sheet-btns"><button class="btn small ghost" data-act="sheet-close">Decide later</button></div>`);
}
function agoText(t) {
  const m = Math.round((Date.now() - t) / 60000);
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`;
}
async function afterSignIn(isNew) {
  const row = await fetchCloud();
  if (!row) { await pushCloud(); toast(isNew ? 'Account made. Your farm is saved online.' : 'Signed in. Your farm is saved online.'); return; }
  if (freshFarm(state)) { useCloud(row); return; }
  if (JSON.stringify(row.data) === JSON.stringify(state)) { online.cloudAt = row.updated_at; storeOnline(); toast('Signed in.'); return; }
  chooseFarm(row);
}
/* On opening the game: pick up a farm played on another device, or send this one up. */
async function initOnline() {
  if (!(await probeOnline())) return;
  online = readOnline();
  if (!online) return;
  try {
    const row = await fetchCloud();
    if (!row) { if (state.name) pushCloud(); return; }
    const newerOnline = !online.cloudAt || new Date(row.updated_at) > new Date(online.cloudAt);
    if (!newerOnline) { if (online.dirty) pushCloud(); return; }
    if (!online.dirty || freshFarm(state)) useCloud(row);
    else chooseFarm(row);
  } catch (e) {
    onl.err = navigator.onLine === false ? 'Offline. Your farm will save online when you are back.' : String(e.message || e);
    if (/refresh token|invalid jwt|not found/i.test(onl.err)) { online = null; storeOnline(); onl.err = 'Please sign in again.'; }
  }
}

/* Settings card and the sign-in sheet */
function onlineCard() {
  if (inClaude() && onl.reach !== 'ok') {
    if (onl.reach === 'blocked') return `<div class="card"><h2>Online</h2><p class="sub">This copy runs inside Claude, which keeps pages from reaching outside servers, so online accounts can't work here. Your farm still saves to your Claude account.</p>
      <p class="sub">Play online on the website: <a class="linkish" href="${SITE_URL}" target="_blank" rel="noopener">${SITE_URL.replace('https://', '')}</a></p>
      <p class="sub muted" style="font-size:12px">Connection test: blocked${onl.reachWhy ? ` (${esc(onl.reachWhy)})` : ''}</p></div>`;
    return '<div class="card"><h2>Online</h2><p class="sub">Checking whether online play can work here…</p></div>';
  }
  if (!onlineAvailable()) return '';
  if (!online) return `<div class="card"><h2>Online</h2>${inClaude() ? '<p class="sub muted" style="font-size:12px">Connection test: reached the online server from inside Claude.</p>' : ''}<p class="sub">Make an account to keep your farm safe online and play it on any device.</p>
      <div class="row"><button class="btn small" data-act="online-open" data-id="signup">Create account</button><button class="btn small ghost" data-act="online-open" data-id="signin">Sign in</button></div></div>`;
  return `<div class="card"><h2>Online</h2>${inClaude() ? '<p class="sub muted" style="font-size:12px">Connection test: reached the online server from inside Claude.</p>' : ''}<p class="sub">Signed in as <b>${esc(online.username)}</b>. ${onl.busy ? 'Saving…' : online.syncedAt ? `Saved online ${agoText(online.syncedAt)}.` : ''}</p>
      ${onl.err ? `<p class="sub" style="color:var(--berry)">${esc(onl.err)}</p>` : ''}
      <div class="row"><button class="btn small ghost" data-act="online-sync">Save now</button><button class="btn small ghost" data-act="online-signout">Sign out</button></div></div>`;
}
function onlineSheet(mode, err) {
  const isNew = mode === 'signup';
  $('#sheet-root').classList.toggle('over-scene', !!$('#scene-root .scene-wrap'));   // from the opening screen, sit above it
  openSheet(`<h2>${isNew ? 'Create an account' : 'Sign in'}</h2>
    <p class="sub">${isNew ? 'Pick a username and a password. There is no email, so keep your password somewhere safe.' : 'Use the username and password you made.'}</p>
    <form id="online-form" class="online-form" data-mode="${mode}" autocomplete="on">
      <label class="label" for="on-user">Username</label>
      <input id="on-user" name="username" autocomplete="username" autocapitalize="none" spellcheck="false" maxlength="20" required placeholder="3 to 20 letters or numbers">
      <label class="label" for="on-pass">Password</label>
      <input id="on-pass" name="password" type="password" autocomplete="${isNew ? 'new-password' : 'current-password'}" minlength="8" maxlength="72" required placeholder="At least 8 characters">
      ${isNew ? '<label class="label" for="on-pass2">Password again</label><input id="on-pass2" type="password" autocomplete="new-password" minlength="8" maxlength="72" required>' : ''}
      <p class="sub" id="on-err" style="color:var(--berry)">${err ? esc(err) : ''}</p>
      <div class="sheet-btns"><button class="btn small ghost" type="button" data-act="sheet-close">Cancel</button><button class="btn small" type="submit" id="on-go">${isNew ? 'Create account' : 'Sign in'}</button></div>
    </form>
    <p class="sub">${isNew ? 'Already have one? ' : 'New here? '}<button class="linkish" data-act="online-open" data-id="${isNew ? 'signin' : 'signup'}">${isNew ? 'Sign in' : 'Create an account'}</button></p>`);
  const f = $('#online-form');
  f.addEventListener('submit', async e => {
    e.preventDefault();
    const u = $('#on-user').value, p = $('#on-pass').value, p2 = $('#on-pass2') && $('#on-pass2').value;
    const errEl = $('#on-err'), go = $('#on-go');
    if (isNew && p !== p2) { errEl.textContent = 'The two passwords do not match.'; return; }
    go.disabled = true; go.textContent = isNew ? 'Creating…' : 'Signing in…'; errEl.textContent = '';
    try {
      if (isNew) await onlineSignUp(u, p); else await onlineSignIn(u, p);
      if ($('#online-form')) closeSheet();
      renderView();
    } catch (err2) {
      if (!$('#online-form')) return;
      errEl.textContent = navigator.onLine === false ? 'You seem to be offline.' : String(err2.message || err2);
      go.disabled = false; go.textContent = isNew ? 'Create account' : 'Sign in';
    }
  });
  setTimeout(() => { const i = $('#on-user'); if (i) i.focus(); }, 60);
}

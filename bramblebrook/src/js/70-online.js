/* ---------- online: accounts and cloud saves (Supabase), on the website ----------
   A username and password make an account; the farm then saves online a few seconds after each change and when
   the page is put away, and follows the player to any device. Inside Claude (the Artifact) the game first checks
   whether the page may reach the server at all; if it may not, the Online card points to the website instead. */
const ONLINE = {
  url: 'https://rsjzatmbkrquzfczywsz.supabase.co',
  key: 'sb_publishable_ecWCRes8YT9knvVJyEULkw_B4l393GE',   // publishable: safe in the page, row-level security guards the data
  domain: 'players.bramblebrook.invalid',                   // sign-in address for a username; no mail is ever sent
  social: true,                                             // profiles and villages (switch off to hide them)
};
const ONLINE_STORE = 'bramblebrook-online';
const LINK_STORE = 'bramblebrook-link';          // inside Claude: syncing through the player's own connector
const LINK_SERVER = 'Bramblebrook Farm';         // the custom connector's name in Claude's settings
let online = null;          // { user, username, at, rt, exp, cloudAt, syncedAt, dirty }
const onl = { busy: false, err: '', timer: 0, pending: null, reach: '' };   // reach: '' not checked, 'checking', 'ok', 'blocked'
const SITE_URL = 'https://bramblebrook-farm.vercel.app';
const inClaude = () => !!(window.claude && typeof window.claude.use === 'function');
// the iPhone app (Capacitor): the same game, bundled; it plays online like the website does
const isNativeApp = () => !!(window.Capacitor && typeof window.Capacitor.isNativePlatform === 'function' && window.Capacitor.isNativePlatform());
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

const storeKey = () => (inClaude() ? LINK_STORE : ONLINE_STORE);
function storeOnline() { try { if (online) localStorage.setItem(storeKey(), JSON.stringify(online)); else localStorage.removeItem(storeKey()); } catch (e) { /* storage blocked */ } }
function readOnline() { try { const raw = localStorage.getItem(storeKey()); return raw ? JSON.parse(raw) : null; } catch (e) { return null; } }

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
// "Start over" leaves this marker online in place of the farm: farms begun before it are wiped, newer ones kept
const isReset = row => !!(row && row.data && row.data.reset && !row.data.name);
function takeReset(row) {
  online.cloudAt = row.updated_at; online.dirty = false; storeOnline();
  if (state.name && (state.created || 0) < row.data.reset) { wipeFarm('Your farm was reset. A fresh start!'); return; }
  if (state.name) pushCloud();
}
/* A brand-new farm on this device. The old one is gone for good. */
function wipeFarm(msg) {
  try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* storage blocked */ }
  if (typeof bt !== 'undefined') bt = null;
  state = migrate(null);
  state.savedAt = now(); exploreLog = []; mineLog = []; catchLog = [];
  restartChecking();
  saveLocal();
  if (cloud.ready) saveCloud();
  closeSheet(); $('#scene-root').innerHTML = '';
  renderAll();
  askName();
  if (msg) toast(msg);
}
async function startOver() {
  if (online) {
    const mark = { reset: Date.now() };
    try {
      if (online.via === 'mcp') { const r = await linkCall('save_farm', { data: mark, summary: mark }); online.cloudAt = r.updated_at; }
      else {
        const rows = await onlineApi('/rest/v1/saves', { method: 'POST', auth: true, headers: { Prefer: 'resolution=merge-duplicates,return=representation' }, body: { user_id: online.user, data: mark, summary: mark, device: 'start over' } });
        online.cloudAt = rows && rows[0] ? rows[0].updated_at : null;
      }
      online.dirty = false; storeOnline();
    } catch (e) { toast('Could not reach your account, so nothing was reset. Try again when you are online.'); return; }
  }
  wipeFarm('A fresh start. Your old farm is gone.');
}

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
  startChecking();
  startPresence();
}
function onlineSignOut() {
  if (mv.on) { chk.base = ''; storeCheck(); mv.log = []; keepMoves(); }   // moves made signed out can't follow these
  stopChecking();
  clearInterval(prof.timer); prof.me = null; prof.lastPublic = '';
  vil.data = null; vil.at = 0; vil.list = null; keepPerks();
  online = null; storeOnline(); onl.err = '';
  soc.notes = 0; soc.dms = 0; soc.admin = false; soc.fbNew = 0; soc.world = []; soc.worldLoaded = false; soc.threads = null; soc.thread = null; updateSocialBadges();
  toast('Signed out. Your farm stays on this device.');
}

/* Inside Claude: one call to the player's own Bramblebrook Farm connector. */
async function linkCall(tool, input) {
  try { const r = await onl.mcp.callTool(LINK_SERVER, tool, input || {}, { cache: false }); return r.payload; }
  catch (e) { throw Object.assign(new Error(linkErrText(e)), { code: e && e.code }); }
}
function linkErrText(e) {
  switch (e && e.code) {
    case 'server_not_connected': case 'server_not_found': return `Add the ${LINK_SERVER} connector in Claude's settings (steps below).`;
    case 'needs_reauth': return `Reconnect ${LINK_SERVER} in Claude Settings › Connectors.`;
    case 'approval_required': case 'consent_required': case 'not_in_manifest': return 'Syncing needs your OK first.';
    case 'selection_required': return `You have more than one connector named ${LINK_SERVER}. Pick one when Claude asks.`;
    case 'server_unavailable': return 'The farm server did not answer. It will try again.';
    case 'tool_error': return 'The farm server said: ' + String((e.message || '').slice(0, 120));
    case 'tool_not_found': case 'unknown_tool': return `Reconnect ${LINK_SERVER} in Claude Settings › Connectors to pick up villages and profiles.`;
    default: return 'Syncing failed (' + ((e && e.code) || 'unknown') + ').';
  }
}
async function fetchCloud() {
  if (online.via === 'mcp') {
    const r = await linkCall('load_farm');
    return r && r.found ? { data: r.data, summary: r.summary, updated_at: r.updated_at } : null;
  }
  const rows = await onlineApi(`/rest/v1/saves?select=data,summary,updated_at&user_id=eq.${online.user}`, { auth: true });
  return rows && rows[0] ? rows[0] : null;
}
async function pushCloud(keepalive) {
  if (!online || !state || !state.name) return;
  if (onl.busy) { onl.again = true; return; }
  onl.busy = true;
  if (online.via === 'mcp') {
    try {
      const r = await linkCall('save_farm', { data: state, summary: farmSummary(state), ...(online.cloudAt ? { if_updated_at: online.cloudAt } : {}) });
      if (r && r.conflict) {   // played on the website since: never overwrite it, ask instead
        onl.busy = false;
        const row = await fetchCloud();
        if (row) (isReset(row) ? takeReset(row) : chooseFarm(row));
        return;
      }
      online.cloudAt = r.updated_at; online.syncedAt = Date.now(); online.dirty = false; onl.err = '';
      storeOnline();
    } catch (e) { onl.err = e.message; if (/needs your OK/.test(onl.err)) onl.link = 'approve'; }
    onl.busy = false;
    if (onl.again) { onl.again = false; pushCloud(); }
    return;
  }
  try {
    const body = { user_id: online.user, data: state, summary: farmSummary(state), device: (navigator.userAgent || '').slice(0, 60) };
    let rows;
    if (online.cloudAt) {
      // only replace the copy we last saw; if it changed elsewhere (the Claude copy, another device), ask instead
      rows = await onlineApi(`/rest/v1/saves?user_id=eq.${online.user}&updated_at=eq.${encodeURIComponent(online.cloudAt)}`, {
        method: 'PATCH', auth: true, keepalive, headers: { Prefer: 'return=representation' }, body,
      });
      if (!rows || !rows.length) {
        const row = await fetchCloud();
        onl.busy = false;
        if (row) { isReset(row) ? takeReset(row) : chooseFarm(row); return; }
        online.cloudAt = null;   // nothing online any more: fall through to a fresh save next time
        pushCloud();
        return;
      }
    } else {
      rows = await onlineApi('/rest/v1/saves', {
        method: 'POST', auth: true, keepalive,
        headers: { Prefer: 'resolution=merge-duplicates,return=representation' }, body,
      });
    }
    online.cloudAt = rows && rows[0] ? rows[0].updated_at : online.cloudAt;
    online.syncedAt = Date.now(); online.dirty = false; onl.err = '';
    storeOnline();
    pushPublicCard();
    checkSoon(1500);   // and let the server check the moves that led here (71-check.js)
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
  restartChecking();
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
  if (isReset(row)) { takeReset(row); toast(isNew ? 'Account made.' : 'Signed in.'); return; }
  if (!row) { await pushCloud(); toast(isNew ? 'Account made. Your farm is saved online.' : 'Signed in. Your farm is saved online.'); return; }
  if (freshFarm(state)) { useCloud(row); return; }
  if (JSON.stringify(row.data) === JSON.stringify(state)) { online.cloudAt = row.updated_at; storeOnline(); toast('Signed in.'); return; }
  chooseFarm(row);
}
/* On opening the game: pick up a farm played on another device, or send this one up. */
async function syncOnOpen() {
  if (!online.cloudAt) return afterSignIn(false);   // first sync on this device: ask before replacing a started farm
  const row = await fetchCloud();
  if (!row) { if (state.name) pushCloud(); return; }
  if (isReset(row)) { if (new Date(row.updated_at) > new Date(online.cloudAt)) takeReset(row); else if (online.dirty && state.name) pushCloud(); return; }
  const newerOnline = new Date(row.updated_at) > new Date(online.cloudAt);
  if (!newerOnline) { if (online.dirty) pushCloud(); return; }
  if (!online.dirty || freshFarm(state)) useCloud(row);
  else chooseFarm(row);
}
/* Inside Claude, where the page cannot reach the server itself: sync through the player's own connector. */
async function initLink() {
  let m = null;
  try { m = await window.claude.use('mcp'); } catch (e) { m = null; }
  if (!m) { onl.link = 'off'; refreshOnlineCard(); return; }
  onl.mcp = m;
  let listed = null;
  try { listed = await m.listTools(LINK_SERVER); } catch (e) { listed = null; }
  if (!(listed && listed.servers && listed.servers.some(s => s.server === LINK_SERVER))) { onl.link = 'missing'; refreshOnlineCard(); return; }
  online = Object.assign(readOnline() || {}, { via: 'mcp' });
  try {
    const st = await linkCall('farm_status');   // the first call asks you to allow the connector for this page
    online.username = st.username; online.user = st.user_id || online.user; storeOnline();
    onl.link = 'ready'; onl.err = '';
    await syncOnOpen();
    startPresence();   // profiles and villages work through the connector too
  } catch (e) {
    onl.err = e.message;
    onl.link = /needs your OK/.test(e.message) ? 'approve' : e.code === 'server_not_connected' ? 'missing' : 'error';
    if (onl.link !== 'ready' && !online.cloudAt) online = null;
  }
  refreshOnlineCard();
}
function refreshOnlineCard() { const n = $('#name-online'); if (n) n.innerHTML = nameOnlineLine(); if (state && state.tab === 'bag' && !sheetOpen()) renderView(); }
/* The line under the name box: who you are signed in as, or a way to sign in. */
function nameOnlineLine() {
  if (online && online.username) return `Playing online as <b>${esc(online.username)}</b>. Your farm saves to your account.`;
  if (onlineAvailable()) return 'Already have a farm online? <button class="linkish" data-act="online-open" data-id="signin">Sign in</button>';
  return '';
}
async function initOnline() {
  if (!(await probeOnline())) { if (inClaude()) await initLink(); return; }
  online = readOnline();
  if (!online) return;
  try {
    await syncOnOpen();
    startPresence();
  } catch (e) {
    onl.err = navigator.onLine === false ? 'Offline. Your farm will save online when you are back.' : String(e.message || e);
    if (/refresh token|invalid jwt|not found/i.test(onl.err)) { online = null; storeOnline(); onl.err = 'Please sign in again.'; }
  }
  if (online) startChecking(); else stopChecking();
}

/* Settings card and the sign-in sheet */
// the farm saves a few seconds after each change, so an old time just means nothing has changed since
function saveLine() {
  if (onl.busy || (online && online.dirty)) return 'Saving…';
  if (!online || !online.syncedAt) return '';
  return Date.now() - online.syncedAt < 60000 ? 'Everything is saved.' : `Everything is saved. Your last change was saved ${agoText(online.syncedAt)}.`;
}
function onlineCard() {
  if (inClaude() && onl.reach !== 'ok') {
    if (onl.reach === 'blocked') {
      const site = `<a class="linkish" href="${SITE_URL}" target="_blank" rel="noopener">${SITE_URL.replace('https://', '')}</a>`;
      if (onl.link === 'ready' && online) return `<div class="card"><h2>Online</h2><p class="sub">Synced with your online farm <b>${esc(online.username || '')}</b> through your ${esc(LINK_SERVER)} connector. ${saveLine()}</p>
        ${onl.err ? `<p class="sub" style="color:var(--berry)">${esc(onl.err)}</p>` : ''}
        ${ONLINE.social ? `<p class="sub">${prof.me && prof.me.show_online === false ? 'Your online status is private.' : 'Other players can see when you are online.'}</p>` : ''}
        <div class="row">${ONLINE.social && online.user ? '<button class="btn small" data-act="online-profile">My profile</button>' : ''}<button class="btn small ghost" data-act="online-sync">Save now</button><button class="btn small ghost" data-act="online-link-stop">Stop syncing</button></div></div>`;
      if (onl.link === 'approve') return `<div class="card"><h2>Online</h2><p class="sub">Your ${esc(LINK_SERVER)} connector is ready. Syncing needs your OK once.</p>
        <div class="row"><button class="btn small" data-act="online-link-allow">Allow syncing</button></div></div>`;
      if (onl.link === 'missing' || onl.link === 'error') return `<div class="card"><h2>Online</h2><p class="sub">Claude keeps pages from reaching outside servers, but you can play your online farm here through a connector of your own:</p>
        <ol class="sub link-steps"><li>On the website (${site}), sign in, open Settings and tap <b>Link Claude</b>. Copy the address it shows.</li>
        <li>In Claude, open Settings › Connectors › <b>Add custom connector</b>. Name it <b>${esc(LINK_SERVER)}</b> and paste the address.</li>
        <li>Come back here and reopen this page.</li></ol>
        ${onl.err && onl.link === 'error' ? `<p class="sub" style="color:var(--berry)">${esc(onl.err)}</p>` : ''}
        <div class="row"><button class="btn small ghost" data-act="online-link-allow">Check again</button></div></div>`;
      if (onl.link === '' || onl.link === undefined) return '<div class="card"><h2>Online</h2><p class="sub">Looking for your Bramblebrook Farm connector…</p></div>';
      return `<div class="card"><h2>Online</h2><p class="sub">This copy runs inside Claude, which keeps pages from reaching outside servers, so online accounts can't work here. Your farm still saves to your Claude account.</p>
      <p class="sub">Play online on the website: ${site}</p>
      <p class="sub muted" style="font-size:12px">Connection test: blocked${onl.reachWhy ? ` (${esc(onl.reachWhy)})` : ''}</p></div>`;
    }
    return '<div class="card"><h2>Online</h2><p class="sub">Checking whether online play can work here…</p></div>';
  }
  if (!onlineAvailable()) return '';
  if (!online) return `<div class="card"><h2>Online</h2>${inClaude() ? '<p class="sub muted" style="font-size:12px">Connection test: reached the online server from inside Claude.</p>' : ''}<p class="sub">Make an account to keep your farm safe online and play it on any device.</p>
      <div class="row"><button class="btn small" data-act="online-open" data-id="signup">Create account</button><button class="btn small ghost" data-act="online-open" data-id="signin">Sign in</button></div></div>`;
  return `<div class="card"><h2>Online</h2>${inClaude() ? '<p class="sub muted" style="font-size:12px">Connection test: reached the online server from inside Claude.</p>' : ''}<p class="sub">Signed in as <b>${esc(online.username)}</b>. ${saveLine()}</p>
      ${onl.err ? `<p class="sub" style="color:var(--berry)">${esc(onl.err)}</p>` : ''}
      ${inClaude() || !ONLINE.social ? '' : `<p class="sub">${prof.me && prof.me.show_online === false ? 'Your online status is private.' : 'Other players can see when you are online.'}</p>`}
      <div class="row">${inClaude() || !ONLINE.social ? '' : '<button class="btn small" data-act="online-profile">My profile</button>'}<button class="btn small ghost" data-act="online-sync">Save now</button><button class="btn small ghost" data-act="online-signout">Sign out</button></div>
      ${inClaude() || isNativeApp() ? '' : `<p class="sub" style="margin-top:6px">Play this same farm inside Claude too.</p><div class="row"><button class="btn small ghost" data-act="online-link-make">Link Claude</button></div>`}</div>`;
}
/* Website: make a private connector address for this account and show the three steps. */
async function makeLink() {
  openSheet('<h2>Link Claude</h2><p class="sub">Making your private address…</p>');
  try {
    const tok = await onlineApi('/rest/v1/rpc/create_connector_link', { method: 'POST', auth: true, body: {} });
    const addr = `${ONLINE.url}/functions/v1/farm-mcp/${tok}`;
    openSheet(`<h2>Link Claude</h2>
      <p class="sub">This private address lets your own Claude account load and save this farm. Keep it to yourself; anyone with it can change your save. Making a new one turns the old one off.</p>
      <label class="label" for="link-addr">Your connector address</label>
      <input id="link-addr" class="link-addr" readonly value="${esc(addr)}">
      <div class="row"><button class="btn small" data-act="online-link-copy">Copy address</button></div>
      <ol class="sub link-steps"><li>In Claude, open Settings › Connectors › <b>Add custom connector</b>.</li>
      <li>Name it <b>${esc(LINK_SERVER)}</b> and paste the address.</li>
      <li>Open the Bramblebrook Artifact and allow syncing when it asks.</li></ol>
      <div class="sheet-btns"><button class="btn small danger" data-act="online-link-off">Turn the link off</button><button class="btn small ghost" data-act="sheet-close">Done</button></div>`);
  } catch (e) {
    openSheet(`<h2>Link Claude</h2><p class="sub" style="color:var(--berry)">${esc(String(e.message || e))}</p><div class="sheet-btns"><button class="btn small ghost" data-act="sheet-close">Close</button></div>`);
  }
}
async function unLink() {
  try { await onlineApi('/rest/v1/rpc/delete_connector_link', { method: 'POST', auth: true, body: {} }); closeSheet(); toast('The Claude link is off. Remove the connector in Claude too.'); }
  catch (e) { toast(String(e.message || e)); }
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
      ${isNew ? `<p class="sub small-print">By creating an account you agree to the ${legalLink('terms', 'Terms and community rules')} and the ${legalLink('privacy', 'Privacy policy')}. No bullying, hate or adult content: it is removed, and players who post it are banned.</p>` : ''}
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
      if (state && !state.name && $('#welcome')) askName();   // from the first screen: on to naming the farmer
    } catch (err2) {
      if (!$('#online-form')) return;
      errEl.textContent = navigator.onLine === false ? 'You seem to be offline.' : String(err2.message || err2);
      go.disabled = false; go.textContent = isNew ? 'Create account' : 'Sign in';
    }
  });
  setTimeout(() => { const i = $('#on-user'); if (i) i.focus(); }, 60);
}

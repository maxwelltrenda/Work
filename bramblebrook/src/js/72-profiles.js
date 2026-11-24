/* ---------- player profiles: what other players see, and whether you're online ----------
   While you play (signed in on the website), the game tells the server you're here every couple of minutes.
   Others see "Online now" or "Last online …", unless you switch off "Show when I'm online". The server
   enforces that: with it off, nobody else even receives your last-online time. */
const PRESENCE_EVERY = 120000;
const prof = { me: null, lastPublic: '', timer: 0 };

/* The public card: a character, not a save. */
function publicCard() {
  const bg = (C.core.backgrounds || []).find(b => b.id === state.bg);
  const levels = {};
  for (const s of I.skills) if (skillOn(s.id)) levels[s.id] = lvl(s.id);
  return { name: state.name || '', face: state.face || '', bg: state.bg || '', title: `Level ${charLevel()} ${bg ? bg.n : 'Farmer'}`, levels, chapter: state.story ? state.story.ci : 0, day: dayNumber() };
}
const signedInWeb = () => !!(ONLINE.social && online && online.via !== 'mcp' && online.user);

async function touchPresence() {
  if (!signedInWeb() || document.visibilityState === 'hidden') return;
  try { await onlineApi('/rest/v1/rpc/touch_presence', { method: 'POST', auth: true, body: {} }); } catch (e) { /* offline: try next time */ }
}
async function loadMyProfile() {
  if (!signedInWeb()) return null;
  try {
    const rows = await onlineApi(`/rest/v1/profiles?id=eq.${online.user}&select=username,farm_name,public,show_online,last_seen`, { auth: true });
    prof.me = rows && rows[0] ? rows[0] : null;
  } catch (e) { /* keep what we had */ }
  return prof.me;
}
/* Keep the public card current, without sending it when nothing changed. */
async function pushPublicCard() {
  if (!signedInWeb() || !state || !state.name) return;
  const card = JSON.stringify(publicCard());
  if (card === prof.lastPublic) return;
  try {
    await onlineApi(`/rest/v1/profiles?id=eq.${online.user}`, { method: 'PATCH', auth: true, headers: { Prefer: 'return=minimal' }, body: { public: JSON.parse(card) } });
    prof.lastPublic = card;
  } catch (e) { /* next save tries again */ }
}
async function setShowOnline(on) {
  if (!signedInWeb()) return;
  try {
    await onlineApi(`/rest/v1/profiles?id=eq.${online.user}`, { method: 'PATCH', auth: true, headers: { Prefer: 'return=minimal' }, body: { show_online: !!on } });
    if (prof.me) prof.me.show_online = !!on;
    toast(on ? 'Others can see when you are online' : 'Your online status is now private');
  } catch (e) { toast(String(e.message || e)); }
  refreshOnlineCard();
}
function startPresence() {
  clearInterval(prof.timer);
  if (!signedInWeb()) return;
  touchPresence(); loadMyProfile().then(refreshOnlineCard); pushPublicCard(); loadVillage();
  prof.timer = setInterval(touchPresence, PRESENCE_EVERY);
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') touchPresence(); });

/* "Online now", "Last online 3 h ago", or private. */
function statusLine(p) {
  if (p.online) return '<span class="presence on">Online now</span>';
  if (p.hidden) return '<span class="presence">Keeps their online status private</span>';
  if (p.last_seen) return `<span class="presence">Last online ${agoText(new Date(p.last_seen).getTime())}</span>`;
  return '<span class="presence">Not seen online yet</span>';
}
const profilePic = (face, size) => `<span class="mono" style="--h:160">${face && I.art['face:' + face] ? artCell('face:' + face, size) : '<span class="unknown">?</span>'}</span>`;
function profileHTML(p, mine) {
  const c = p.public || {};
  const levels = Object.entries(c.levels || {}).map(([k, v]) => `<div class="stat"><b>${esc(String(v))}</b><span>${esc(skillName(k))}</span></div>`).join('');
  return `<div class="profile-head">${profilePic(c.face, 72)}<div><h2>${esc(c.name || p.username)}</h2>
      <p class="sub">@${esc(p.username)}${p.farm_name ? ' · ' + esc(p.farm_name) : ''}</p><p class="sub">${esc(c.title || '')}</p>${statusLine(p)}</div></div>
    ${levels ? `<div class="stats">${levels}</div>` : '<p class="sub">No farm shared yet.</p>'}
    ${c.chapter != null ? `<p class="sub">Story: ${esc(chapterLabel(c.chapter))}${c.day ? ` · day ${esc(String(c.day))} in the valley` : ''}</p>` : ''}
    ${mine ? `<div class="toggle"><div class="what"><b>Show when I'm online</b><small>Off: other players see neither the dot nor when you were last on</small></div>
      <button class="switch" role="switch" aria-label="Show when I'm online" aria-checked="${p.show_online !== false}" data-act="online-show"></button></div>` : ''}`;
}
async function openProfile(id) {
  openSheet('<h2>Profile</h2><p class="sub">Loading…</p>');
  try {
    const rows = await onlineApi('/rest/v1/rpc/get_profiles', { method: 'POST', auth: true, body: { p_ids: [id] } });
    const p = rows && rows[0];
    if (!p) throw new Error('That player could not be found.');
    const mine = id === online.user;
    if (mine && prof.me) p.show_online = prof.me.show_online;
    openSheet(`${profileHTML(p, mine)}<div class="sheet-btns"><button class="btn small ghost" data-act="sheet-close">Close</button></div>`);
  } catch (e) {
    openSheet(`<h2>Profile</h2><p class="sub" style="color:var(--berry)">${esc(String(e.message || e))}</p><div class="sheet-btns"><button class="btn small ghost" data-act="sheet-close">Close</button></div>`);
  }
}

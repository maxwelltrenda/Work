/* ---------- social: the notification bell, world and village chat, follows and direct messages ----------
   The server writes notifications on its own (village news, the village boss, new followers) and keeps the
   chats; direct messages only work between two players who follow each other. Everything goes through rpc()
   (74-villages.js), so inside Claude it travels through the player's connector like villages do. */
const SOC_STORE = 'bramblebrook-social';
const soc = { notes: 0, dms: 0, worldLast: 0, villageLast: 0, worldSeen: 0, villageSeen: 0, tab: 'world',
  world: [], worldLoaded: false, threads: null, thread: null, notesList: null, pinging: false, busy: false, draft: '' };
try { Object.assign(soc, JSON.parse(localStorage.getItem(SOC_STORE) || '{}')); } catch (e) { /* storage blocked */ }
function socKeep() { try { localStorage.setItem(SOC_STORE, JSON.stringify({ worldSeen: soc.worldSeen, villageSeen: soc.villageSeen, tab: soc.tab })); } catch (e) { /* storage blocked */ } }
const chatOpenNow = () => !!(state && sheetOpen() && $('#chat-panel'));
const myId = () => online && online.user;

/* The little numbers: checked about once a minute, which also tells the server you're online. */
async function socialPing() {
  if (!socialOn() || soc.pinging || document.visibilityState === 'hidden') return;
  soc.pinging = true;
  try {
    const r = await rpc('social_ping');
    const fresh = r.notes > soc.notes;
    Object.assign(soc, { notes: r.notes, dms: r.dms, worldLast: r.world, villageLast: r.village, admin: !!r.admin, fbNew: r.feedback_new || 0, blocked: r.blocked || soc.blocked || [] });
    if (fresh) freshNoteToast();
    updateSocialBadges();
    if (chatOpenNow()) refreshChat(false);
  } catch (e) { /* offline: try next time */ }
  soc.pinging = false;
  refreshPreviews();
  loadWar();   // the war's score and your raids, for the Home tile and the Village button
}
async function freshNoteToast() {
  try {
    const r = await rpc('notifications_list');
    soc.notesList = r.items || [];
    const n = soc.notesList.find(x => x.unread);
    if (n) toast(`${n.icon} ${n.body}`);
  } catch (e) { /* the bell still shows it */ }
}
function updateSocialBadges() {
  const bell = $('#bell-btn');
  if (bell) bell.hidden = !socialOn();
  const b = $('#badge-notes');
  if (b) { b.hidden = !soc.notes; b.textContent = soc.notes > 99 ? '99+' : soc.notes; }
}

/* The bell: the latest 40, newest first; opening it marks them read. */
async function notesSheet() {
  openSheet('<h2>Notifications</h2><p class="sub">Loading…</p>');
  try {
    const r = await rpc('notifications_list');
    soc.notesList = r.items || [];
    drawNotes();
    if (soc.notes) { soc.notes = 0; updateSocialBadges(); rpc('notifications_seen').catch(() => {}); }
  } catch (e) { openSheet(`<h2>Notifications</h2><p class="sub" style="color:var(--berry)">${esc(String(e.message || e))}</p><div class="sheet-btns"><button class="btn small ghost" data-act="sheet-close">Close</button></div>`); }
}
function drawNotes() {
  const items = soc.notesList || [];
  openSheet(`<h2>Notifications</h2>
    ${items.length ? `<div class="notes">${items.map(n => `<button class="note${n.unread ? ' unread' : ''}" data-act="note-go" data-to="${esc((n.link && n.link.to) || '')}" data-id="${esc((n.link && n.link.id) || '')}">
      <span class="note-ic">${esc(n.icon || '🔔')}</span><span class="note-body">${esc(n.body)}<small>${agoText(Date.parse(n.created_at))}</small></span></button>`).join('')}</div>`
      : '<p class="sub">Nothing yet. News from your village, its boss and your friends shows up here.</p>'}
    <div class="sheet-btns">${soc.admin ? `<button class="btn small" data-act="fb-inbox">Feedback inbox${soc.fbNew ? ` (${soc.fbNew} new)` : ''}</button>` : ''}<button class="btn small ghost" data-act="feedback">Send feedback</button><button class="btn small ghost" data-act="sheet-close">Close</button></div>`);
}
function goTown(s) { goPlace('town', s); }
function noteGo(to, id) {
  closeSheet();
  if (to === 'village') goTown('village');
  else if (to === 'hands') { goTown('hands'); loadHands(true); }
  else if (to === 'war') { goTown('war'); loadWar(); }
  else if (to === 'boss') { goTown('village'); loadVillage().then(() => { if (vil.raid && vil.raid.raid) openRaid(); else renderView(); }); }
  else if (to === 'profile' && id) openProfile(id);
  else if (to === 'dm' && id) openDm(id);
  else if (to === 'feedback') feedbackInbox();
}

/* Following: a button on every profile. Two players who follow each other can message. */
function followHTML(p) {
  if (!socialOn() || !p || p.me) return '';
  const mutual = p.i_follow && p.follows_me;
  return `<p class="sub">${fmtN(p.followers || 0)} follower${p.followers === 1 ? '' : 's'} · ${fmtN(p.following || 0)} following${p.follows_me ? ' · <span class="chip plain">Follows you</span>' : ''}</p>
    <div class="row"><button class="btn small${p.i_follow ? ' ghost' : ''}" data-act="follow" data-id="${esc(p.id)}">${p.i_follow ? 'Following ✓' : p.follows_me ? 'Follow back' : 'Follow'}</button>
      ${mutual ? `<button class="btn small" data-act="dm-open" data-id="${esc(p.id)}">Message</button>` : ''}</div>
    ${p.i_follow && !p.follows_me ? '<p class="sub">You can message each other once they follow you back.</p>' : !p.i_follow && !mutual ? '<p class="sub">Follow each other to send messages.</p>' : ''}
    <div class="row safety-row">${isBlocked(p.id) ? `<button class="btn small ghost" data-act="unblock" data-user="${esc(p.id)}">Unblock</button>`
      : `<button class="btn small ghost" data-act="report-open" data-kind="profile" data-id="" data-user="${esc(p.id)}" data-name="${esc((p.public && p.public.name) || p.username || '')}">🚩 Report</button><button class="btn small ghost danger" data-act="block" data-user="${esc(p.id)}" data-name="${esc((p.public && p.public.name) || p.username || '')}">Block</button>`}</div>`;
}
async function toggleFollow(id) {
  try {
    const cur = soc.profile && soc.profile.id === id ? soc.profile : null;
    const p = await rpc(cur && cur.i_follow ? 'unfollow_player' : 'follow_player', { p_user: id });
    soc.profile = p;
    play(p.i_follow ? 'chime' : 'tick');
    if (p.i_follow && p.follows_me) toast(`You and ${(p.public && p.public.name) || p.username} follow each other: you can message now.`);
    showProfile(p);
    soc.threads = null;
  } catch (e) { toast(String(e.message || e)); }
}

/* Chat: a bar just above the page buttons shows the newest line from each room; tapping one slides the chat up
   over whatever page you're on, so you never lose your place. Three rooms: World, Village and Messages. */
function chatPanelHTML() {
  return `<div class="row between chat-top"><h2>Chat</h2><button class="btn small ghost" data-act="sheet-close">Close</button></div>${viewChat()}`;
}
function openChat(tab, keepThread) {
  if (tab) { soc.tab = tab; socKeep(); }
  if (!keepThread) soc.thread = null;
  openSheet(`<div id="chat-panel" class="chat-panel">${chatPanelHTML()}</div>`);
  const sh = $('#sheet-root .sheet'); if (sh) sh.classList.add('chat-sheet');
  if (socialOn() && (soc.tab !== 'world' || soc.worldLoaded)) refreshChat(false);
  renderChatbar();
}
function drawChat() { const p = $('#chat-panel'); if (p) p.innerHTML = chatPanelHTML(); }
function viewChat() {
  if (!socialOn()) {
    if (inClaude()) return `<div class="card"><h2>Chat</h2><p class="sub">${onl.link === '' || onl.link === undefined ? 'Connecting to your account…' : 'Chat is online. Link this game to your account first: Profile › Settings › Online.'}</p></div>`;
    return `<div class="card"><h2>Chat</h2><p class="sub">Talk with everyone in the valley, your village, and friends. Chat is online, so you need an account first.</p>
      <div class="row"><button class="btn small" data-act="online-open" data-id="signup">Create account</button><button class="btn small ghost" data-act="online-open" data-id="signin">Sign in</button></div></div>`;
  }
  const tabs = [['world', 'World', 0], ['village', 'Village', soc.villageLast > soc.villageSeen ? 1 : 0], ['dm', 'Messages', soc.dms]];
  const seg = `<div class="seg" role="tablist">${tabs.map(([k, n, b]) => `<button class="seg-b${soc.tab === k ? ' on' : ''}" role="tab" aria-selected="${soc.tab === k}" data-act="chat-tab" data-id="${k}">${n}${b ? `<span class="seg-dot">${k === 'dm' ? b : ''}</span>` : ''}</button>`).join('')}</div>`;
  setTimeout(afterChatDraw, 0);
  return seg + (soc.tab === 'village' ? villageChatHTML() : soc.tab === 'dm' ? dmHTML() : worldChatHTML());
}
const lineHTML = (m, mine, kind) => `<div class="chat-line${mine ? ' mine' : ''}">
    ${mine ? '' : `<button class="chat-pic" data-act="online-profile" data-id="${esc(m.user_id)}" aria-label="${esc(m.name || 'Player')}'s profile">${profilePic(m.face, 30)}</button>`}
    <div class="chat-bubble">${mine ? '' : `<button class="chat-name" data-act="online-profile" data-id="${esc(m.user_id)}">${esc(m.name || 'Someone')}</button>`}<p>${esc(m.body)}</p><small>${agoText(Date.parse(m.created_at))}</small></div>
    ${mine ? '' : msgMenuHTML(kind, m.id, m.user_id, m.name)}</div>`;
const chatForm = (kind, ph, max, off) => `<form class="chat-form" id="chat-form" data-kind="${kind}"><input id="chat-in" maxlength="${max}" placeholder="${esc(ph)}" value="${esc(soc.draft)}" ${off ? 'disabled' : ''} autocomplete="off"><button class="btn small" type="submit" ${off ? 'disabled' : ''}>Send</button></form>`;
function worldChatHTML() {
  if (!soc.worldLoaded) { refreshChat(true); return '<div class="card"><p class="sub">Opening the world chat…</p></div>'; }
  const list = soc.world.length ? soc.world.filter(m => !isBlocked(m.user_id)).map(m => lineHTML(m, m.user_id === myId(), 'world')).join('') : '<p class="sub">Nobody has said anything yet. Say hello to the valley!</p>';
  return `<div class="card chat-card"><p class="sub chat-note">Everyone playing Bramblebrook. Tap a name to see their profile and follow them.</p>
    <div class="chat-list" id="chat-list">${list}</div>${chatForm('world', 'Say something to everyone', 280)}</div>`;
}
function villageChatHTML() {
  if (!vil.at) { loadVillage().then(() => { if (chatOpenNow()) drawChat(); renderChatbar(); }); return '<div class="card"><p class="sub">Walking to the village…</p></div>'; }
  if (!vil.data) return `<div class="card"><p class="sub">Join a village to chat with your neighbours.</p><div class="row"><button class="btn small" data-act="note-go" data-to="village">Find a village</button></div></div>`;
  const lines = vil.board.filter(e => e.kind === 'chat' && !isBlocked(e.user_id)).slice().reverse().map(e => {
    const p = vil.profiles[e.user_id] || {};
    return lineHTML({ id: e.id, user_id: e.user_id, name: whoName(e.user_id), face: p.public && p.public.face, body: e.body, created_at: e.created_at }, e.user_id === myId(), 'village');
  }).join('');
  return `<div class="card chat-card"><p class="sub chat-note">${esc(vil.data.crest)} ${esc(vil.data.name)}: only your neighbours see this.</p>
    <div class="chat-list" id="chat-list">${lines || '<p class="sub">No messages yet. Say hello to your neighbours.</p>'}</div>${chatForm('village', 'Say something to the village', 280)}</div>`;
}
function dmHTML() {
  const t = soc.thread;
  if (t) {
    const lines = t.messages.length ? t.messages.map(m => lineHTML({ id: m.id, user_id: t.with, name: t.name, face: t.face, body: m.body, created_at: m.created_at }, m.mine, 'dm')).join('')
      : `<p class="sub">This is the start of your messages with ${esc(t.name || 'them')}.</p>`;
    return `<div class="card chat-card"><div class="dm-head"><button class="raid-back" data-act="dm-back" aria-label="Back to your messages">‹</button>
        <button class="dm-who" data-act="online-profile" data-id="${esc(t.with)}">${profilePic(t.face, 32)}<b>${esc(t.name || 'Player')}</b></button></div>
      <div class="chat-list" id="chat-list">${lines}</div>
      ${t.blocked ? '<p class="sub">You or they blocked the other, so messages are off.</p>' : t.mutual ? '' : '<p class="sub">You can message each other again once you both follow each other.</p>'}${chatForm('dm', `Message ${t.name || ''}`, 500, !t.mutual)}</div>`;
  }
  if (!soc.threads) { refreshChat(true); return '<div class="card"><p class="sub">Opening your messages…</p></div>'; }
  const list = soc.threads.map(x => `<button class="thread${x.unread ? ' unread' : ''}" data-act="dm-open" data-id="${esc(x.user_id)}">${profilePic(x.face, 36)}
      <span class="thread-text"><b>${esc(x.name || 'Player')}</b><small>${x.last_body ? `${x.last_mine ? 'You: ' : ''}${esc(x.last_body)}` : x.mutual ? 'You follow each other. Say hi!' : ''}</small></span>
      ${x.unread ? `<span class="thread-badge">${x.unread}</span>` : x.last_at ? `<small class="thread-t">${agoText(Date.parse(x.last_at))}</small>` : ''}</button>`).join('');
  return `<div class="card"><p class="sub">Message anyone you and they both follow. Find players in world chat, your village, or by username.</p>
      <form class="chat-form" id="find-form"><input id="find-in" maxlength="20" placeholder="Find a player by username" autocapitalize="none" spellcheck="false" autocomplete="off"><button class="btn small ghost" type="submit">Find</button></form></div>
    ${list ? `<div class="card threads">${list}</div>` : '<div class="card"><p class="sub">No friends to message yet. Follow someone, and when they follow you back you can message each other.</p></div>'}`;
}
function afterChatDraw() {
  const l = $('#chat-list');
  if (l) l.scrollTop = l.scrollHeight;
  if (soc.tab === 'world' && soc.worldLoaded && soc.worldSeen !== soc.worldLast) { soc.worldSeen = soc.worldLast; socKeep(); }
  if (soc.tab === 'village' && vil.data && soc.villageSeen !== soc.villageLast) { soc.villageSeen = soc.villageLast; socKeep(); updateBadges(); }
  renderChatbar();
}
/* Fetch what the open room needs; redraw just the list while someone is typing. */
async function refreshChat(full) {
  if (soc.busy || !socialOn()) return;
  soc.busy = true;
  try {
    if (soc.tab === 'world') {
      await fetchWorld();
    } else if (soc.tab === 'village') {
      await loadVillage();
    } else if (soc.thread) {
      const r = await rpc('dm_thread', { p_with: soc.thread.with, p_after: 0 });
      soc.thread = r;
      if (soc.dms) { soc.dms = 0; updateBadges(); }
    } else {
      const r = await rpc('dm_threads');
      soc.threads = r.threads || [];
      soc.dms = soc.threads.reduce((a, t) => a + (t.unread || 0), 0);
    }
  } catch (e) { toast(String(e.message || e)); }
  soc.busy = false;
  renderChatbar();
  if (!chatOpenNow()) return;
  const typing = document.activeElement && document.activeElement.id === 'chat-in';
  if (full || !typing || !$('#chat-list')) drawChat();
  else { const fresh = document.createElement('div'); fresh.innerHTML = viewChat(); const nl = fresh.querySelector('#chat-list'); if (nl) { $('#chat-list').innerHTML = nl.innerHTML; afterChatDraw(); } }
}
const lastWorldId = () => soc.world.length ? soc.world[soc.world.length - 1].id : 0;
async function fetchWorld() {
  const after = soc.worldLoaded ? lastWorldId() : 0;
  const r = await rpc('world_chat_recent', { p_after: after });
  const have = lastWorldId();
  soc.world = soc.world.concat((r.messages || []).filter(m => m.id > have)).slice(-80);
  soc.worldLoaded = true;
  if (soc.world.length) soc.worldLast = Math.max(soc.worldLast, lastWorldId());
}

/* The bar's previews: fetched once you're online, then only when the minute's ping says a room has something new. */
let previewBusy = false;
async function refreshPreviews() {
  if (!socialOn() || previewBusy || document.visibilityState === 'hidden') { renderChatbar(); return; }
  previewBusy = true;
  try {
    if (!soc.worldLoaded || soc.worldLast > lastWorldId()) await fetchWorld();
    if (soc.villageLast && soc.villageLast !== soc.villageFor && !vil.loading) { soc.villageFor = soc.villageLast; await loadVillage(); }
    if (!soc.threads || soc.dms !== soc.dmsFor) {
      const r = await rpc('dm_threads');
      soc.threads = r.threads || [];
      soc.dmsFor = soc.dms = soc.threads.reduce((a, t) => a + (t.unread || 0), 0);
    }
  } catch (e) { /* offline: the bar keeps what it had */ }
  previewBusy = false;
  renderChatbar();
}
function chatbarHTML() {
  if (!featureOn('chatbar')) return '';
  if (!socialOn()) return `<button class="cb cb-wide" data-act="chat-open" data-id="world"><span class="cb-k">Chat</span><span class="cb-p">Talk with everyone in the valley. Tap to sign in.</span></button>`;
  const who = (id, name) => id === myId() ? 'You' : name || 'Someone';
  const line = (name, body) => `<b>${esc(name)}:</b> ${esc(body)}`;
  const w = soc.world.filter(m => !isBlocked(m.user_id)).slice(-1)[0];
  const v = vil.data ? (vil.board || []).find(e => e.kind === 'chat' && !isBlocked(e.user_id)) : null;
  const t = (soc.threads || []).find(x => x.last_body);
  const cell = (id, k, preview, dot) => `<button class="cb" data-act="chat-open" data-id="${id}" aria-label="Open ${k} chat"><span class="cb-k">${k}${dot ? `<i class="cb-dot">${dot === true ? '' : dot}</i>` : ''}</span><span class="cb-p">${preview}</span></button>`;
  return cell('world', 'World', w ? line(who(w.user_id, w.name), w.body) : soc.worldLoaded ? 'Say hello to the valley' : '…', false)
    + cell('village', 'Village', !vil.at ? '…' : !vil.data ? 'Join a village' : v ? line(who(v.user_id, whoName(v.user_id)), v.body) : 'Say hello to your neighbours', soc.villageLast > soc.villageSeen)
    + cell('dm', 'Messages', soc.dms ? `<b>${plural(soc.dms, 'new message')}</b>` : t ? line(t.last_mine ? 'You' : t.name || 'Player', t.last_body) : 'Message your friends', soc.dms || false);
}
let chatbarLast = null;
function renderChatbar() {
  const bar = $('#chatbar');
  if (!bar || !state) return;
  const html = chatbarHTML();
  if (html === chatbarLast) return;
  chatbarLast = html;
  bar.innerHTML = html;
  bar.hidden = !html;
  document.body.classList.toggle('has-chatbar', !!html);
}
async function sendChat(kind, text) {
  const body = String(text || '').trim();
  if (!body) return;
  try {
    if (kind === 'world') await rpc('post_world_message', { p_body: body });
    else if (kind === 'village') await rpc('post_village_message', { p_body: body });
    else if (kind === 'dm' && soc.thread) await rpc('send_dm', { p_to: soc.thread.with, p_body: body });
    soc.draft = '';
    const i = $('#chat-in'); if (i) i.value = '';
    play('tick');
    await refreshChat(true);
    const again = $('#chat-in'); if (again) again.focus({ preventScroll: true });
  } catch (e) { toast(String(e.message || e)); }
}
async function openDm(id) {
  closeSheet();
  soc.thread = { with: id, name: '', face: '', mutual: true, messages: [] };
  openChat('dm', true);
  await refreshChat(true);
}
async function findPlayer(name) {
  const u = String(name || '').trim().toLowerCase();
  if (!u) return;
  try {
    const p = await rpc('find_player', { p_username: u });
    if (!p) { toast('No player with that username.'); return; }
    soc.profile = p;
    showProfile(p);
  } catch (e) { toast(String(e.message || e)); }
}

document.addEventListener('submit', e => {
  const f = e.target;
  if (f.id === 'chat-form') { e.preventDefault(); sendChat(f.dataset.kind, ($('#chat-in') || {}).value); }
  else if (f.id === 'find-form') { e.preventDefault(); findPlayer(($('#find-in') || {}).value); }
});
document.addEventListener('input', e => { if (e.target && e.target.id === 'chat-in') soc.draft = e.target.value; });
// the open chat refreshes every 8 seconds; the bell, badges and the bar's previews once a minute
setInterval(() => { if (chatOpenNow() && socialOn() && document.visibilityState !== 'hidden') refreshChat(false); }, 8000);
setInterval(socialPing, 60000);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') socialPing(); });

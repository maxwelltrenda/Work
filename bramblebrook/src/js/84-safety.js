/* ---------- safety: report, block, delete my account, and the rules ----------
   Apple asks every app with chat for four things, and players deserve them anyway: a way to report what
   someone said, a way to block them, a filter (on the server: see supabase/security_and_safety.sql) and
   someone who acts on reports (the owner's inbox, 82-feedback.js). Deleting an account takes everything the
   account owns off the server; the farm on this device stays. */
const LEGAL = { privacy: SITE_URL + '/privacy', terms: SITE_URL + '/terms', support: SITE_URL + '/support' };
const legalLink = (k, text) => `<a class="linkish" href="${LEGAL[k]}" target="_blank" rel="noopener">${text}</a>`;
const isBlocked = id => !!(id && soc.blocked && soc.blocked.includes(id));
const safe = { report: null, reason: '', busy: false };

/* The little ⋯ on someone else's message: report it, or block them. */
function msgMenuHTML(kind, id, user, name) {
  if (!user || user === myId()) return '';
  return `<button class="msg-more" data-act="msg-menu" data-kind="${esc(kind)}" data-id="${esc(String(id || ''))}" data-user="${esc(user)}" data-name="${esc(name || '')}" aria-label="Report or block">⋯</button>`;
}
function msgMenu(el) {
  const d = el.dataset;
  openSheet(`<h2>${esc(d.name || 'This player')}</h2>
    <div class="sheet-btns" style="display:grid">
      ${d.id ? `<button class="btn" data-act="report-open" data-kind="${esc(d.kind)}" data-id="${esc(d.id)}" data-user="${esc(d.user)}" data-name="${esc(d.name)}">🚩 Report this message</button>` : ''}
      <button class="btn ghost" data-act="report-open" data-kind="profile" data-id="" data-user="${esc(d.user)}" data-name="${esc(d.name)}">🚩 Report this player</button>
      <button class="btn ghost danger" data-act="block" data-user="${esc(d.user)}" data-name="${esc(d.name)}">Block ${esc(d.name || 'them')}</button>
      <button class="btn small ghost" data-act="sheet-close">Cancel</button></div>`);
}

const REPORT_REASONS = [['bully', 'Bullying or harassment'], ['hate', 'Hate or slurs'], ['sexual', 'Sexual content'], ['spam', 'Spam or scams'], ['danger', 'Someone may be in danger'], ['other', 'Something else']];
function reportSheet(d) {
  safe.report = { kind: d.kind, ref: d.id ? +d.id : null, user: d.user, name: d.name };
  openSheet(`<h2>Report ${d.kind === 'profile' ? esc(d.name || 'this player') : 'this message'}</h2>
    <p class="sub">It goes straight to the person who runs Bramblebrook. They will look at it and can remove messages, mute or ban players.</p>
    <div class="report-reasons">${REPORT_REASONS.map(([k, n]) => `<button class="choice${safe.reason === k ? ' on' : ''}" data-act="report-reason" data-id="${k}">${n}</button>`).join('')}</div>
    <textarea id="report-note" class="fb-text" maxlength="400" placeholder="Anything else we should know? (optional)"></textarea>
    <div class="sheet-btns"><button class="btn" data-act="report-send"${safe.busy ? ' disabled' : ''}>Send report</button><button class="btn ghost" data-act="sheet-close">Cancel</button></div>`);
}
async function sendReport() {
  const r = safe.report;
  if (!r || safe.busy) return;
  const why = (REPORT_REASONS.find(x => x[0] === safe.reason) || [null, ''])[1];
  const note = String(($('#report-note') || {}).value || '').trim();
  safe.busy = true;
  try {
    await rpc('report_content', { p_kind: r.kind, p_ref: r.ref, p_user: r.user, p_reason: [why, note].filter(Boolean).join(': ') || null });
    safe.busy = false; safe.reason = '';
    openSheet(`<h2>Thanks for telling us</h2><p class="sub">Your report was sent. You won't see who handles it, but you'll get a note in your bell if action is taken.</p>
      ${isBlocked(r.user) ? '' : `<p class="sub">Don't want to see ${esc(r.name || 'them')} at all?</p>`}
      <div class="sheet-btns">${isBlocked(r.user) ? '' : `<button class="btn danger" data-act="block" data-user="${esc(r.user)}" data-name="${esc(r.name || '')}">Block ${esc(r.name || 'them')}</button>`}<button class="btn ghost" data-act="sheet-close">Done</button></div>`);
  } catch (e) { safe.busy = false; toast(String(e.message || e)); }
}

async function blockPlayer(user, name) {
  if (!confirm(`Block ${name || 'this player'}? You won't see their messages, and they can't message you. You stop following each other.`)) return;
  try {
    await rpc('block_player', { p_user: user });
    soc.blocked = (soc.blocked || []).concat(user);
    closeSheet();
    toast(`${name || 'They'} ${name ? 'is' : 'are'} blocked. Undo it any time in Settings › Online.`);
    soc.world = soc.world.filter(m => m.user_id !== user); soc.threads = null;
    if (soc.thread && soc.thread.with === user) soc.thread = null;
    renderView();
  } catch (e) { toast(String(e.message || e)); }
}
async function blockedSheet() {
  openSheet('<h2>Blocked players</h2><p class="sub">Loading…</p>');
  try {
    const r = await rpc('blocked_list');
    const list = r.blocked || [];
    soc.blocked = list.map(b => b.user_id);
    openSheet(`<h2>Blocked players</h2>
      ${list.length ? `<div class="notes">${list.map(b => `<div class="note"><span class="note-body"><b>${esc(b.name || b.username || 'Player')}</b><small>@${esc(b.username || '')}</small></span>
        <button class="btn small ghost" data-act="unblock" data-user="${esc(b.user_id)}">Unblock</button></div>`).join('')}</div>` : '<p class="sub">You haven\'t blocked anyone.</p>'}
      <div class="sheet-btns"><button class="btn small ghost" data-act="sheet-close">Close</button></div>`);
  } catch (e) { toast(String(e.message || e)); closeSheet(); }
}
async function unblockPlayer(user) {
  try { await rpc('unblock_player', { p_user: user }); soc.blocked = (soc.blocked || []).filter(x => x !== user); soc.worldLoaded = false; soc.world = []; blockedSheet(); }
  catch (e) { toast(String(e.message || e)); }
}

/* Delete my account: type the username, and it's gone from the server. The farm on this device stays. */
function deleteAccountSheet(err) {
  openSheet(`<h2>Delete your account</h2>
    <p class="sub">This deletes your online account <b>${esc(online.username || '')}</b> for good: your saved farm online, your profile, messages, follows and your place in a village. It can't be undone.</p>
    <p class="sub">The farm on this device stays, so you can keep playing without an account.</p>
    <label class="label" for="del-user">Type your username to confirm</label>
    <input id="del-user" autocapitalize="none" spellcheck="false" autocomplete="off" maxlength="20" placeholder="${esc(online.username || '')}">
    ${err ? `<p class="sub" style="color:var(--berry)">${esc(err)}</p>` : ''}
    <div class="sheet-btns"><button class="btn danger" data-act="delete-account-go">Delete my account</button><button class="btn ghost" data-act="sheet-close">Cancel</button></div>`);
}
async function deleteAccount() {
  const typed = String(($('#del-user') || {}).value || '').trim().toLowerCase();
  if (!online || typed !== String(online.username || '').toLowerCase()) { deleteAccountSheet('That doesn\'t match your username.'); return; }
  try {
    await rpc('delete_my_account', { p_confirm: typed });
    if (online.via === 'mcp') onl.link = 'missing';
    onlineSignOut();
    closeSheet();
    toast('Your account was deleted. Your farm stays on this device.');
    renderView();
  } catch (e) { deleteAccountSheet(String(e.message || e)); }
}

/* Settings: the safety and account lines under the online card. */
function safetyCardHTML() {
  const linked = online && (online.via !== 'mcp' || onl.link === 'ready');
  return `<div class="card"><h2>Safety &amp; privacy</h2>
    <p class="sub">Be kind. Messages are filtered, and anyone can be reported or blocked from the ⋯ next to what they said.</p>
    ${linked && ONLINE.social ? '<div class="row"><button class="btn small ghost" data-act="blocked-list">Blocked players</button></div>' : ''}
    <p class="sub">${legalLink('privacy', 'Privacy policy')} · ${legalLink('terms', 'Terms and community rules')} · ${legalLink('support', 'Help')}</p>
    ${linked ? '<div class="row"><button class="btn small ghost danger" data-act="delete-account">Delete my account</button></div>' : ''}</div>`;
}

/* The owner's moderation tab in the inbox. */
const REPORT_WHERE = { world: 'World chat', village: 'Village chat', dm: 'Message', profile: 'Profile' };
const REPORT_STATUS = { new: 'New', removed: 'Removed', muted: 'Muted', banned: 'Banned', dismissed: 'Dismissed' };
function reportsHTML(list) {
  if (!list.length) return `<p class="sub">${fb.filter === 'new' ? 'No new reports.' : 'No reports yet.'}</p>`;
  return `<div class="fb-list">${list.map(r => `<div class="fb-item">
      <div class="fb-head"><span class="note-ic">🚩</span><span class="fb-who"><b>${esc(r.target_name || 'Someone')}</b><small>${r.target_username ? '@' + esc(r.target_username) + ' · ' : ''}${esc(REPORT_WHERE[r.kind] || r.kind)} · ${agoText(Date.parse(r.created_at))}${r.target_reports > 1 ? ` · reported ${r.target_reports} times` : ''}${r.target_muted ? ' · muted now' : ''}</small></span>
        <span class="chip plain fb-st ${esc(r.status)}">${REPORT_STATUS[r.status] || esc(r.status)}</span></div>
      ${r.snapshot ? `<p class="fb-body">“${esc(r.snapshot)}”</p>` : ''}
      <p class="sub">Reported by ${esc(r.reporter_name || 'a player')}${r.reason ? `: ${esc(r.reason)}` : ''}</p>
      <div class="sheet-btns">${r.status === 'new' ? `${r.ref ? `<button class="btn small" data-act="mod" data-id="${r.id}" data-to="remove">Remove message</button>` : ''}
        <button class="btn small ghost" data-act="mod" data-id="${r.id}" data-to="mute">Mute 7 days</button>
        <button class="btn small ghost danger" data-act="mod" data-id="${r.id}" data-to="ban">Ban</button>
        <button class="btn small ghost" data-act="mod" data-id="${r.id}" data-to="dismiss">Dismiss</button>`
        : r.target_muted ? `<button class="btn small ghost" data-act="mod" data-id="${r.id}" data-to="unmute">Unmute</button>` : ''}</div></div>`).join('')}</div>`;
}
async function modAction(id, action) {
  if (action === 'ban' && !confirm('Ban this player? They can still play their farm, but can never post, message or found a village again.')) return;
  try {
    await rpc('mod_action', { p_report: id, p_action: action });
    toast({ remove: 'Message removed.', mute: 'Removed and muted for 7 days.', ban: 'Removed and banned.', unmute: 'Unmuted.', dismiss: 'Dismissed.' }[action]);
    play('tick');
    await feedbackInbox();
  } catch (e) { toast(String(e.message || e)); }
}

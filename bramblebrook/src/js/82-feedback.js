/* ---------- feedback: friends tell the game's maker what broke or what they'd like ----------
   One tap on the Feedback tab (right edge), in Settings or in the bell. The player writes a sentence; the game
   adds what screen they were on, their day and levels, their device, the last few taps, toasts and errors, so
   a bug can be found without a back-and-forth. Never anything they typed elsewhere, chat or messages.
   It lands in the `feedback` table (Supabase), the owner's bell pings, and Claude can read it straight away.
   Players without an account can send it too, from the website. */
const BUILD = '/*@BUILD@*/';
const fb = { kind: 'bug', draft: '', at: null, sending: false, inbox: null, reports: null, filter: 'new', replyTo: 0, reply: '', busy: 0 };
const fbLog = { acts: [], errs: [], toasts: [], t0: Date.now() };
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
function fbNote(kind, text) {
  try {
    const list = fbLog[kind];
    list.push({ t: Math.round((Date.now() - fbLog.t0) / 1000), x: String(text).replace(UUID_RE, '(player)').slice(0, 160) });
    if (list.length > 15) list.shift();
  } catch (e) { /* never let the recorder break the game */ }
}
document.addEventListener('click', e => {
  const el = e.target.closest && e.target.closest('[data-act]');
  if (!el) return;
  const d = el.dataset;
  if (['feedback', 'fb-kind', 'fb-send'].includes(d.act)) return;
  fbNote('acts', [d.act, d.id, d.tab, d.sub, d.to].filter(Boolean).join(' '));
}, true);
window.addEventListener('error', e => fbNote('errs', `${e.message || 'error'}${e.lineno ? ' @' + e.lineno : ''}`));
window.addEventListener('unhandledrejection', e => fbNote('errs', 'promise: ' + ((e.reason && (e.reason.message || e.reason)) || 'rejected')));

/* What was on screen when they tapped Feedback, read before the sheet covers it. */
function fbSnapshot() {
  const s = state || {};
  const open = bt ? 'battle: ' + ((bt.fight && bt.fight.n) || '') : raidUI.open ? 'village boss' : advRun ? 'adventure' : sceneOpen ? 'story scene'
    : $('#scene-root .scene-wrap') ? 'opening screen' : sheetOpen() ? 'a sheet: ' + (($('#sheet-root h2') || {}).textContent || '') : '';
  const levels = s.xp ? Object.values(s.xp).reduce((a, x) => a + levelInfo(x).lvl, 0) : 0;
  return {
    v: BUILD, where: inClaude() ? 'Claude' : 'website', screen: s.tab ? s.tab + (sub(s.tab) ? ' › ' + sub(s.tab) : '') : 'start', open,
    farmer: s.name || '', day: s.created ? dayNumber() : 0, chapter: (s.story && s.story.ci) || 0, levels, cls: (s.combat && s.combat.cls) || '',
    coins: Math.floor(s.coins || 0), account: online ? (viaLink() ? 'linked in Claude' : 'signed in') : 'none',
    device: { w: window.innerWidth, h: window.innerHeight, touch: 'ontouchstart' in window, ua: navigator.userAgent.slice(0, 180) },
    acts: fbLog.acts.slice(), toasts: fbLog.toasts.slice(), errs: fbLog.errs.slice(),
  };
}

function feedbackSheet() {
  if (!fb.at) fb.at = fbSnapshot();
  const kinds = [['bug', '🐞 A bug'], ['idea', '💡 An idea'], ['other', '💬 Other']];
  const ph = fb.kind === 'bug' ? 'What happened? What did you expect to happen?' : fb.kind === 'idea' ? 'What would make the game better?' : 'Tell us anything';
  openSheet(`<h2>Send feedback</h2>
    <p class="sub">It goes straight to the person making Bramblebrook, who sees it right away.</p>
    <div class="seg fb-kinds" role="radiogroup" aria-label="What kind of feedback">${kinds.map(([k, n]) => `<button class="seg-b${fb.kind === k ? ' on' : ''}" role="radio" aria-checked="${fb.kind === k}" data-act="fb-kind" data-id="${k}">${n}</button>`).join('')}</div>
    <textarea id="fb-in" class="fb-text" maxlength="2000" placeholder="${esc(ph)}" aria-label="Your feedback">${esc(fb.draft)}</textarea>
    <p class="sub fb-small">To help find the problem, this also sends the screen you were on, your day, levels and device, and your last few taps. Never your chat or messages.</p>
    <div class="sheet-btns"><button class="btn" data-act="fb-send"${fb.sending ? ' disabled' : ''}>${fb.sending ? 'Sending…' : 'Send'}</button><button class="btn ghost" data-act="sheet-close">Cancel</button></div>`);
  $('#sheet-root').classList.toggle('over-scene', !!$('#scene-root .scene-wrap'));
  const t = $('#fb-in');
  if (t && !('ontouchstart' in window)) setTimeout(() => t.focus({ preventScroll: true }), 50);   // on phones, wait for a tap so the keyboard doesn't jump up
}
function openFeedback() { fb.at = fbSnapshot(); feedbackSheet(); }
async function sendFeedback() {
  const body = String(($('#fb-in') || {}).value || fb.draft).trim();
  if (body.length < 3) { toast('Write a few words first.'); const t = $('#fb-in'); if (t) t.focus(); return; }
  if (fb.sending) return;
  fb.draft = body; fb.sending = true; feedbackSheet();
  const args = { p_kind: fb.kind, p_body: body, p_context: fb.at || fbSnapshot() };
  try {
    if (socialOn()) await rpc('send_feedback', args);
    else if (onlineAvailable()) await onlineApi('/rest/v1/rpc/send_feedback', { method: 'POST', body: args });
    else throw new Error(inClaude() ? 'Feedback needs your account linked: Bag › Settings › Online. Your words are kept here for when it is.' : 'You seem to be offline. Your words are kept: try again in a moment.');
    fb.sending = false; fb.draft = ''; fb.at = null; fb.kind = 'bug';
    play('chime');
    openSheet(`<h2>Thank you!</h2><p class="sub">Your feedback was sent and the game's maker has been told.${online ? ' When it is fixed or answered, you will get a note in your bell 🔔.' : ''}</p>
      <div class="sheet-btns"><button class="btn" data-act="sheet-close">Back to the game</button></div>`);
    $('#sheet-root').classList.toggle('over-scene', !!$('#scene-root .scene-wrap'));
  } catch (e) {
    fb.sending = false; feedbackSheet();
    toast(String(e.message || e));
  }
}

/* The owner's inbox: everything friends sent, newest first, with what was on their screen. */
const FB_KIND = { bug: '🐞', idea: '💡', other: '💬' };
const FB_STATUS = { new: 'New', seen: 'Seen', fixed: 'Fixed ✓', wontfix: "Won't fix" };
async function feedbackInbox() {
  openSheet('<h2>Feedback inbox</h2><p class="sub">Loading…</p>');
  try {
    const r = await rpc('feedback_inbox');
    fb.inbox = r.items || [];
    fb.reports = r.reports || [];
    soc.fbNew = fb.inbox.filter(x => x.status === 'new').length + fb.reports.filter(x => x.status === 'new').length;
    updateSocialBadges();
    drawInbox();
  } catch (e) { openSheet(`<h2>Feedback inbox</h2><p class="sub" style="color:var(--berry)">${esc(String(e.message || e))}</p><div class="sheet-btns"><button class="btn small ghost" data-act="sheet-close">Close</button></div>`); }
}
function fbContextHTML(c) {
  if (!c || typeof c !== 'object') return '';
  const line = [c.screen && 'on ' + c.screen, c.open, c.day && 'day ' + c.day, c.chapter != null && 'chapter ' + c.chapter, c.levels && c.levels + ' levels', c.cls, c.where, c.account && 'account: ' + c.account].filter(Boolean).join(' · ');
  const list = (name, xs) => xs && xs.length ? `<p><b>${name}</b></p><ol>${xs.map(a => `<li>${esc(a.x)} <small>${a.t}s</small></li>`).join('')}</ol>` : '';
  const d = c.device || {};
  return `<details class="fb-ctx"><summary>${esc(line || 'Details')}</summary>
    <p>${esc(`${d.w || '?'}×${d.h || '?'}${d.touch ? ', touch' : ''} · ${d.ua || ''}`)}</p>${c.v ? `<p>Build ${esc(c.v)}</p>` : ''}
    ${list('Errors', c.errs)}${list('Messages shown', c.toasts)}${list('Last taps', c.acts)}</details>`;
}
function drawInbox() {
  const all = fb.inbox || [], reps = fb.reports || [];
  const shown = fb.filter === 'new' ? all.filter(f => f.status === 'new') : all;
  const nNew = all.filter(f => f.status === 'new').length, rNew = reps.filter(r => r.status === 'new').length;
  const seg = `<div class="seg" role="tablist">${[['new', `New${nNew ? ' (' + nNew + ')' : ''}`], ['reports', `Reports${rNew ? ' (' + rNew + ')' : ''}`], ['all', 'All']].map(([k, n]) => `<button class="seg-b${fb.filter === k ? ' on' : ''}" role="tab" aria-selected="${fb.filter === k}" data-act="fb-filter" data-id="${k}">${n}</button>`).join('')}</div>`;
  const items = shown.map(f => {
    const replying = fb.replyTo === f.id;
    return `<div class="fb-item">
      <div class="fb-head"><span class="note-ic">${FB_KIND[f.kind] || '💬'}</span><span class="fb-who"><b>${esc(f.name || 'Someone')}</b><small>${f.username ? '@' + esc(f.username) + ' · ' : f.user_id ? '' : 'no account · '}${agoText(Date.parse(f.created_at))}</small></span>
        <span class="chip plain fb-st ${esc(f.status)}">${FB_STATUS[f.status] || esc(f.status)}</span></div>
      <p class="fb-body">${esc(f.body)}</p>
      ${fbContextHTML(f.context)}
      ${f.reply ? `<p class="sub">You replied: ${esc(f.reply)}</p>` : ''}
      ${replying ? `<textarea id="fb-reply" class="fb-text" maxlength="500" placeholder="Your reply, sent to their bell">${esc(fb.reply)}</textarea>
        <div class="sheet-btns"><button class="btn small" data-act="fb-mark" data-id="${f.id}" data-to="seen">Send reply</button><button class="btn small" data-act="fb-mark" data-id="${f.id}" data-to="fixed">Fixed + reply</button><button class="btn small ghost" data-act="fb-reply" data-id="0">Cancel</button></div>`
      : `<div class="sheet-btns">${f.status !== 'fixed' ? `<button class="btn small" data-act="fb-mark" data-id="${f.id}" data-to="fixed">Fixed ✓</button>` : ''}
          ${f.user_id ? `<button class="btn small ghost" data-act="fb-reply" data-id="${f.id}">Reply</button>` : ''}
          ${f.status === 'new' ? `<button class="btn small ghost" data-act="fb-mark" data-id="${f.id}" data-to="seen">Got it</button>` : ''}
          ${f.status !== 'wontfix' && f.status !== 'fixed' ? `<button class="btn small ghost" data-act="fb-mark" data-id="${f.id}" data-to="wontfix">Won't fix</button>` : ''}</div>`}
    </div>`;
  }).join('');
  const body = fb.filter === 'reports' ? reportsHTML(reps.slice().sort((a, b) => (a.status === 'new' ? 0 : 1) - (b.status === 'new' ? 0 : 1) || b.id - a.id))
    : items ? `<div class="fb-list">${items}</div>` : `<p class="sub">${fb.filter === 'new' ? 'Nothing new. Everything has been looked at.' : 'No feedback yet.'}</p>`;
  openSheet(`<h2>Feedback inbox</h2>
    <p class="sub">${fb.filter === 'reports' ? 'Players reported these. Removing, muting or banning tells the reporter action was taken.' : 'What players sent. Fixed and Reply send a note to their bell; Got it just clears it from New.'}</p>${seg}
    ${body}
    <div class="sheet-btns"><button class="btn small ghost" data-act="sheet-close">Close</button></div>`);
  if (fb.replyTo) { const t = $('#fb-reply'); if (t) t.focus({ preventScroll: true }); }
}
async function markFeedback(id, status) {
  const reply = fb.replyTo === id ? String(($('#fb-reply') || {}).value || '').trim() : '';
  if (fb.busy) return;
  fb.busy = id;
  try {
    await rpc('feedback_mark', { p_id: id, p_status: status, p_reply: reply || null });
    const f = (fb.inbox || []).find(x => x.id === id);
    if (f) { f.status = status; if (reply) f.reply = reply; }
    fb.replyTo = 0; fb.reply = '';
    soc.fbNew = (fb.inbox || []).filter(x => x.status === 'new').length + (fb.reports || []).filter(x => x.status === 'new').length;
    play('tick');
    toast(status === 'fixed' ? (f && f.user_id ? 'Marked fixed. They will get a note.' : 'Marked fixed.') : reply ? 'Reply sent.' : status === 'wontfix' ? 'Marked won\'t fix.' : 'Cleared from New.');
    drawInbox();
    if (state.tab === 'bag' && sub('bag') === 'settings') renderView();
  } catch (e) { toast(String(e.message || e)); }
  fb.busy = 0;
}

/* Settings card. */
function feedbackCardHTML() {
  const inbox = socialOn() && soc.admin ? `<div class="toggle"><div class="what"><b>Feedback inbox</b><small>${soc.fbNew ? `${soc.fbNew} new from players` : 'Nothing new from players'}</small></div><button class="btn small${soc.fbNew ? '' : ' ghost'}" data-act="fb-inbox">Open</button></div>` : '';
  return `<div class="card"><h2>Feedback</h2><p class="sub">Something broke, or you have an idea? Tell the game's maker. They see it right away.</p>
    <div class="row"><button class="btn small" data-act="feedback">Send feedback</button></div>
    <div class="toggle"><div class="what"><b>Feedback tab</b><small>The little tab on the right edge of the screen</small></div><button class="switch" role="switch" aria-label="Feedback tab" aria-checked="${!state.opts.fbTabOff}" data-act="opt" data-id="fbTabOff"></button></div>
    ${inbox}</div>`;
}
function placeFeedbackTab() {
  const tab = $('#fb-tab');
  if (tab) tab.hidden = !state || !!state.opts.fbTabOff;
}

document.addEventListener('input', e => {
  if (e.target && e.target.id === 'fb-in') fb.draft = e.target.value;
  if (e.target && e.target.id === 'fb-reply') fb.reply = e.target.value;
});

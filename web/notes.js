// Updates on tasks (Custodial tasks and Maintenance rounds), like text
// messages: the 💬 button opens the conversation for that task (mine on the
// right, everyone else's on the left), with a box to send at the bottom.
// The task card shows the latest message; tapping it opens the chat.
// Only people @mentioned get an alert ("@Rick"); typing @ shows the team's names (0062).

export async function loadNotes(sb, kind, ids) {
  if (!ids.length) return {};
  const { data, error } = await sb.from('task_notes').select('*').eq('kind', kind).in('task_id', ids).order('created_at');
  if (error) return {};
  const by = {};
  (data || []).forEach((n) => { (by[n.task_id] ||= []).push(n); });
  return by;
}

const when = (ts) => {
  const d = new Date(ts);
  const today = new Date().toDateString() === d.toDateString();
  return today ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : d.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
};
const first = (n) => String(n || 'Someone').split(' ')[0];

// The latest message on the card (tap to open the chat).
export function notesList(list, esc) {
  if (!list || !list.length) return '';
  const last = list[list.length - 1];
  return `<button type="button" class="tn-preview" data-tn-open="${last.kind}:${last.task_id}">
    <span class="tn-pv-text"><b>${esc(first(last.author))}:</b> ${esc(last.body)}</span>
    <span class="tn-pv-meta">${esc(when(last.created_at))} · ${list.length > 1 ? `${list.length} messages` : 'Reply'} ›</span></button>`;
}

export const noteButton = (kind, id, count) => `<button type="button" class="btn small tn-btn" data-tn-open="${kind}:${id}" title="Messages about this task">💬${count ? ` ${count}` : ' Update'}</button>`;

function openThread({ sb, toast, errMsg, esc, meId, canDeleteAll }, kind, id, title) {
  return new Promise((resolve) => {
    let changed = false;
    let poll = null;
    const back = document.createElement('div');
    back.className = 'modal-back';
    back.innerHTML = `<div class="modal tn-chat" role="dialog" aria-modal="true" aria-label="Messages">
      <div class="tn-head"><div><b>${esc(title || 'Task')}</b><span class="muted">Type @ and a name to alert someone.</span></div>
        <button type="button" class="tn-x" aria-label="Close">×</button></div>
      <div class="tn-msgs" aria-live="polite"><p class="muted tn-empty">Loading…</p></div>
      <div class="tn-at" hidden></div>
      <form class="tn-send"><textarea rows="1" placeholder="Message" aria-label="Message" enterkeyhint="send"></textarea><button class="btn primary">Send</button></form></div>`;
    const box = back.querySelector('.tn-msgs');
    const input = back.querySelector('textarea');
    const draw = (list) => {
      box.innerHTML = list.length ? list.map((n) => {
        const mine = n.member_id === meId;
        return `<div class="tn-msg ${mine ? 'mine' : ''}">
          ${mine ? '' : `<span class="tn-who">${esc(first(n.author))}</span>`}
          <div class="tn-bubble">${esc(n.body).replace(/\n/g, '<br>')}</div>
          <span class="tn-time">${esc(when(n.created_at))}${mine || canDeleteAll ? ` · <button type="button" class="tn-del" data-tn-del="${n.id}">Delete</button>` : ''}</span></div>`;
      }).join('') : '<p class="muted tn-empty">No messages yet. Ask a question or post an update.</p>';
      box.scrollTop = box.scrollHeight;
      box.querySelectorAll('[data-tn-del]').forEach((b) => b.addEventListener('click', async () => {
        const { error } = await sb.from('task_notes').delete().eq('id', b.dataset.tnDel).select('id');
        if (error) return toast(errMsg(error), true);
        changed = true; load();
      }));
    };
    const load = async () => {
      const { data, error } = await sb.from('task_notes').select('*').eq('kind', kind).eq('task_id', id).order('created_at');
      if (!error) draw(data || []);
    };
    const done = () => { clearInterval(poll); document.removeEventListener('keydown', onKey, true); back.remove(); resolve(changed); };
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); const at = back.querySelector('.tn-at'); if (!at.hidden) { at.hidden = true; return; } done(); } };
    document.addEventListener('keydown', onKey, true);
    back.querySelector('.tn-x').addEventListener('click', done);
    back.addEventListener('mousedown', (e) => { if (e.target === back) done(); });
    input.addEventListener('keydown', (e) => {
      // While @ names are showing: Enter/Tab picks the highlighted name, arrows move, Esc closes.
      const chips = [...back.querySelectorAll('.tn-at [data-at]')];
      if (!back.querySelector('.tn-at').hidden && chips.length) {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); atPick = (atPick + (e.key === 'ArrowDown' ? 1 : -1) + chips.length) % chips.length; markAt(); return; }
        if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); fillAt(chips[atPick].dataset.at); return; }
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); back.querySelector('.tn-at').hidden = true; return; }
      }
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); back.querySelector('form').requestSubmit(); }
    });
    // @mentions: show matching names while typing "@na…", tap one to fill it in.
    const atBox = back.querySelector('.tn-at');
    let team = [];
    sb.from('team_members').select('*').then(({ data }) => {
      const list = (data || []).filter((m) => m.active && (!['none', 'kiosk'].includes(m.role) || (kind === 'maintenance' && m.events_role)));
      team = list.map((m) => { const f = first(m.name); return list.filter((x) => first(x.name).toLowerCase() === f.toLowerCase()).length > 1 ? m.name : f; }).sort();
    });
    const atWord = () => { const v = input.value.slice(0, input.selectionStart); const m = v.match(/@([A-Za-z]*)$/); return m ? m[1] : null; };
    let atPick = 0;
    const markAt = () => atBox.querySelectorAll('[data-at]').forEach((b, i) => b.classList.toggle('on', i === atPick));
    const fillAt = (name) => {
      const pos = input.selectionStart;
      const before = input.value.slice(0, pos).replace(/@([A-Za-z]*)$/, `@${name} `);
      input.value = before + input.value.slice(pos);
      input.selectionStart = input.selectionEnd = before.length;
      atBox.hidden = true; input.focus();
    };
    const showAt = () => {
      const w = atWord();
      const hits = w === null ? [] : team.filter((n) => n.toLowerCase().startsWith(w.toLowerCase())).slice(0, 8);
      atBox.hidden = !hits.length;
      atPick = 0;
      atBox.innerHTML = hits.map((n) => `<button type="button" class="chip-btn" data-at="${esc(n)}">@${esc(n)}</button>`).join('');
      atBox.querySelectorAll('[data-at]').forEach((b) => b.addEventListener('mousedown', (e) => { e.preventDefault(); fillAt(b.dataset.at); }));
      markAt();
    };
    input.addEventListener('input', () => { input.style.height = 'auto'; input.style.height = `${Math.min(input.scrollHeight, 120)}px`; showAt(); });
    input.addEventListener('click', showAt);
    let sending = false;
    back.querySelector('form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = input.value.trim();
      if (!body || sending) return;
      sending = true;
      const { error } = await sb.from('task_notes').insert({ kind, task_id: Number(id), body }).select('id');
      sending = false;
      if (error) return toast(errMsg(error), true);
      input.value = ''; input.style.height = '';
      changed = true;
      load();
    });
    document.body.appendChild(back);
    load();
    poll = setInterval(() => { if (document.visibilityState === 'visible') load(); }, 10000);
    input.focus();
  });
}

// Wire up the 💬 buttons and previews inside root. names: { 'kind:id': 'Task name' }.
export function bindNotes(root, { sb, toast, errMsg, esc, meId, canDeleteAll, names = {} }, reload) {
  const escape = esc || ((v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])));
  root.querySelectorAll('[data-tn-open]').forEach((b) => b.addEventListener('click', async () => {
    const [kind, id] = b.dataset.tnOpen.split(':');
    const changed = await openThread({ sb, toast, errMsg, esc: escape, meId, canDeleteAll }, kind, id, names[b.dataset.tnOpen]);
    if (changed) reload();
  }));
}

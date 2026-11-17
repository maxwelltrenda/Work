// Updates on tasks (Custodial tasks and Maintenance rounds): a 💬 Update button,
// and the updates listed under the task, with replies, who wrote them and when.

export async function loadNotes(sb, kind, ids) {
  if (!ids.length) return {};
  const { data, error } = await sb.from('task_notes').select('*').eq('kind', kind).in('task_id', ids).order('created_at');
  if (error) return {};
  const by = {};
  (data || []).forEach((n) => { (by[n.task_id] ||= []).push(n); });
  return by;
}

const when = (ts) => new Date(ts).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

// Updates on a task, each with its replies underneath and a Reply button.
export function notesList(list, esc, meId, canDeleteAll) {
  if (!list || !list.length) return '';
  const one = (n, reply) => `<li class="${reply ? 'tn-reply' : ''}"><span class="tn-body">${esc(n.body).replace(/\n/g, '<br>')}</span>
    <span class="tn-meta">${esc(String(n.author || 'Someone').split(' ')[0])} · ${esc(when(n.created_at))}${reply ? '' : ` · <button type="button" class="tn-del" data-tn-reply="${n.kind}:${n.task_id}:${n.id}">Reply</button>`}${n.member_id === meId || canDeleteAll ? ` · <button type="button" class="tn-del" data-tn-del="${n.id}">Delete</button>` : ''}</span></li>`;
  const top = list.filter((n) => !n.parent_id);
  return `<ul class="tn-list">${top.map((n) => one(n, false) + list.filter((r) => r.parent_id === n.id).map((r) => one(r, true)).join('')).join('')}</ul>`;
}

export const noteButton = (kind, id, count) => `<button type="button" class="btn small tn-btn" data-tn-add="${kind}:${id}" title="Post an update">💬${count ? ` ${count}` : ' Update'}</button>`;

function askNote(title, reply = false) {
  return new Promise((resolve) => {
    const back = document.createElement('div');
    back.className = 'modal-back';
    back.innerHTML = `<form class="modal" role="dialog" aria-modal="true" aria-label="Add a note">
      <h3>${reply ? 'Reply' : 'Post an update'}</h3><p class="muted">${title}</p>
      <textarea class="tn-input" rows="4" placeholder="${reply ? 'Write a reply' : 'e.g. Out of mopheads, used the last one'}" required></textarea>
      <p class="muted" style="font-size:13px;margin:6px 0 0">The people on this task get an alert.</p>
      <div class="modal-actions"><button type="button" class="btn" data-cancel>Cancel</button><button class="btn primary">${reply ? 'Send reply' : 'Post'}</button></div></form>`;
    const done = (v) => { back.remove(); resolve(v); };
    back.querySelector('[data-cancel]').addEventListener('click', () => done(null));
    back.addEventListener('mousedown', (e) => { if (e.target === back) done(null); });
    back.querySelector('form').addEventListener('submit', (e) => { e.preventDefault(); const v = back.querySelector('textarea').value.trim(); if (v) done(v); });
    document.body.appendChild(back);
    back.querySelector('textarea').focus();
  });
}

// Wire up the Note and Delete buttons inside root. names: { 'kind:id': 'Task name' }.
export function bindNotes(root, { sb, toast, errMsg, askConfirm, names = {} }, reload) {
  root.querySelectorAll('[data-tn-add]').forEach((b) => b.addEventListener('click', async () => {
    const [kind, id] = b.dataset.tnAdd.split(':');
    const body = await askNote(names[b.dataset.tnAdd] || '');
    if (!body) return;
    const { error } = await sb.from('task_notes').insert({ kind, task_id: Number(id), body }).select('id');
    if (error) return toast(errMsg(error), true);
    toast('Update posted');
    reload();
  }));
  root.querySelectorAll('[data-tn-reply]').forEach((b) => b.addEventListener('click', async () => {
    const [kind, id, parent] = b.dataset.tnReply.split(':');
    const body = await askNote(names[`${kind}:${id}`] || '', true);
    if (!body) return;
    const { error } = await sb.from('task_notes').insert({ kind, task_id: Number(id), parent_id: Number(parent), body }).select('id');
    if (error) return toast(errMsg(error), true);
    toast('Reply sent');
    reload();
  }));
  root.querySelectorAll('[data-tn-del]').forEach((b) => b.addEventListener('click', async () => {
    if (askConfirm && !(await askConfirm('Delete this note?', { ok: 'Delete', danger: true }))) return;
    const { error } = await sb.from('task_notes').delete().eq('id', b.dataset.tnDel).select('id');
    if (error) return toast(errMsg(error), true);
    reload();
  }));
}

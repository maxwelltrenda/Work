// Notes on tasks (Custodial tasks and Maintenance rounds): a 📝 Note button,
// and the notes listed under the task with who wrote them and when.

export async function loadNotes(sb, kind, ids) {
  if (!ids.length) return {};
  const { data, error } = await sb.from('task_notes').select('*').eq('kind', kind).in('task_id', ids).order('created_at');
  if (error) return {};
  const by = {};
  (data || []).forEach((n) => { (by[n.task_id] ||= []).push(n); });
  return by;
}

const when = (ts) => new Date(ts).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

export function notesList(list, esc, meId, canDeleteAll) {
  if (!list || !list.length) return '';
  return `<ul class="tn-list">${list.map((n) => `<li><span class="tn-body">${esc(n.body).replace(/\n/g, '<br>')}</span>
    <span class="tn-meta">${esc(String(n.author || 'Someone').split(' ')[0])} · ${esc(when(n.created_at))}${n.member_id === meId || canDeleteAll ? ` · <button type="button" class="tn-del" data-tn-del="${n.id}">Delete</button>` : ''}</span></li>`).join('')}</ul>`;
}

export const noteButton = (kind, id, count) => `<button type="button" class="btn small tn-btn" data-tn-add="${kind}:${id}" title="Add a note">📝${count ? ` ${count}` : ' Note'}</button>`;

function askNote(title) {
  return new Promise((resolve) => {
    const back = document.createElement('div');
    back.className = 'modal-back';
    back.innerHTML = `<form class="modal" role="dialog" aria-modal="true" aria-label="Add a note">
      <h3>Add a note</h3><p class="muted">${title}</p>
      <textarea class="tn-input" rows="4" placeholder="e.g. Out of mopheads, used the last one" required></textarea>
      <div class="modal-actions"><button type="button" class="btn" data-cancel>Cancel</button><button class="btn primary">Save note</button></div></form>`;
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
    toast('Note saved');
    reload();
  }));
  root.querySelectorAll('[data-tn-del]').forEach((b) => b.addEventListener('click', async () => {
    if (askConfirm && !(await askConfirm('Delete this note?', { ok: 'Delete', danger: true }))) return;
    const { error } = await sb.from('task_notes').delete().eq('id', b.dataset.tnDel).select('id');
    if (error) return toast(errMsg(error), true);
    reload();
  }));
}

// My tasks: each person's own to-do list. Admins can open anyone's list
// (#/mytasks/<member id>) to see it or add to it.

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n) => String(n).padStart(2, '0');
const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const dshort = (iso) => { const [, m, d] = String(iso).slice(0, 10).split('-').map(Number); return `${MON[m - 1]} ${d}`; };

export function myTaskPages(ctx) {
  const { sb, q, esc, toast, askConfirm, errMsg, pageHead, me, isAdmin } = ctx;
  const app = document.getElementById('app');

  async function renderMyTasks(who) {
    const admin = isAdmin();
    const mine = me();
    const members = admin ? await q(sb.from('team_members').select('id, name, role, active').order('name')) : [];
    const crew = members.filter((m) => m.active && !['kiosk', 'none'].includes(m.role));
    const person = (admin && who && crew.find((m) => m.id === who)) || mine;
    const self = person.id === mine.id;
    const rows = await q(sb.from('personal_tasks').select('*').eq('member_id', person.id).order('created_at', { ascending: false }));
    const open = rows.filter((t) => !t.done_at).sort((a, b) => String(a.due_on || '9999').localeCompare(String(b.due_on || '9999')));
    const done = rows.filter((t) => t.done_at).sort((a, b) => String(b.done_at).localeCompare(String(a.done_at)));
    const today = todayIso();
    const first = String(person.name).split(' ')[0];

    const item = (t) => `<div class="mt-item${t.done_at ? ' done' : ''}${!t.done_at && t.due_on && t.due_on < today ? ' late' : ''}">
        <button class="mt-check" data-mt-done="${t.id}" aria-label="${t.done_at ? 'Mark not done' : 'Mark done'}">${t.done_at ? '✓' : ''}</button>
        <div class="mt-body"><b>${esc(t.title)}</b>
          <span class="mt-meta">${[t.due_on ? (t.done_at ? `Due ${dshort(t.due_on)}` : t.due_on < today ? `<span class="late-txt">Late · was due ${dshort(t.due_on)}</span>` : t.due_on === today ? '<b>Due today</b>' : `Due ${dshort(t.due_on)}`) : '',
            t.done_at ? `Done ${esc(new Date(t.done_at).toLocaleDateString([], { month: 'short', day: 'numeric' }))}` : '',
            t.created_by && t.created_by !== person.name ? `Added by ${esc(String(t.created_by).split(' ')[0])}` : ''].filter(Boolean).join(' · ')}</span>
          ${t.notes ? `<span class="mt-notes">${esc(t.notes)}</span>` : ''}</div>
        <button class="mt-x" data-mt-del="${t.id}" aria-label="Delete" title="Delete">×</button></div>`;

    app.innerHTML = `
      ${pageHead('Personal', self ? 'My <span class="accent">tasks</span>' : `${esc(first)}'s <span class="accent">tasks</span>`, self ? 'Your own to-do list. Only you and the admins can see it.' : `${esc(person.name)}'s to-do list.`)}
      ${admin && crew.length ? `<div class="mt-people">${crew.map((m) => `<a class="chip-btn${m.id === person.id ? ' on' : ''}" href="#/mytasks/${m.id === mine.id ? '' : m.id}">${esc(m.id === mine.id ? 'Me' : m.name.split(' ')[0])}</a>`).join('')}</div>` : ''}
      <form class="card mt-add" id="mt-add">
        <input name="title" required autocomplete="off" placeholder="${self ? 'Add a task, e.g. Create stock carts' : `Add a task for ${esc(first)}`}" aria-label="New task">
        <label class="mt-due"><span>Due</span><input type="date" name="due_on"></label>
        <button class="btn primary">Add</button>
        <details class="mt-more"><summary>Add a note</summary><textarea name="notes" rows="2" placeholder="Details, where, what's needed"></textarea></details>
      </form>
      <h2 class="mt-h">To do <span class="muted">${open.length}</span></h2>
      <div class="mt-list">${open.map(item).join('') || `<p class="muted mt-empty">${self ? 'Nothing on your list. Nice.' : 'Nothing on the list.'}</p>`}</div>
      ${done.length ? `<details class="mt-donebox"><summary>Done <span class="muted">${done.length}</span></summary><div class="mt-list">${done.slice(0, 50).map(item).join('')}</div></details>` : ''}`;

    const reload = () => renderMyTasks(self ? null : person.id);
    app.querySelector('#mt-add').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      const title = String(f.get('title') || '').trim();
      if (!title) return;
      try {
        await q(sb.from('personal_tasks').insert({ member_id: person.id, title, due_on: f.get('due_on') || null, notes: String(f.get('notes') || '').trim() || null }).select('id'));
        toast(self ? 'Added to your list' : `Added to ${first}'s list`);
        reload();
      } catch (err) { toast(errMsg(err), true); }
    });
    app.querySelectorAll('[data-mt-done]').forEach((b) => b.addEventListener('click', async () => {
      const t = rows.find((x) => String(x.id) === b.dataset.mtDone);
      try { await q(sb.from('personal_tasks').update({ done_at: t.done_at ? null : new Date().toISOString() }).eq('id', t.id).select('id')); if (!t.done_at) toast('Done ✓'); reload(); } catch (err) { toast(errMsg(err), true); }
    }));
    app.querySelectorAll('[data-mt-del]').forEach((b) => b.addEventListener('click', async () => {
      const t = rows.find((x) => String(x.id) === b.dataset.mtDel);
      if (!(await askConfirm(`Delete "${t.title}"?`, { ok: 'Delete', danger: true }))) return;
      try { await q(sb.from('personal_tasks').delete().eq('id', t.id).select('id')); reload(); } catch (err) { toast(errMsg(err), true); }
    }));
  }

  return { renderMyTasks };
}

// Maintenance schedule: recurring upkeep on fixed calendar periods (weekly,
// monthly, quarterly, yearly), each with an optional window such as "first 14
// days of the quarter". The database does the scheduling (0029_maintenance_schedule.sql):
// opening the page calls pm_refresh(), which opens this period's tasks and
// marks anything left from an ended period as Missed.

const FREQS = [['weekly', 'Weekly', 'week'], ['monthly', 'Monthly', 'month'], ['quarterly', 'Quarterly', 'quarter'], ['yearly', 'Yearly', 'year']];
const FREQ_LABEL = Object.fromEntries(FREQS.map(([k, l]) => [k, l]));
const FREQ_NOUN = Object.fromEntries(FREQS.map(([k, , n]) => [k, n]));
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const parts = (d) => String(d).slice(0, 10).split('-').map(Number);
const dshort = (d) => { const [, m, dd] = parts(d); return `${MON[m - 1]} ${dd}`; };
const dayDiff = (a, b) => Math.round((new Date(`${a}T12:00:00`) - new Date(`${b}T12:00:00`)) / 864e5);

function periodLabel(freq, start) {
  const [y, m] = parts(start);
  if (freq === 'weekly') return `Week of ${dshort(start)}`;
  if (freq === 'monthly') return `${MONTH[m - 1]} ${y}`;
  if (freq === 'quarterly') return `Q${Math.floor((m - 1) / 3) + 1} ${y} · ${MON[m - 1]}–${MON[m + 1]}`;
  return String(y);
}
const windowText = (t) => (t.due_days ? `First ${t.due_days} day${t.due_days === 1 ? '' : 's'} of each ${FREQ_NOUN[t.frequency]}` : `Any time in the ${FREQ_NOUN[t.frequency]}`);

export function schedulePages(ctx) {
  const { sb, q, rpc, esc, toast, askConfirm, errMsg, pageHead, loadLocations } = ctx;
  const app = document.getElementById('app');

  async function renderSchedule(view = 'now') {
    const today = await rpc('pm_refresh');
    const [tasks, runs, members, locations] = await Promise.all([
      q(sb.from('pm_tasks').select('*').order('sort').order('id')),
      q(sb.from('pm_runs').select('*').order('period_start', { ascending: false }).limit(1000)),
      q(sb.from('team_members').select('id, name')),
      loadLocations(),
    ]);
    const who = Object.fromEntries(members.map((m) => [m.id, m.name]));
    const taskBy = Object.fromEntries(tasks.map((t) => [t.id, t]));
    const current = runs.filter((r) => taskBy[r.task_id]?.active && r.period_start <= today && r.period_end >= today);
    const overdue = current.filter((r) => r.status === 'open' && r.due_on < today);
    const dueSoon = current.filter((r) => r.status === 'open' && r.due_on >= today && dayDiff(r.due_on, today) <= 7);
    const done = current.filter((r) => r.status === 'done');
    const active = tasks.filter((t) => t.active);
    const tabs = [['now', 'This period'], ['tasks', `All tasks <b>${active.length}</b>`], ['history', 'History']];

    app.innerHTML = `
      ${pageHead('Maintenance', 'Maintenance <span class="accent">schedule</span>', 'Weekly, monthly, quarterly and yearly upkeep. Each list starts over on its own when the next week, month, quarter or year begins.')}
      <div class="stats">
        <div class="stat"><b style="color:${overdue.length ? 'var(--bad)' : 'inherit'}">${overdue.length}</b><span>overdue</span></div>
        <div class="stat"><b>${dueSoon.length}</b><span>due in the next 7 days</span></div>
        <div class="stat"><b>${done.length} of ${current.length}</b><span>done this period</span></div>
      </div>
      <div class="seg">${tabs.map(([k, t]) => `<a href="#/schedule${k === 'now' ? '' : `/${k}`}" class="${view === k ? 'on' : ''}">${t}</a>`).join('')}</div>
      <div id="pm-view">${view === 'tasks' ? taskList(tasks, locations) : view === 'history' ? history(runs, taskBy, who, today) : nowView(current, taskBy, who, today)}</div>`;

    bind(view, tasks, current);
  }

  // ---- This period -------------------------------------------------------
  function nowView(current, taskBy, who, today) {
    if (!current.length) {
      return `<div class="card pm-empty"><b>Nothing on the schedule yet.</b><p class="muted">Add the recurring jobs under <a href="#/schedule/tasks">All tasks</a>: what it is, how often, and how many days into the period it should be done by.</p></div>`;
    }
    return FREQS.map(([f, label]) => {
      const rs = current.filter((r) => taskBy[r.task_id].frequency === f)
        .sort((a, b) => (b.status === 'open') - (a.status === 'open') || a.due_on.localeCompare(b.due_on) || taskBy[a.task_id].sort - taskBy[b.task_id].sort);
      if (!rs.length) return '';
      const left = rs.filter((r) => r.status === 'open').length;
      return `<h2 class="pm-sect">${label} <span class="muted">${periodLabel(f, rs[0].period_start)} · ${left ? `${left} to do` : 'all done'}</span></h2>
        <div class="pm-list">${rs.map((r) => runCard(r, taskBy[r.task_id], who, today)).join('')}</div>`;
    }).join('');
  }

  function dueText(r, today) {
    if (r.status === 'done') return '';
    if (r.status === 'skipped') return '<span class="pm-due">Skipped this time</span>';
    if (r.due_on < today) return `<span class="pm-due late">Overdue · was due ${dshort(r.due_on)}</span>`;
    if (r.due_on === today) return '<span class="pm-due soon">Due today</span>';
    const n = dayDiff(r.due_on, today);
    return `<span class="pm-due${n <= 7 ? ' soon' : ''}">Due by ${dshort(r.due_on)}${n <= 7 ? ` · ${n} day${n === 1 ? '' : 's'}` : ''}</span>`;
  }

  function runCard(r, t, who, today) {
    const isDone = r.status === 'done';
    const steps = t.steps || [];
    return `<div class="pm-card ${r.status}${r.status === 'open' && r.due_on < today ? ' late' : ''}">
      <button class="pm-check" data-mark="${r.id}" data-to="${isDone ? 'open' : 'done'}" aria-label="${isDone ? 'Mark not done' : 'Mark done'}">${isDone ? '✓' : ''}</button>
      <div class="pm-body">
        <b class="pm-name">${esc(t.name)}</b>
        <span class="pm-meta">${[t.location ? esc(t.location) : '', dueText(r, today)].filter(Boolean).join(' · ')}</span>
        ${isDone ? `<span class="pm-meta pm-donewho">Done by ${esc(who[r.done_by] || 'someone')} · ${new Date(r.done_at).toLocaleDateString([], { month: 'short', day: 'numeric' })}${r.note ? ` · ${esc(r.note)}` : ''}</span>` : ''}
        ${t.notes ? `<span class="pm-notes">${esc(t.notes)}</span>` : ''}
        ${steps.length ? `<div class="pm-steps">${steps.map((s, i) => `<label><input type="checkbox" data-step="${r.id}" data-i="${i}" ${(r.steps_done || []).includes(i) ? 'checked' : ''}> ${esc(s)}</label>`).join('')}</div>` : ''}
      </div>
      <div class="pm-actions">${r.status === 'open' ? `<button class="btn small" data-mark="${r.id}" data-to="skipped" title="Not needed this time">Skip</button>` : r.status === 'skipped' ? `<button class="btn small" data-mark="${r.id}" data-to="open">Undo skip</button>` : ''}</div>
    </div>`;
  }

  // ---- All tasks (the master list) ---------------------------------------
  function taskForm(t = {}, locations = []) {
    const locNames = locations.map((l) => l.name);
    if (t.location && !locNames.includes(t.location)) locNames.push(t.location);
    return `<div class="row">
        <label style="flex:2;min-width:220px">Task <input name="name" required value="${esc(t.name || '')}" placeholder="Change AC filters"></label>
        <label style="width:150px">How often <select name="frequency">${FREQS.map(([k, l]) => `<option value="${k}" ${t.frequency === k || (!t.frequency && k === 'monthly') ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <label style="width:210px" title="Leave empty if it can be done any time in the period">Due within the first <input name="due_days" type="number" min="1" max="366" value="${t.due_days ?? ''}" placeholder="any time"> <span class="muted pm-unit">days</span></label>
        <label style="flex:1;min-width:170px">Location <select name="location"><option value="">— None —</option>${locNames.map((n) => `<option ${n === t.location ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></label>
      </div>
      <label style="margin-top:10px">Steps <span class="muted">(optional, one per line)</span><textarea name="steps" rows="3" placeholder="North building units&#10;South building units">${esc((t.steps || []).join('\n'))}</textarea></label>
      <label style="margin-top:10px">Notes <span class="muted">(optional: sizes, part numbers, who to call)</span><input name="notes" value="${esc(t.notes || '')}" placeholder="20x25x1 MERV 8"></label>`;
  }

  function taskList(tasks, locations) {
    const active = tasks.filter((t) => t.active);
    const archived = tasks.filter((t) => !t.active);
    const rows = (list) => list.map((t) => `<details class="card pm-task" data-task="${t.id}">
        <summary><b>${esc(t.name)}</b> <span class="muted">${FREQ_LABEL[t.frequency]} · ${windowText(t)}${t.location ? ` · ${esc(t.location)}` : ''}</span></summary>
        <form data-edit="${t.id}" style="margin-top:12px">${taskForm(t, locations)}
          <div class="row" style="margin-top:12px"><button class="btn primary">Save</button>
          <button type="button" class="btn ${t.active ? 'bad' : ''}" data-active="${t.id}" data-to="${t.active ? '0' : '1'}">${t.active ? 'Take off the schedule' : 'Put back on the schedule'}</button></div></form></details>`).join('');
    return `<details class="card" ${tasks.length ? '' : 'open'}><summary><b>+ Add a recurring task</b></summary>
        <form id="pm-add" style="margin-top:12px">${taskForm({}, locations)}
          <p class="muted pm-hint">Example: <b>Change AC filters</b> · Quarterly · first 14 days → due Jan 1–14, Apr 1–14, Jul 1–14 and Oct 1–14.</p>
          <button class="btn primary">Add task</button></form></details>
      ${FREQS.map(([f, label]) => { const list = active.filter((t) => t.frequency === f); return list.length ? `<h2 class="pm-sect">${label} <span class="muted">${list.length}</span></h2>${rows(list)}` : ''; }).join('')}
      ${archived.length ? `<h2 class="pm-sect">Off the schedule <span class="muted">${archived.length}</span></h2>${rows(archived)}` : ''}`;
  }

  // ---- History ------------------------------------------------------------
  function history(runs, taskBy, who, today) {
    const past = runs.filter((r) => r.period_end < today || r.status !== 'open').slice(0, 300);
    if (!past.length) return '<p class="muted">Nothing yet. Finished, skipped and missed tasks show up here.</p>';
    const label = { done: 'Done', skipped: 'Skipped', missed: 'Missed', open: 'Open' };
    return `<div class="table-wrap"><table><tr><th>Period</th><th>Task</th><th>Status</th><th>Who</th><th>When</th><th>Note</th></tr>
      ${past.map((r) => { const t = taskBy[r.task_id]; const late = r.status === 'done' && r.done_at && r.done_at.slice(0, 10) > r.due_on;
        return `<tr><td>${periodLabel(t.frequency, r.period_start)}</td><td>${esc(t.name)}</td>
        <td><span class="pill ${r.status === 'done' ? 'available' : r.status === 'missed' ? 'lost' : 'closed'}">${label[r.status]}</span>${late ? ' <span class="muted">late</span>' : ''}</td>
        <td>${esc(who[r.done_by] || '')}</td><td>${r.done_at ? new Date(r.done_at).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) : ''}</td><td>${esc(r.note || '')}</td></tr>`; }).join('')}</table></div>`;
  }

  // ---- Actions --------------------------------------------------------------
  const fields = (f) => ({
    p_name: f.get('name'), p_frequency: f.get('frequency'),
    p_due_days: f.get('due_days') ? Math.max(1, parseInt(f.get('due_days'), 10)) : null,
    p_location: f.get('location') || null, p_notes: f.get('notes') || null,
    p_steps: String(f.get('steps') || '').split('\n').map((s) => s.trim()).filter(Boolean),
  });

  function bind(view, tasks, current) {
    const reload = () => renderSchedule(view);
    app.querySelectorAll('[data-mark]').forEach((b) => b.addEventListener('click', async () => {
      const to = b.dataset.to;
      if (to === 'skipped' && !(await askConfirm('Skip it this time?', { message: 'It comes back next period. It shows as Skipped in History.', ok: 'Skip' }))) return;
      try { await rpc('pm_mark', { p_run: Number(b.dataset.mark), p_status: to, p_note: null }); if (to === 'done') toast('Done ✓'); reload(); } catch (err) { toast(errMsg(err), true); }
    }));
    app.querySelectorAll('[data-step]').forEach((c) => c.addEventListener('change', async () => {
      try {
        await rpc('pm_step', { p_run: Number(c.dataset.step), p_index: Number(c.dataset.i), p_done: c.checked });
        const card = c.closest('.pm-card');
        const all = [...card.querySelectorAll('[data-step]')];
        if (all.every((x) => x.checked) && card.classList.contains('open') && (await askConfirm('All steps checked. Mark it done?', { ok: 'Mark done' }))) {
          await rpc('pm_mark', { p_run: Number(c.dataset.step), p_status: 'done', p_note: null });
          toast('Done ✓');
          reload();
        }
      } catch (err) { toast(errMsg(err), true); reload(); }
    }));
    app.querySelector('#pm-add')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      try { await rpc('pm_save_task', { p_id: null, ...fields(new FormData(e.target)) }); toast('Added to the schedule'); reload(); } catch (err) { toast(errMsg(err), true); }
    });
    app.querySelectorAll('form[data-edit]').forEach((f) => f.addEventListener('submit', async (e) => {
      e.preventDefault();
      try { await rpc('pm_save_task', { p_id: Number(f.dataset.edit), ...fields(new FormData(f)) }); toast('Saved'); reload(); } catch (err) { toast(errMsg(err), true); }
    }));
    app.querySelectorAll('[data-active]').forEach((b) => b.addEventListener('click', async () => {
      const on = b.dataset.to === '1';
      if (!on && !(await askConfirm('Take it off the schedule?', { message: 'It stops coming up. Its history is kept, and you can put it back any time.', ok: 'Take off', danger: true }))) return;
      try { await rpc('pm_set_active', { p_id: Number(b.dataset.active), p_active: on }); toast(on ? 'Back on the schedule' : 'Taken off the schedule'); reload(); } catch (err) { toast(errMsg(err), true); }
    }));
  }

  return { renderSchedule };
}

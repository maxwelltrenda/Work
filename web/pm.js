import { loadPlaces, attachPlaces } from './places.js?v=__V__';
// Maintenance schedule: recurring upkeep on fixed calendar periods (weekly,
// monthly, quarterly, yearly), each with an optional window such as "first 14
// days of the quarter". The database does the scheduling (0029_maintenance_schedule.sql):
// opening the page calls pm_refresh(), which opens this period's tasks and
// marks anything left from an ended period as Missed.

const FREQS = [['weekly', 'Weekly', 'week'], ['monthly', 'Monthly', 'month'], ['quarterly', 'Quarterly', 'quarter'], ['yearly', 'Yearly', 'year']];
const FREQ_LABEL = Object.fromEntries(FREQS.map(([k, l]) => [k, l]));
const FREQ_NOUN = Object.fromEntries(FREQS.map(([k, , n]) => [k, n]));
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// One-tap starters for the add-task pop-up.
const COMMON = [
  { name: 'Change AC filters', frequency: 'quarterly', start_month: 12, due_days: 14 },
  { name: 'Test emergency and exit lights', frequency: 'monthly', due_days: 7 },
  { name: 'Inspect fire extinguishers', frequency: 'monthly', due_days: 7 },
  { name: 'Clean gutters', frequency: 'yearly', start_month: 11, due_days: 30 },
  { name: 'Check roof and drains', frequency: 'quarterly', start_month: 1, due_days: 14 },
  { name: 'Flush water heaters', frequency: 'yearly', start_month: 3, due_days: 30 },
  { name: 'Walk the parking lot lights', frequency: 'monthly', due_days: 7 },
  { name: 'Clean ice machine', frequency: 'quarterly', start_month: 2, due_days: 14 },
];
const MONTH = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const parts = (d) => String(d).slice(0, 10).split('-').map(Number);
const dshort = (d) => { const [, m, dd] = parts(d); return `${MON[m - 1]} ${dd}`; };
const dayDiff = (a, b) => Math.round((new Date(`${a}T12:00:00`) - new Date(`${b}T12:00:00`)) / 864e5);

function periodLabel(freq, start, end) {
  const [y, m, d] = parts(start);
  // A period that doesn't start on a plain calendar boundary shows its dates.
  if (end && freq !== 'weekly' && (d !== 1 || (freq === 'quarterly' && (m - 1) % 3) || (freq === 'yearly' && m !== 1))) return `${dshort(start)} – ${dshort(end)}`;
  if (freq === 'weekly') return `Week of ${dshort(start)}`;
  if (freq === 'monthly') return `${MONTH[m - 1]} ${y}`;
  if (freq === 'quarterly') return `Q${Math.floor((m - 1) / 3) + 1} ${y} · ${MON[m - 1]}–${MON[m + 1]}`;
  return String(y);
}
// When a task is due, in plain words, from how often, its start month / day and window.
// e.g. quarterly, starts Dec 1, 14 days -> "Due Dec 1–14, Mar 1–14, Jun 1–14, Sep 1–14"
const STEP = { monthly: 1, quarterly: 3, yearly: 12 };
function windowText(t) {
  const n = t.due_days;
  if (t.frequency === 'weekly') return n ? (n >= 7 ? 'Any time in the week' : `Due by ${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][n - 1]} each week`) : 'Any time in the week';
  const sd = t.start_day || 1;
  const sm = t.start_month || 1;
  const starts = t.frequency === 'monthly' ? [null] : t.frequency === 'quarterly' ? [0, 3, 6, 9].map((k) => ((sm - 1 + k) % 12) + 1) : [sm];
  const range = (m) => {
    const y = 2027;   // any non-leap year: only months and days are shown
    const a = new Date(y, (m || 1) - 1, sd);
    const len = n || null;
    const b = len ? new Date(y, (m || 1) - 1, sd + len - 1) : new Date(y, (m || 1) - 1 + STEP[t.frequency], sd - 1);
    const fmt = (d) => (m ? `${MON[d.getMonth()]} ${d.getDate()}` : `${d.getDate()}${['th', 'st', 'nd', 'rd'][(d.getDate() % 10 > 3 || Math.floor(d.getDate() / 10) === 1) ? 0 : d.getDate() % 10]}`);
    return a.getMonth() === b.getMonth() && m ? `${fmt(a)}–${b.getDate()}` : `${fmt(a)}–${fmt(b)}`;
  };
  if (t.frequency === 'monthly') return n ? `Due the ${range(null)} of each month` : sd === 1 ? 'Any time in the month' : `Any time, each month runs from the ${range(null).split('–')[0]}`;
  if (!n) return `Any time · rounds start ${starts.map((m) => `${MON[m - 1]} ${sd}`).join(', ')}`;
  return `Due ${starts.map(range).join(', ')}${t.frequency === 'yearly' ? ' each year' : ''}`;
}

export function schedulePages(ctx) {
  const { sb, q, rpc, esc, toast, askConfirm, errMsg, pageHead, pulled } = ctx;
  const app = document.getElementById('app');

  // Start months need the 0035 database update; until it's in, the form keeps the old fields.
  let anchorsReady = null;
  const checkAnchors = async () => {
    if (anchorsReady === null) {
      anchorsReady = await rpc('pm_period_start', { p_freq: 'monthly', p_day: '2026-01-01', p_month: null, p_dom: 1 }).then(() => true, () => false);
    }
    return anchorsReady;
  };

  async function renderSchedule(view = 'now') {
    await checkAnchors();
    const today = await rpc('pm_refresh');
    const [tasks, runs, members, locations, pw] = await Promise.all([
      q(sb.from('pm_tasks').select('*').order('sort').order('id')),
      q(sb.from('pm_runs').select('*').order('period_start', { ascending: false }).limit(1000)),
      q(sb.from('team_members').select('id, name')),
      null,
      view === 'now' ? pulled.load('maintenance').catch(() => null) : null,
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
      <div class="dept-maint">${pageHead('<span class="dept-tag">Maintenance</span>', 'Maintenance <span class="accent">checklist</span>', 'Weekly, monthly, quarterly and yearly upkeep. Each list starts over on its own when the next week, month, quarter or year begins.')}</div>
      <div class="stats">
        <div class="stat"><b style="color:${overdue.length ? 'var(--bad)' : 'inherit'}">${overdue.length}</b><span>overdue</span></div>
        <div class="stat"><b>${dueSoon.length}</b><span>due in the next 7 days</span></div>
        <div class="stat"><b>${done.length} of ${current.length}</b><span>done this period</span></div>
      </div>
      ${pw ? pulled.block('maintenance', pw) : ''}
      <div class="pm-bar"><div class="seg">${tabs.map(([k, t]) => `<a href="#/schedule${k === 'now' ? '' : `/${k}`}" class="${view === k ? 'on' : ''}">${t}</a>`).join('')}</div>
        <button class="btn primary" data-pm-new>+ Add task</button></div>
      <div id="pm-view">${view === 'tasks' ? taskList(tasks, locations) : view === 'history' ? history(runs, taskBy, who, today) : nowView(current, taskBy, who, today)}</div>`;

    bind(view, tasks, current);
  }

  // ---- This period -------------------------------------------------------
  function nowView(current, taskBy, who, today) {
    if (!current.length) {
      return `<div class="card pm-empty"><b>Nothing on the schedule yet.</b><p class="muted">Add each recurring job once: what it is, how often, and how long the team has to get it done. It then comes up on its own every week, month, quarter or year.</p>
        <div class="row" style="margin-top:14px"><button class="btn primary" data-pm-new>+ Add your first task</button></div>
        <div class="wk-sect">Or start from a common one</div>
        <div class="wk-chips">${COMMON.map((c, i) => `<button type="button" class="chip-btn" data-pm-new data-common="${i}">${esc(c.name)}</button>`).join('')}</div></div>`;
    }
    return FREQS.map(([f, label]) => {
      const rs = current.filter((r) => taskBy[r.task_id].frequency === f)
        .sort((a, b) => (b.status === 'open') - (a.status === 'open') || a.due_on.localeCompare(b.due_on) || taskBy[a.task_id].sort - taskBy[b.task_id].sort);
      if (!rs.length) return '';
      const left = rs.filter((r) => r.status === 'open').length;
      return `<h2 class="pm-sect">${label} <span class="muted">${periodLabel(f, rs[0].period_start, rs[0].period_end)} · ${left ? `${left} to do` : 'all done'}</span></h2>
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
  function taskList(tasks, locations) {
    const active = tasks.filter((t) => t.active);
    const archived = tasks.filter((t) => !t.active);
    const rows = (list) => `<div class="pm-tasks">${list.map((t) => `<button type="button" class="pm-task-row${t.active ? '' : ' off'}" data-pm-edit="${t.id}">
        <b>${esc(t.name)}</b><span class="muted">${FREQ_LABEL[t.frequency]} · ${windowText(t)}${t.location ? ` · ${esc(t.location)}` : ''}</span><span class="pm-edit">Edit</span></button>`).join('')}</div>`;
    return `${tasks.length ? '' : '<div class="card pm-empty"><b>No tasks yet.</b><p class="muted">Use <b>+ Add task</b> above to add your first recurring job.</p></div>'}
      ${FREQS.map(([f, label]) => { const list = active.filter((t) => t.frequency === f); return list.length ? `<h2 class="pm-sect">${label} <span class="muted">${list.length}</span></h2>${rows(list)}` : ''; }).join('')}
      ${archived.length ? `<h2 class="pm-sect">Off the schedule <span class="muted">${archived.length}</span></h2>${rows(archived)}` : ''}`;
  }

  // ---- Add / edit a task (pop-up) -----------------------------------------
  // Asks it the way people think about it: how often, which month(s), and
  // when in that month it should get done. That is stored as a start day and
  // a number of days (start_day / due_days), which the database schedules from.
  const WEEK_WIN = [['any', 'Any day that week', null], ['mon', 'By Monday', 2], ['wed', 'By Wednesday', 4], ['fri', 'By Friday', 6]];
  const MONTH_WIN = [['any', 'Any time', 1, null], ['w1', 'First week (1st–7th)', 1, 7], ['w2', 'First 2 weeks (1st–14th)', 1, 14], ['h2', 'Second half (15th–28th)', 15, 14]];
  const ord = (n) => `${n}${['th', 'st', 'nd', 'rd'][(n % 10 > 3 || Math.floor(n / 10) % 10 === 1) ? 0 : n % 10]}`;
  function taskModal(places, t = {}) {
    const editing = !!t.id;
    let freq = t.frequency || 'monthly';
    let month = t.start_month || 1;
    let win = 'any';
    let from = 1;
    let to = '';
    // Work out which choice an existing task matches.
    const load = (x) => {
      freq = x.frequency || freq; month = x.start_month || month;
      const sd = x.start_day || 1;
      const n = x.due_days ?? null;
      if (freq === 'weekly') { win = (WEEK_WIN.find((w) => w[2] === n) || ['custom'])[0]; from = 1; to = n || ''; return; }
      const m = MONTH_WIN.find((w) => w[2] === sd && w[3] === n) || (freq === 'quarterly' && sd === 1 && n === 30 ? ['m1'] : null);
      win = m ? m[0] : 'custom'; from = sd; to = n ? Math.min(31, sd + n - 1) : '';
    };
    load(t);
    const CYCLES = [[1, 'Jan · Apr · Jul · Oct'], [2, 'Feb · May · Aug · Nov'], [3, 'Mar · Jun · Sep · Dec']];
    const winChoices = () => (freq === 'weekly' ? WEEK_WIN.map(([k, l]) => [k, l])
      : [...MONTH_WIN.map(([k, l]) => [k, k === 'any' ? (freq === 'monthly' ? 'Any time that month' : freq === 'quarterly' ? 'Any time in the 3 months' : 'Any time that year') : l]),
        ...(freq === 'quarterly' ? [['m1', 'Any time in that first month']] : [])]);
    // start_day / due_days from the choice.
    const params = () => {
      if (freq === 'weekly') { const w = WEEK_WIN.find((x) => x[0] === win); return { sd: null, n: w ? w[2] : (parseInt(to, 10) || null) }; }
      if (win === 'm1') return { sd: 1, n: 30 };
      const w = MONTH_WIN.find((x) => x[0] === win);
      if (w) return { sd: w[2], n: w[3] };
      const a = Math.min(28, Math.max(1, parseInt(from, 10) || 1));
      const z = parseInt(to, 10);
      return { sd: a, n: z && z >= a ? z - a + 1 : null };
    };
    return new Promise((resolve) => {
      const back = document.createElement('div');
      back.className = 'modal-back';
      back.innerHTML = `<form class="modal sheet pm-new" role="dialog" aria-modal="true" aria-labelledby="pm-new-title" novalidate>
        <h3 id="pm-new-title">${editing ? 'Edit task' : 'New maintenance task'}</h3>
        <label><span>What needs doing?</span><input name="name" required autocomplete="off" placeholder="e.g. Pressure wash entrances" class="modal-input" value="${esc(t.name || '')}"></label>
        ${editing ? '' : `<div class="wk-chips pm-common">${COMMON.map((c, i) => `<button type="button" class="chip-btn" data-common="${i}">${esc(c.name)}</button>`).join('')}</div>`}
        <div class="wk-sect">How often</div>
        <div class="wk-chips">${FREQS.map(([k, l]) => `<button type="button" class="chip-btn big" data-freq="${k}">${l}</button>`).join('')}</div>
        ${anchorsReady ? `<div data-for="quarterly"><div class="wk-sect">Which months</div>
          <div class="wk-chips">${CYCLES.map(([m, l]) => `<button type="button" class="chip-btn" data-month="${m}">${l}</button>`).join('')}</div></div>
        <div data-for="yearly"><div class="wk-sect">Which month</div>
          <div class="wk-chips">${MON.map((mn, i) => `<button type="button" class="chip-btn" data-month="${i + 1}">${mn}</button>`).join('')}</div></div>` : ''}
        <div class="wk-sect" data-when-title></div>
        <div class="wk-chips" data-wins></div>
        <div class="pm-custom" data-custom-row></div>
        <p class="pm-preview" data-pm-preview></p>
        <label style="margin-top:12px"><span>Where <span class="muted">(optional)</span></span><input name="location" value="${esc(t.location || '')}" placeholder="Type a place, e.g. Main entrance, Kids wing"></label>
        <details class="pm-more" ${(t.steps || []).length || t.notes ? 'open' : ''}><summary>Steps and notes <span class="muted">(optional)</span></summary>
          <label style="margin-top:10px"><span>Steps <span class="muted">(one per line)</span></span><textarea name="steps" rows="3" placeholder="North entrance&#10;South entrance">${esc((t.steps || []).join('\n'))}</textarea></label>
          <label style="margin-top:10px"><span>Notes <span class="muted">(sizes, part numbers, who to call)</span></span><input name="notes" value="${esc(t.notes || '')}" placeholder="20x25x1 MERV 8"></label>
        </details>
        <div class="modal-actions">${editing ? `<button type="button" class="btn ${t.active ? 'bad' : ''} pm-left" data-active-toggle>${t.active ? 'Take off the schedule' : 'Put back on the schedule'}</button>` : ''}
          <button type="button" class="btn" data-cancel>Cancel</button>
          ${editing ? '' : '<button type="button" class="btn" data-again>Save &amp; add another</button>'}
          <button class="btn primary">${editing ? 'Save' : 'Add task'}</button></div>
      </form>`;
      const form = back.querySelector('form');
      const $ = (sel) => form.querySelector(sel);
      let changed = false;
      const drawWins = () => {
        const where = freq === 'weekly' ? 'When in the week' : freq === 'monthly' ? 'When in the month' : freq === 'quarterly' ? 'When in the first of those months' : 'When in that month';
        $('[data-when-title]').textContent = freq === 'quarterly' && win === 'any' ? 'When' : where;
        $('[data-wins]').innerHTML = [...winChoices(), ['custom', freq === 'weekly' ? 'Other' : 'Pick the days']].map(([k, l]) => `<button type="button" class="chip-btn${win === k ? ' on' : ''}" data-win="${k}">${l}</button>`).join('');
        $('[data-custom-row]').innerHTML = win !== 'custom' ? ''
          : freq === 'weekly' ? `<label class="pm-day">Within the first <input name="to" type="number" min="1" max="7" value="${esc(to)}"> days of the week <span class="muted">(weeks start Sunday)</span></label>`
            : `<label class="pm-day">From the <input name="from" type="number" min="1" max="28" value="${esc(from)}"> to the <input name="to" type="number" min="1" max="31" value="${esc(to)}" placeholder="any"> <span class="muted">of the month</span></label>`;
        $('[data-custom-row]').querySelectorAll('input').forEach((i) => i.addEventListener('input', () => { if (i.name === 'from') from = i.value; else to = i.value; preview(); }));
        $('[data-wins]').querySelectorAll('[data-win]').forEach((b) => b.addEventListener('click', () => { win = b.dataset.win; drawWins(); preview(); }));
      };
      const preview = () => {
        const { sd, n } = params();
        let txt = windowText({ frequency: freq, due_days: n, start_month: month, start_day: sd });
        if (win === 'custom' && freq !== 'weekly' && to && parseInt(to, 10) < (parseInt(from, 10) || 1)) txt = 'The end day has to be after the start day.';
        $('[data-pm-preview]').textContent = txt;
      };
      const sync = () => {
        form.querySelectorAll('[data-freq]').forEach((b) => b.classList.toggle('on', b.dataset.freq === freq));
        form.querySelectorAll('[data-for]').forEach((el) => { el.hidden = el.dataset.for !== freq; });
        form.querySelectorAll('[data-month]').forEach((b) => {
          const m = Number(b.dataset.month);
          b.classList.toggle('on', freq === 'quarterly' ? (m - 1) % 3 === (month - 1) % 3 : m === month);
        });
        drawWins(); preview();
      };
      const fill = (c) => { $('[name=name]').value = c.name; load({ frequency: c.frequency, start_month: c.start_month, start_day: 1, due_days: c.due_days ?? null }); if (c.notes) $('[name=notes]').value = c.notes; sync(); };
      form.querySelectorAll('[data-common]').forEach((b) => b.addEventListener('click', () => fill(COMMON[b.dataset.common])));
      form.querySelectorAll('[data-freq]').forEach((b) => b.addEventListener('click', () => {
        if (freq === b.dataset.freq) return;
        freq = b.dataset.freq;
        if (!winChoices().some(([k]) => k === win) && win !== 'custom') win = 'any';
        if (freq === 'weekly' && win === 'custom') to = '';
        sync();
      }));
      form.querySelectorAll('[data-month]').forEach((b) => b.addEventListener('click', () => { month = Number(b.dataset.month); sync(); }));
      sync();
      const done = () => { document.removeEventListener('keydown', onKey, true); back.remove(); resolve(changed); };
      const onKey = (e) => { if (e.key === 'Escape' && !document.querySelector('.dd-menu, .dp-pop')) { e.preventDefault(); done(); } };
      document.addEventListener('keydown', onKey, true);
      back.addEventListener('mousedown', (e) => { if (e.target === back) done(); });
      $('[data-cancel]').addEventListener('click', done);
      $('[data-active-toggle]')?.addEventListener('click', async () => {
        const on = !t.active;
        if (!on && !(await askConfirm('Take it off the schedule?', { message: 'It stops coming up. Its history is kept, and you can put it back any time.', ok: 'Take off', danger: true }))) return;
        try { await rpc('pm_set_active', { p_id: t.id, p_active: on }); toast(on ? 'Back on the schedule' : 'Taken off the schedule'); changed = true; done(); } catch (err) { toast(errMsg(err), true); }
      });
      const save = async (again) => {
        const name = $('[name=name]').value.trim();
        if (!name) { $('[name=name]').focus(); toast('Say what needs doing', true); return; }
        const { sd, n } = params();
        if (win === 'custom' && freq !== 'weekly' && to && parseInt(to, 10) < (parseInt(from, 10) || 1)) { toast('The end day has to be after the start day', true); return; }
        const f = new FormData(form);
        try {
          await rpc('pm_save_task', {
            p_id: t.id || null, p_name: name, p_frequency: freq, p_due_days: n,
            p_location: String(f.get('location') || '').trim() || null, p_notes: f.get('notes') || null,
            p_steps: String(f.get('steps') || '').split('\n').map((x) => x.trim()).filter(Boolean),
            ...(anchorsReady ? { p_start_month: ['quarterly', 'yearly'].includes(freq) ? month : null, p_start_day: freq === 'weekly' ? null : sd } : {}),
          });
          changed = true;
          toast(editing ? 'Saved' : `Added “${name}” to the schedule`);
          if (!again) return done();
          form.reset(); $('[name=name]').value = ''; win = 'any'; sync(); $('[name=name]').focus();
        } catch (err) { toast(errMsg(err), true); }
      };
      $('[data-again]')?.addEventListener('click', () => save(true));
      form.addEventListener('submit', (e) => { e.preventDefault(); save(false); });
      document.body.appendChild(back);
      attachPlaces($('[name=location]'), places);
      if (!editing) $('[name=name]').focus();
    });
  }

  // ---- History ------------------------------------------------------------
  function history(runs, taskBy, who, today) {
    const past = runs.filter((r) => r.period_end < today || r.status !== 'open').slice(0, 300);
    if (!past.length) return '<p class="muted">Nothing yet. Finished, skipped and missed tasks show up here.</p>';
    const label = { done: 'Done', skipped: 'Skipped', missed: 'Missed', open: 'Open' };
    return `<div class="table-wrap"><table><tr><th>Period</th><th>Task</th><th>Status</th><th>Who</th><th>When</th><th>Note</th></tr>
      ${past.map((r) => { const t = taskBy[r.task_id]; const late = r.status === 'done' && r.done_at && r.done_at.slice(0, 10) > r.due_on;
        return `<tr><td>${periodLabel(t.frequency, r.period_start, r.period_end)}</td><td>${esc(t.name)}</td>
        <td><span class="pill ${r.status === 'done' ? 'available' : r.status === 'missed' ? 'lost' : 'closed'}">${label[r.status]}</span>${late ? ' <span class="muted">late</span>' : ''}</td>
        <td>${esc(who[r.done_by] || '')}</td><td>${r.done_at ? new Date(r.done_at).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) : ''}</td><td>${esc(r.note || '')}</td></tr>`; }).join('')}</table></div>`;
  }

  function bind(view, tasks, current) {
    const reload = () => renderSchedule(view);
    app.querySelectorAll('[data-pm-new]').forEach((b) => b.addEventListener('click', async () => {
      const c = b.dataset.common ? COMMON[b.dataset.common] : null;
      const added = await taskModal(await loadPlaces(sb), c ? { ...c, start_day: 1 } : {});
      if (added) reload();
    }));
    app.querySelectorAll('[data-pm-edit]').forEach((b) => b.addEventListener('click', async () => {
      const t = tasks.find((x) => x.id === Number(b.dataset.pmEdit));
      if (t && (await taskModal(await loadPlaces(sb), t))) reload();
    }));
    pulled.bind(app, reload);
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
  }

  return { renderSchedule };
}

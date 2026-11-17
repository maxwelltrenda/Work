// My day: one person's home. What they're clocked in on right now, the work
// that's theirs and ready to do (Custodial, Maintenance, requests, to-dos),
// and open work nobody has taken yet. Start / Stop / Done right from here.

import { loadNotes, notesList, noteButton, bindNotes } from './notes.js?v=__V__';

const DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const WEEK = ['Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday', 'Monday'];   // Facilities week
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n) => String(n).padStart(2, '0');
const isoToday = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const dshort = (iso) => { const [, m, d] = String(iso).slice(0, 10).split('-').map(Number); return `${MON[m - 1]} ${d}`; };
const clock = (ts) => new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
function dur(sec) {
  sec = Math.max(0, Math.round(sec || 0));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
  if (h) return `${h}h ${pad(m)}m`;
  return m ? `${m}m` : `${sec}s`;
}
const live = (base, since) => `<span class="md-live" data-md-base="${base || 0}" data-md-since="${new Date(since).getTime()}">${dur((base || 0) + (Date.now() - new Date(since)) / 1000)}</span>`;
const h12 = (v) => { const [h, m] = String(v).split(':').map(Number); return `${h % 12 || 12}${m ? `:${String(m).padStart(2, '0')}` : ''} ${h < 12 ? 'AM' : 'PM'}`; };
const slot = (t) => `${h12(t.once_from)}${t.once_to ? `–${h12(t.once_to)}` : ''}`;
const names = (who) => String(who || '').split(',').map((x) => x.trim()).filter(Boolean);

export function myDayPages(ctx) {
  const { sb, q, rpc, esc, toast, errMsg, me, askConfirm, isAdmin, pulled: pulledKit, canPull, pullDept } = ctx;
  const app = document.getElementById('app');
  let tick = null;
  const safe = (p, fb) => Promise.resolve(p).catch(() => fb);

  async function renderMyDay() {
    const person = me();
    const myName = person.name;
    const lc = myName.toLowerCase();
    const onMe = (who) => names(who).some((n) => n.toLowerCase() === lc);
    const today = isoToday();
    const todayName = DOW[new Date().getDay()];

    const week = await safe(rpc('start_checklist_week'), null);
    await safe(rpc('pm_refresh'), null);
    const [ck, runs, pmTasks, todos, pulled, reqs] = await Promise.all([
      week ? safe(q(sb.from('checklist_tasks').select('*').eq('week_of', week).eq('archived', false).order('sort')), []) : [],
      safe(q(sb.from('pm_runs').select('*').in('status', ['open', 'missed'])), []),
      safe(q(sb.from('pm_tasks').select('*')), []),
      [],
      safe(q(sb.from('pulled_work').select('*').eq('member_id', person.id).is('ended_at', null)), []),
      safe(q(sb.from('maint_requests').select('*').neq('board_group', 'solved')), []),
    ]);
    const taskBy = Object.fromEntries(pmTasks.map((t) => [t.id, t]));
    const whoName = Object.fromEntries((await safe(q(sb.from('team_members').select('id, name')), [])).map((m) => [m.id, m.name]));
    const myStepsOf = (t) => Object.entries(t?.step_people || {}).filter(([, ids]) => (ids || []).includes(person.id)).map(([s]) => s);
    const pmMine = (r) => (taskBy[r.task_id]?.assignees || []).includes(person.id) || myStepsOf(taskBy[r.task_id]).length > 0;
    const pmCurrent = runs.filter((r) => taskBy[r.task_id]?.active && r.period_start <= today);

    // ---- clocked in now
    // Clocked in = I pressed Start (not just: I'm on the task).
    const meIn = (t) => (t.clocked || []).some((n) => String(n).toLowerCase() === lc);
    const meInPm = (r) => (r.clocked || []).includes(person.id);
    const nowCk = ck.filter((t) => t.timer_started_at && meIn(t));
    const nowPm = pmCurrent.filter((r) => r.timer_started_at && meInPm(r));
    const nowReq = reqs.filter((r) => r.timer_started_at && (r.experts || []).some((e) => e.toLowerCase() === lc));

    // ---- mine, ready to do
    const open = (t) => !['Done', 'Skipped', 'Missed'].includes(t.status);
    const ckMine = ck.filter((t) => open(t) && onMe(t.who) && !meIn(t));
    const ckToday = ckMine.filter((t) => t.day === todayName);
    const ckLater = ckMine.filter((t) => t.day !== todayName).sort((a, b) => WEEK.indexOf(a.day) - WEEK.indexOf(b.day));
    const pmReady = pmCurrent.filter((r) => pmMine(r) && !meInPm(r)).sort((a, b) => String(a.due_on).localeCompare(String(b.due_on)));
    const reqMine = reqs.filter((r) => !r.timer_started_at && (r.experts || []).some((e) => e.toLowerCase() === lc));
    const todoNow = todos.filter((t) => !t.due_on || t.due_on <= today).sort((a, b) => String(a.due_on || '9').localeCompare(String(b.due_on || '9')));
    const todoLater = todos.filter((t) => t.due_on && t.due_on > today).sort((a, b) => a.due_on.localeCompare(b.due_on));

    // ---- up for grabs (nobody on it)
    const grabCk = ck.filter((t) => open(t) && !names(t.who).length && t.day === todayName);
    const grabPm = pmCurrent.filter((r) => !(taskBy[r.task_id]?.assignees || []).length && !r.timer_started_at && r.due_on <= addDays(today, 7));

    const [ckN, pmN] = await Promise.all([loadNotes(sb, 'custodial', ck.map((t) => t.id)), loadNotes(sb, 'maintenance', pmCurrent.map((r) => r.id))]);
    const row = ({ tag, cls, title, meta, actions, notes = '' }) => `<div class="md-row"><span class="md-tag ${cls}">${tag}</span>
      <div class="md-body"><b>${title}</b>${meta ? `<span>${meta}</span>` : ''}${notes}</div><div class="md-act">${actions || ''}</div></div>`;
    const ckRow = (t, running) => row({ tag: 'Custodial', cls: 'cust', title: esc(t.name),
      meta: [running ? `${live(t.worked_seconds, t.timer_started_at)} · since ${clock(t.timer_started_at)}` : t.timer_started_at && (t.clocked || []).length ? `<b>${(t.clocked || []).map((n) => esc(String(n).split(' ')[0])).join(', ')} clocked in</b>` : t.worked_seconds ? `${dur(t.worked_seconds)} so far` : '', t.day && t.day !== todayName ? t.day : '', names(t.who).length > 1 ? `with ${names(t.who).filter((n) => n.toLowerCase() !== lc).map(esc).join(', ')}` : ''].filter(Boolean).join(' · '),
      notes: notesList(ckN[t.id], esc, person.id, isAdmin?.()),
      actions: `${noteButton('custodial', t.id, (ckN[t.id] || []).length)}<button class="btn small${running ? ' b-running' : ''}" data-md-ck="${t.id}" data-run="${running ? 0 : 1}">${running ? '■ Stop' : '▶ Start'}</button><button class="btn small" data-md-ckdone="${t.id}">✓ Done</button>` });
    const pmRow = (r, running) => { const t = taskBy[r.task_id]; return row({ tag: t.parent_id ? 'Get ready' : 'Maintenance', cls: 'maint', title: esc(t.name),
      meta: [running ? `${live(r.worked_seconds, r.timer_started_at)} · since ${clock(r.timer_started_at)}` : r.timer_started_at && (r.clocked || []).length ? `<b>${(r.clocked || []).map((id) => esc(String(whoName[id] || 'Someone').split(' ')[0])).join(', ')} clocked in</b>` : r.worked_seconds ? `${dur(r.worked_seconds)} so far` : '', t.location ? esc(t.location) : '', t.frequency === 'once' && t.once_from ? `<b>${r.due_on === today ? 'Today' : dshort(r.due_on)}, ${slot(t)}</b>` : r.due_on ? `${r.due_on < today ? '<b class="md-late">Late</b> · was due' : 'due'} ${dshort(r.due_on)}` : '', (t.steps || []).length ? `${(r.steps_done || []).length}/${t.steps.length} steps` : '', myStepsOf(t).length ? `<b>Your steps:</b> ${myStepsOf(t).map(esc).join(', ')}` : ''].filter(Boolean).join(' · '),
      notes: notesList(pmN[r.id], esc, person.id, isAdmin?.()),
      actions: `${noteButton('maintenance', r.id, (pmN[r.id] || []).length)}<button class="btn small${running ? ' b-running' : ''}" data-md-pm="${r.id}" data-run="${running ? 0 : 1}">${running ? '■ Stop' : '▶ Start'}</button><button class="btn small" data-md-pmdone="${r.id}">✓ Done</button>` }); };
    const reqRow = (r, running) => row({ tag: 'Request', cls: 'req', title: `<a href="#/request/${r.id}">${esc(r.subject)}</a>`,
      meta: [running ? live(r.worked_seconds, r.timer_started_at) : '', r.location ? esc(r.location) : '', r.status].filter(Boolean).join(' · ') });
    const todoRow = (t) => row({ tag: 'To-do', cls: 'todo', title: esc(t.title),
      meta: [t.due_on ? (t.due_on < today ? `<b class="md-late">Late</b> · was due ${dshort(t.due_on)}` : t.due_on === today ? '<b>Due today</b>' : `Due ${dshort(t.due_on)}`) : '', t.notes ? esc(t.notes) : ''].filter(Boolean).join(' · '),
      actions: `<button class="btn small" data-md-todo="${t.id}">✓ Done</button>` });
    const pulledRow = (p) => row({ tag: p.paused_at ? 'On break' : 'Pulled', cls: 'pulled', title: esc(p.what),
      meta: [p.location ? esc(p.location) : '', p.paused_at ? `paused since ${clock(p.paused_at)}` : `since ${clock(p.started_at)}`].filter(Boolean).join(' · '),
      actions: `<button class="btn small" data-md-pause="${p.id}" data-on="${p.paused_at ? 0 : 1}">${p.paused_at ? '▶ Resume' : '⏸ Pause'}</button><button class="btn small primary" data-md-back="${p.id}">I'm back</button>` });

    const pw = pulledKit && canPull?.() ? await pulledKit.load(pullDept()).catch(() => null) : null;
    const nowRows = [...(pw ? [] : pulled.map(pulledRow)), ...nowCk.map((t) => ckRow(t, true)), ...nowPm.map((r) => pmRow(r, true)), ...nowReq.map((r) => reqRow(r, true))];
    const readyRows = [...ckToday.map((t) => ckRow(t, false)), ...pmReady.map((r) => pmRow(r, false)), ...reqMine.map((r) => reqRow(r, false))];
    const laterRows = [...ckLater.map((t) => ckRow(t, false))];
    const grabRows = [...grabCk.map((t) => ckRow(t, false)), ...grabPm.map((r) => pmRow(r, false))];
    const hour = new Date().getHours();
    const sect = (title, sub, rows, empty, cls = '') => `<section class="md-sect ${cls}"><h2>${title} ${sub ? `<span class="muted">${sub}</span>` : ''}</h2>
      ${rows.length ? `<div class="md-list card">${rows.join('')}</div>` : `<p class="muted md-empty">${empty}</p>`}</section>`;

    app.innerHTML = `
      <header class="page-head"><div class="eyebrow">My day</div>
        <h1>${hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'}, <span class="accent">${esc(myName.split(' ')[0])}</span>.</h1>
        <p class="lede">${todayName}, ${dshort(today)}. Your work, ready to go.</p></header>
      ${pw ? pulledKit.block(pullDept(), pw) : ''}
      ${sect('Clocked in now', '', nowRows, "You're not clocked in on anything. Tap ▶ Start on a task below.", nowRows.length ? 'md-now' : '')}
      ${sect('Ready to do', 'yours for today', readyRows, 'Nothing assigned to you for today.')}
      ${laterRows.length ? sect('Later this week', '', laterRows, '') : ''}
      ${grabRows.length ? sect('Up for grabs', 'nobody on these yet · starting one puts you on it', grabRows, '') : ''}`;

    bindNotes(app, { sb, toast, errMsg, esc, meId: person.id, canDeleteAll: isAdmin?.(), names: { ...Object.fromEntries(ck.map((t) => [`custodial:${t.id}`, t.name])), ...Object.fromEntries(pmCurrent.map((r) => [`maintenance:${r.id}`, taskBy[r.task_id]?.name || ''])) } }, renderMyDay);
    const act = async (fn, msg) => { try { await fn(); if (msg) toast(msg); renderMyDay(); } catch (err) { toast(errMsg(err), true); } };
    app.querySelectorAll('[data-md-ck]').forEach((b) => b.addEventListener('click', () => act(async () => {
      const t = ck.find((x) => String(x.id) === b.dataset.mdCk);
      if (b.dataset.run === '1' && !onMe(t.who)) await q(sb.from('checklist_tasks').update({ who: [...names(t.who), myName].join(', ') }).eq('id', t.id).select('id'));
      await rpc('checklist_timer', { p_id: t.id, p_run: b.dataset.run === '1' });
    })));
    app.querySelectorAll('[data-md-ckdone]').forEach((b) => b.addEventListener('click', () => act(async () => {
      const t = ck.find((x) => String(x.id) === b.dataset.mdCkdone);
      const patch = { status: 'Done' };
      if (!onMe(t.who)) patch.who = [...names(t.who), myName].join(', ');
      await q(sb.from('checklist_tasks').update(patch).eq('id', t.id).select('id'));
    }, 'Done ✓')));
    app.querySelectorAll('[data-md-pm]').forEach((b) => b.addEventListener('click', () => act(() => rpc('pm_timer', { p_run: Number(b.dataset.mdPm), p_run_on: b.dataset.run === '1' }))));
    app.querySelectorAll('[data-md-pmdone]').forEach((b) => b.addEventListener('click', () => act(() => rpc('pm_mark', { p_run: Number(b.dataset.mdPmdone), p_status: 'done', p_note: null }), 'Done ✓')));
    app.querySelectorAll('[data-md-todo]').forEach((b) => b.addEventListener('click', () => act(() => q(sb.from('personal_tasks').update({ done_at: new Date().toISOString() }).eq('id', b.dataset.mdTodo).select('id')), 'Done ✓')));
    if (pw) pulledKit.bind(app, renderMyDay);
    app.querySelectorAll('[data-md-back]').forEach((b) => b.addEventListener('click', () => act(() => rpc('pulled_end', { p_id: Number(b.dataset.mdBack), p_note: null }), 'Welcome back')));
    app.querySelectorAll('[data-md-pause]').forEach((b) => b.addEventListener('click', () => act(() => rpc('pulled_pause', { p_id: Number(b.dataset.mdPause), p_pause: b.dataset.on === '1' }))));

    clearInterval(tick);
    if (app.querySelector('[data-md-since]')) tick = setInterval(() => {
      const els = app.querySelectorAll('[data-md-since]');
      if (!els.length) { clearInterval(tick); return; }
      els.forEach((el) => { el.textContent = dur(Number(el.dataset.mdBase) + (Date.now() - Number(el.dataset.mdSince)) / 1000); });
    }, 1000);
  }

  return { renderMyDay };
}

function addDays(iso, n) { const [y, m, d] = iso.split('-').map(Number); const dt = new Date(y, m - 1, d + n); return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`; }

import { loadPlaces, attachPlaces } from './places.js?v=__V__';
import { contractorContact } from './contractors.js?v=__V__';
// Maintenance schedule: recurring upkeep on fixed calendar periods (weekly,
// monthly, quarterly, yearly), each with an optional window such as "first 14
// days of the quarter". The database does the scheduling (0029_maintenance_schedule.sql):
// opening the page calls pm_refresh(), which opens this period's tasks and
// marks anything left from an ended period as Missed.

const FREQS = [['once', 'One time', 'time'], ['weekly', 'Weekly', 'week'], ['biweekly', 'Every 2 weeks', '2 weeks'], ['monthly', 'Monthly', 'month'], ['quarterly', 'Quarterly', 'quarter'], ['yearly', 'Yearly', 'year']];
const FREQ_LABEL = Object.fromEntries(FREQS.map(([k, l]) => [k, l]));
const FREQ_NOUN = Object.fromEntries(FREQS.map(([k, , n]) => [k, n]));
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const parts = (d) => String(d).slice(0, 10).split('-').map(Number);
const dshort = (d) => { const [, m, dd] = parts(d); return `${MON[m - 1]} ${dd}`; };
const DAYN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const isoOf = (dt) => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
const addD = (iso, n) => { const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number); return isoOf(new Date(y, m - 1, d + n)); };
// The Facilities week runs Tuesday to Monday (same rule as the database).
const weekStart = (iso) => { const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number); const dt = new Date(y, m - 1, d); return isoOf(new Date(y, m - 1, d - ((dt.getDay() + 5) % 7))); };
// Every-2-weeks rounds start on Tuesdays; start_day 1 = the fortnight lined up
// with Tue Jan 6 2026, 2 = the other week.
const fortnightStart = (iso, parity = 1) => {
  const [y, m, d] = weekStart(iso).split('-').map(Number);
  const tue = new Date(y, m - 1, d);
  const weeks = Math.round((tue - new Date(2026, 0, 6)) / 6048e5);
  const k = (((weeks - (parity - 1)) % 2) + 2) % 2;
  return isoOf(new Date(y, m - 1, d - 7 * k));
};
// Day n of a Tuesday week (1 = Tuesday ... 7 = Monday).
const weekDayName = (n) => DAYN[(n + 1) % 7];
const dayDiff = (a, b) => Math.round((new Date(`${a}T12:00:00`) - new Date(`${b}T12:00:00`)) / 864e5);

function periodLabel(freq, start, end) {
  if (freq === 'once') return `Due ${dshort(end)}`;
  const [y, m, d] = parts(start);
  if (freq === 'biweekly') return `${dshort(start)} – ${dshort(end || addD(start, 13))}`;
  // A period that doesn't start on a plain calendar boundary shows its dates.
  if (end && freq !== 'weekly' && (d !== 1 || (freq === 'quarterly' && (m - 1) % 3) || (freq === 'yearly' && m !== 1))) return `${dshort(start)} – ${dshort(end)}`;
  if (freq === 'weekly') return `Week of ${dshort(start)}`;
  if (freq === 'biweekly') return `${dshort(start)} – ${dshort(end || addD(start, 13))}`;
  if (freq === 'monthly') return `${MONTH[m - 1]} ${y}`;
  if (freq === 'quarterly') return `Q${Math.floor((m - 1) / 3) + 1} ${y} · ${MON[m - 1]}–${MON[m + 1]}`;
  return String(y);
}
// When a task is due, in plain words, from how often, its start month / day and window.
// e.g. quarterly, starts Dec 1, 14 days -> "Due Dec 1–14, Mar 1–14, Jun 1–14, Sep 1–14"
const STEP = { monthly: 1, quarterly: 3, yearly: 12 };
function windowText(t) {
  if (t.frequency === 'once') return t.once_due ? `One time · due ${dshort(t.once_due)}${t.once_start ? ` · shows up ${dshort(t.once_start)}` : ''}` : 'One time · pick the date it is due';
  const n = t.due_days;
  if (t.frequency === 'biweekly') {
    if (!n || n >= 14) return 'Any time in the 2 weeks';
    if (n === 7) return 'Done that week (every other week)';
    return `Due by ${n <= 7 ? '' : 'the second '}${weekDayName(((n - 1) % 7) + 1)} that week (every other week)`;
  }
  if (t.frequency === 'weekly') return n ? (n >= 7 ? 'Any time in the week' : `Due by ${weekDayName(n)} each week`) : 'Any time in the week';
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

// Notes keep their lines: "* x" / "- x" become bullets, "1. x" numbers, and a
// line just before a list becomes its heading. Long notes fold up on the card.
function formatNotes(text, esc) {
  const lines = String(text || '').replace(/\r/g, '').split('\n');
  const out = [];
  let list = null;
  const close = () => { if (list) { out.push(`</${list}>`); list = null; } };
  lines.forEach((raw, i) => {
    const line = raw.trim();
    const bullet = line.match(/^[*•-]\s+(.*)$/);
    const num = line.match(/^\d+[.)]\s+(.*)$/);
    if (bullet || num) {
      const kind = bullet ? 'ul' : 'ol';
      if (list !== kind) { close(); out.push(`<${kind}>`); list = kind; }
      out.push(`<li>${esc((bullet || num)[1])}</li>`);
      return;
    }
    close();
    if (!line) return;
    const next = lines.slice(i + 1).find((l) => l.trim());
    const isHead = next && /^([*•-]|\d+[.)])\s+/.test(next.trim());
    out.push(isHead ? `<h4>${esc(line)}</h4>` : `<p>${esc(line)}</p>`);
  });
  close();
  return out.join('');
}
const notesBlock = (notes, esc) => {
  const t = String(notes || '').trim();
  if (!t) return '';
  if (!t.includes('\n') && t.length <= 90) return `<span class="pm-notes">${esc(t)}</span>`;
  return `<details class="pm-notesbox"><summary>Notes</summary><div class="notes-fmt">${formatNotes(t, esc)}</div></details>`;
};

// People and timing, drawn the same way as on the Custodial list.
const PALETTE = ['#11404b', '#2d6a62', '#6a4cf0', '#a8752a', '#b04437', '#2f5d8a', '#3f7a5a', '#8a6630', '#5a5fa8', '#6b6b6b'];
const hue = (s) => PALETTE[[...String(s)].reduce((a, c) => a + c.charCodeAt(0), 0) % PALETTE.length];
const initials = (n) => String(n).split(/[\s.]+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
function tdur(sec) {
  sec = Math.max(0, Math.round(sec || 0));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
  if (h) return `${h}h ${String(m).padStart(2, '0')}m`;
  if (m) return `${m}m`;
  return sec ? `${sec}s` : '0m';
}
const liveSecs = (r) => (r.worked_seconds || 0) + (r.timer_started_at ? (Date.now() - new Date(r.timer_started_at)) / 1000 : 0);

export function schedulePages(ctx) {
  const manage = () => (ctx.canManage ? ctx.canManage() : true);
  let pmTick = null;
  const { sb, q, rpc, esc, toast, askConfirm, errMsg, pageHead, pulled } = ctx;
  let contractors = [];   // the Contractors list, loaded with the page
  let crew = [];          // Facilities people who can be put on a task
  let whoAll = {};        // id -> name, everyone
  const onIt = (t) => (t.assignees || []).map((id) => whoAll[id]).filter(Boolean);
  const ctBy = (id) => contractors.find((c) => c.id === id);
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
      q(sb.from('team_members').select('id, name, role, active')),
      null,
      view === 'now' ? pulled.load('maintenance').catch(() => null) : null,
      q(sb.from('contractors').select('*').order('name')).then((x) => { contractors = x; }, () => { contractors = []; }),
    ]);
    const who = Object.fromEntries(members.map((m) => [m.id, m.name]));
    whoAll = who;
    crew = members.filter((m) => m.active && !['kiosk', 'none'].includes(m.role)).sort((a, b) => a.name.localeCompare(b.name));
    const taskBy = Object.fromEntries(tasks.map((t) => [t.id, t]));
    preps = tasks.filter((t) => t.parent_id);
    // A one-time task stays on the list until it's done, even past its due date.
    const current = runs.filter((r) => taskBy[r.task_id]?.active && r.period_start <= today && (r.period_end >= today || (taskBy[r.task_id].frequency === 'once' && r.status === 'open')));
    allRuns = runs;
    const overdue = current.filter((r) => r.status === 'open' && r.due_on < today);
    const dueSoon = current.filter((r) => r.status === 'open' && r.due_on >= today && dayDiff(r.due_on, today) <= 7);
    const done = current.filter((r) => r.status === 'done');
    const active = tasks.filter((t) => t.active && !t.parent_id);
    const tabs = [['now', 'This period'], ['calendar', 'Calendar'], ['tasks', `All tasks <b>${active.length}</b>`], ['history', 'History']];

    app.innerHTML = `
      <div class="dept-maint">${pageHead('<span class="dept-tag">Maintenance</span>', 'Maintenance <span class="accent">checklist</span>', 'Weekly, monthly, quarterly and yearly upkeep. Each list starts over on its own when the next week, month, quarter or year begins.')}</div>
      <div class="stats">
        <div class="stat"><b style="color:${overdue.length ? 'var(--bad)' : 'inherit'}">${overdue.length}</b><span>overdue</span></div>
        <div class="stat"><b>${dueSoon.length}</b><span>due in the next 7 days</span></div>
        <div class="stat"><b>${done.length} of ${current.length}</b><span>done this period</span></div>
      </div>
      ${pw ? pulled.block('maintenance', pw) : ''}
      <div class="pm-bar"><div class="seg">${tabs.map(([k, t]) => `<a href="#/schedule${k === 'now' ? '' : `/${k}`}" class="${view === k ? 'on' : ''}">${t}</a>`).join('')}</div>
        ${manage() ? '<button class="btn primary" data-pm-new>+ Add task</button>' : ''}</div>
      <div id="pm-view">${view === 'tasks' ? taskList(tasks, locations) : view === 'calendar' ? calendarView(tasks, runs, today) : view === 'history' ? history(runs, taskBy, who, today) : nowView(current, taskBy, who, today, active)}</div>`;

    bind(view, tasks, current);
  }

  // ---- Calendar: every task placed in the weeks it's due -------------------
  // So you can see which weeks are busy and which are open before adding one.
  function windowsOf(t, from, to) {
    const out = [];
    const n = t.due_days || null;
    if (t.frequency === 'once') { if (t.once_due) out.push([t.once_start && t.once_start < t.once_due ? t.once_start : t.once_due, t.once_due]); return out; }
    if (t.frequency === 'weekly') {
      for (let s = from; s <= to; s = addD(s, 7)) out.push([s, addD(s, Math.min(n || 7, 7) - 1)]);
      return out;
    }
    if (t.frequency === 'biweekly') {
      for (let s = fortnightStart(from, t.start_day || 1); s <= to; s = addD(s, 14)) out.push([s, addD(s, Math.min(n || 14, 14) - 1)]);
      return out;
    }
    const sd = t.start_day || 1;
    const [y, m] = parts(from);
    for (let k = -12; k <= 8; k += 1) {
      const dt = new Date(y, m - 1 + k, 1);
      const mm = dt.getMonth() + 1;
      const ok = t.frequency === 'monthly' || (t.frequency === 'quarterly' && (mm - 1) % 3 === ((t.start_month || 1) - 1) % 3) || (t.frequency === 'yearly' && mm === (t.start_month || 1));
      if (!ok) continue;
      const a = isoOf(new Date(dt.getFullYear(), dt.getMonth(), sd));
      const b = n ? addD(a, n - 1) : isoOf(new Date(dt.getFullYear(), dt.getMonth() + STEP[t.frequency], sd - 1));
      if (b >= from && a <= to) out.push([a, b]);
    }
    return out;
  }

  // The month at a glance: which week of the month each task lands in.
  function rhythm(tasks) {
    const active = tasks.filter((t) => t.active && !t.parent_id);
    const QM = (sm) => [0, 3, 6, 9].map((k) => MON[((sm - 1 + k) % 12)]).join(' · ');
    const months = (t) => (t.frequency === 'monthly' ? 'every month' : t.frequency === 'quarterly' ? QM(t.start_month || 1) : t.frequency === 'yearly' ? MON[(t.start_month || 1) - 1] + ' only' : '');
    const boxes = [[], [], [], []];
    const anyTime = [];
    active.filter((t) => ['monthly', 'quarterly', 'yearly'].includes(t.frequency)).forEach((t) => {
      const sd = t.start_day || 1;
      const n = t.due_days || null;
      if (!n || n >= 28) { anyTime.push(t); return; }
      const wk = new Set();
      for (let d = sd; d < sd + n && d <= 31; d += 1) wk.add(Math.min(3, Math.floor((d - 1) / 7)));
      wk.forEach((i) => boxes[i].push(t));
    });
    const LBL = ['Week 1', 'Week 2', 'Week 3', 'Week 4'];
    const DAYS = ['1st – 7th', '8th – 14th', '15th – 21st', '22nd – end'];
    const item = (t) => `<button type="button" class="rh-item" data-pm-edit="${t.id}"><b>${esc(t.name)}</b><span>${esc(months(t))}</span></button>`;
    const weekly = active.filter((t) => t.frequency === 'weekly');
    const biweekly = active.filter((t) => t.frequency === 'biweekly');
    const line = (label, list) => (list.length ? `<div class="rh-line"><span>${label}</span>${list.map((t) => `<button type="button" class="rh-pill" data-pm-edit="${t.id}">${esc(t.name)}</button>`).join('')}</div>` : '');
    return `<h2 class="pm-sect">Each month <span class="muted">where monthly, quarterly and yearly tasks fall</span></h2>
      <div class="rh">${boxes.map((list, i) => `<div class="rh-box${list.length ? '' : ' free'}">
          <div class="rh-head"><b>${LBL[i]}</b><span>${DAYS[i]}</span></div>
          ${list.length ? list.map(item).join('') : '<div class="rh-free">Free</div>'}</div>`).join('')}</div>
      <div class="rh-lines">${line('Any time in the month', anyTime)}${line('Every week', weekly)}${line('Every 2 weeks', biweekly)}</div>`;
  }

  function calendarView(tasks, runs, today) {
    const WEEKS = 17;
    const start = weekStart(today);
    const end = addD(start, WEEKS * 7 - 1);
    const active = tasks.filter((t) => t.active && !t.parent_id);
    const byId = Object.fromEntries(tasks.map((t) => [t.id, t]));
    const items = [];
    active.forEach((t) => windowsOf(t, start, end).forEach(([a, b]) => {
      const done = runs.some((r) => r.task_id === t.id && r.status === 'done' && r.period_start <= b && r.period_end >= a);
      items.push({ t, a, b, kind: dayDiff(b, a) < 14 ? 'fixed' : 'flex', done });
      if (t.frequency !== 'once') tasks.filter((c) => c.parent_id === t.id && c.active && c.lead_days)
        .forEach((c) => items.push({ t: c, parent: t, a: addD(a, -c.lead_days), b: addD(a, -1), kind: 'prep', done: runs.some((r) => r.task_id === c.id && r.status === 'done' && r.period_end === addD(a, -1)) }));
    }));
    const FCLS = { once: 'f-once', weekly: 'f-week', biweekly: 'f-2wk', monthly: 'f-month', quarterly: 'f-quarter', yearly: 'f-year' };
    const chip = (x) => {
      const t = x.t;
      const freq = x.parent ? x.parent.frequency : t.frequency;
      const range = dayDiff(x.b, x.a) < 7 ? '' : ` <span class="cal-rng">${dshort(x.a)}–${dshort(x.b)}</span>`;
      return `<button type="button" class="cal-chip ${x.kind} ${FCLS[freq] || ''}${x.done ? ' done' : ''}" data-pm-edit="${(x.parent || t).id}" title="${esc(FREQ_LABEL[freq] || '')}${x.kind === 'prep' ? ` · get ready for ${esc(x.parent.name)}` : ''}">
        ${x.kind === 'prep' ? '<span class="cal-k">Get ready</span> ' : ''}${esc(t.name)}${x.kind === 'fixed' ? ` <span class="cal-rng">by ${esc(DAYN[new Date(`${x.b}T12:00:00`).getDay()].slice(0, 3))} ${dshort(x.b)}</span>` : range}</button>`;
    };
    let lastMonth = '';
    const rows = [];
    for (let w = 0; w < WEEKS; w += 1) {
      const ws = addD(start, w * 7);
      const we = addD(ws, 6);
      const here = items.filter((x) => x.a <= we && x.b >= ws);
      const fixed = here.filter((x) => x.kind !== 'flex');
      const flex = [];
      const mid = addD(ws, 3);
      const mon = MON[parts(mid)[1] - 1];
      if (mon !== lastMonth) {
        // Tasks that can be done any time in a long stretch: once per month, not in every week.
        const [yy, mm] = parts(mid);
        const ms = isoOf(new Date(yy, mm - 1, 1));
        const me = isoOf(new Date(yy, mm, 0));
        const seen = new Set();
        const longOnes = items.filter((x) => x.kind === 'flex' && x.a <= me && x.b >= ms && !seen.has(x.t.id) && seen.add(x.t.id));
        rows.push(`<div class="cal-month">${mon} ${yy}</div>${longOnes.length ? `<div class="cal-anytime"><span>Any time in a longer stretch:</span>${longOnes.map(chip).join('')}</div>` : ''}`);
        lastMonth = mon;
      }
      rows.push(`<div class="cal-week${w === 0 ? ' now' : ''}${fixed.length ? '' : ' open'}">
        <div class="cal-when"><b>${dshort(ws)} – ${dshort(we)}</b>${w < 2 ? `<span>${w === 0 ? 'This week' : 'Next week'}</span>` : ''}
          <span class="cal-load ${fixed.length ? (fixed.length >= 3 ? 'busy' : '') : 'free'}">${fixed.length ? `${fixed.length} due` : 'Open'}</span></div>
        <div class="cal-items">${fixed.map(chip).join('')}${flex.length ? `<div class="cal-flex">${flex.map(chip).join('')}</div>` : ''}${!here.length ? '<span class="muted cal-none">Nothing scheduled</span>' : ''}</div></div>`);
    }
    return `${rhythm(tasks)}
      <details class="cal-more"><summary>See the next 4 months week by week</summary>
      <div class="cal-help card"><b>How to read this</b><span>Each row is a week, with the tasks due in it. <b class="cal-load free">Open</b> weeks have nothing due, so they're a good spot for a new task. Tasks that can be done any time in a month or longer are listed once under the month. Tap a task to change it.</span>
        <div class="cal-legend">${[['f-week', 'Weekly'], ['f-2wk', 'Every 2 weeks'], ['f-month', 'Monthly'], ['f-quarter', 'Quarterly'], ['f-year', 'Yearly'], ['f-once', 'One time']].map(([c, l]) => `<span class="cal-chip fixed ${c}">${l}</span>`).join('')}</div></div>
      <div class="cal">${rows.join('')}</div></details>`;
  }

  // ---- This period -------------------------------------------------------
  // When a task's next round starts, for ones waiting on their next window.
  function nextStart(t, today) {
    if (t.frequency === 'once') return t.once_start || t.once_due || null;
    const [y, m, d] = parts(today);
    const iso = (dt) => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
    const after = (dt) => iso(dt) > today;
    if (t.frequency === 'weekly') return addD(weekStart(today), 7);
    if (t.frequency === 'biweekly') return addD(fortnightStart(today, t.start_day || 1), 14);
    const sd = t.start_day || 1;
    for (let k = 0; k <= 24; k += 1) {
      const dt = new Date(y, m - 1 + k, sd);
      const mm = dt.getMonth() + 1;
      const ok = t.frequency === 'monthly' || (t.frequency === 'quarterly' && (mm - 1) % 3 === ((t.start_month || 1) - 1) % 3) || (t.frequency === 'yearly' && mm === (t.start_month || 1));
      if (ok && after(dt)) return iso(dt);
    }
    return null;
  }
  let preps = [];   // get-ready steps of every task, set on each render
  let allRuns = []; // every round, set on each render
  function comingUp(waiting, today) {
    if (!waiting.length) return '';
    const rows = waiting.map((t) => {
      const st = nextStart(t, today);
      let end = null;
      if (t.frequency === 'once' && t.once_due) end = dshort(t.once_due);
      else if (st && t.due_days) { const [a, b, c] = parts(st); const dt = new Date(a, b - 1, c + t.due_days - 1); end = `${MON[dt.getMonth()]} ${dt.getDate()}`; }
      const pr = preps.filter((c) => c.parent_id === t.id && c.active && c.lead_days).map((c) => `${esc(c.name)} from ${dshort(addD(st, -c.lead_days))}`);
      if (t.frequency === 'once') return { t, st, txt: `Shows up ${dshort(st)}${end ? ` · due by ${end}` : ''}` };
      return { t, st, txt: st ? `Next round starts ${dshort(st)}${end ? ` · due by ${end}` : ''}${pr.length ? ` · Get ready: ${pr.join(', ')}` : ''}` : '' };
    }).sort((a, b) => String(a.st).localeCompare(String(b.st)));
    return `<h2 class="pm-sect">Coming up <span class="muted">not due yet this period</span></h2>
      <div class="pm-list">${rows.map(({ t, txt }) => `<button type="button" class="pm-card upcoming" data-pm-edit="${t.id}" title="Open ${esc(t.name)}"><span class="pm-check pm-wait" aria-hidden="true">⏳</span>
        <span class="pm-body"><b class="pm-name">${esc(t.name)}</b><span class="pm-meta">${[FREQ_LABEL[t.frequency], t.location ? esc(t.location) : '', txt].filter(Boolean).join(' · ')}</span>
          ${ctBy(t.contractor_id) ? `<span class="pm-meta">Contractor: ${esc(ctBy(t.contractor_id).name)}</span>` : ''}
          <span class="pm-meta ${onIt(t).length ? '' : 'pm-nobody'}">${onIt(t).length ? `On it: ${onIt(t).map(esc).join(', ')}` : 'Nobody on it yet'}</span></span>
        <span class="pm-open">Open</span></button>`).join('')}</div>`;
  }

  function nowView(current, taskBy, who, today, active = []) {
    const have = new Set(current.map((r) => r.task_id));
    // Waiting for their next round (a one-time task that's finished isn't waiting).
    const waiting = active.filter((t) => !have.has(t.id) && !(t.frequency === 'once' && allRuns.some((r) => r.task_id === t.id && r.status !== 'open')));
    const preps = current.filter((r) => taskBy[r.task_id].parent_id)
      .sort((a, b) => (b.status === 'open') - (a.status === 'open') || a.due_on.localeCompare(b.due_on));
    const prepHtml = preps.length ? `<h2 class="pm-sect">Get ready <span class="muted">before upcoming rounds · ${preps.filter((r) => r.status === 'open').length} to do</span></h2>
      <div class="pm-list">${preps.map((r) => runCard(r, taskBy[r.task_id], who, today, taskBy[taskBy[r.task_id].parent_id])).join('')}</div>` : '';
    if (!current.length && waiting.length) return comingUp(waiting, today);
    if (current.length && current.length === preps.length) return prepHtml + comingUp(waiting, today);
    if (!current.length) {
      return `<div class="card pm-empty"><b>Nothing on the schedule yet.</b><p class="muted">Add each recurring job once: what it is, how often, and how long the team has to get it done. It then comes up on its own every week, month, quarter or year.</p>
        <div class="row" style="margin-top:14px"><button class="btn primary" data-pm-new>+ Add your first task</button></div></div>`;
    }
    return prepHtml + FREQS.map(([f, label]) => {
      const rs = current.filter((r) => taskBy[r.task_id].frequency === f && !taskBy[r.task_id].parent_id)
        .sort((a, b) => (b.status === 'open') - (a.status === 'open') || a.due_on.localeCompare(b.due_on) || taskBy[a.task_id].sort - taskBy[b.task_id].sort);
      if (!rs.length) return '';
      const left = rs.filter((r) => r.status === 'open').length;
      return `<h2 class="pm-sect">${label} <span class="muted">${f === 'once' ? '' : `${periodLabel(f, rs[0].period_start, rs[0].period_end)} · `}${left ? `${left} to do` : 'all done'}</span></h2>
        <div class="pm-list">${rs.map((r) => runCard(r, taskBy[r.task_id], who, today)).join('')}</div>`;
    }).join('') + comingUp(waiting, today);
  }

  function dueText(r, today) {
    if (r.status === 'done') return '';
    if (r.status === 'skipped') return '<span class="pm-due">Skipped this time</span>';
    if (r.due_on < today) return `<span class="pm-due late">Overdue · was due ${dshort(r.due_on)}</span>`;
    if (r.due_on === today) return '<span class="pm-due soon">Due today</span>';
    const n = dayDiff(r.due_on, today);
    return `<span class="pm-due${n <= 7 ? ' soon' : ''}">Due by ${dshort(r.due_on)}${n <= 7 ? ` · ${n} day${n === 1 ? '' : 's'}` : ''}</span>`;
  }

  // "Done by a contractor" line with tap-to-call / email.
  const ctLine = (t) => {
    const c = ctBy(t.contractor_id);
    return c ? `<span class="pm-ct"><span class="pm-ct-tag">Contractor</span> <b>${esc(c.name)}</b>${contractorContact(c, esc) ? ` · ${contractorContact(c, esc)}` : ''}</span>` : '';
  };
  function runCard(r, t, who, today, parent = null) {
    const isDone = r.status === 'done';
    const steps = t.steps || [];
    const live = r.status === 'open' || r.status === 'missed';
    const names = onIt(t);
    const avs = names.length ? `<span class="b-avs">${names.slice(0, 3).map((n) => `<span class="b-av" style="background:${hue(n)}" title="${esc(n)}">${esc(initials(n))}</span>`).join('')}${names.length > 3 ? `<span class="b-av more">+${names.length - 3}</span>` : ''}</span>` : '';
    const whoBtn = manage() && live
      ? `<button class="b-who${names.length ? '' : ' empty'}" data-pm-people="${t.id}" title="${names.length ? esc(names.join(', ')) : 'Add people'}">${avs || '<span class="b-whoadd">+ Person</span>'}</button>`
      : avs ? `<span class="b-who" title="${esc(names.join(', '))}">${avs}</span>` : '';
    const time = r.timer_started_at
      ? `<span class="b-time num"><span class="b-live" data-pm-live data-base="${r.worked_seconds || 0}" data-since="${new Date(r.timer_started_at).getTime()}">${tdur(liveSecs(r))}</span></span>`
      : r.worked_seconds ? `<span class="b-time num"><span>${tdur(r.worked_seconds)}</span></span>` : '';
    const timerBtn = live ? `<button class="btn small${r.timer_started_at ? ' b-running' : ''}" data-pm-timer="${r.id}" data-run="${r.timer_started_at ? 0 : 1}">${r.timer_started_at ? '■ Stop' : '▶ Start'}</button>` : '';
    return `<div class="pm-card ${r.status}${r.timer_started_at ? ' running' : ''}${r.status === 'open' && r.due_on < today ? ' late' : ''}">
      <button class="pm-check" data-mark="${r.id}" data-to="${isDone ? 'open' : 'done'}" aria-label="${isDone ? 'Mark not done' : 'Mark done'}">${isDone ? '✓' : ''}</button>
      <div class="pm-body">
        <b class="pm-name">${esc(t.name)}</b>
        <span class="pm-meta">${[parent ? `Before <b>${esc(parent.name)}</b> (starts ${dshort(addD(r.period_end, 1))})` : '', t.location ? esc(t.location) : '', dueText(r, today)].filter(Boolean).join(' · ')}</span>
        ${isDone ? `<span class="pm-meta pm-donewho">Done by ${esc(who[r.done_by] || 'someone')} · ${new Date(r.done_at).toLocaleDateString([], { month: 'short', day: 'numeric' })}${r.note ? ` · ${esc(r.note)}` : ''}</span>` : ''}
        ${notesBlock(t.notes, esc)}
        ${ctLine(t)}
        ${steps.length ? `<div class="pm-steps">${steps.map((s, i) => `<label><input type="checkbox" data-step="${r.id}" data-i="${i}" ${(r.steps_done || []).includes(i) ? 'checked' : ''}> ${esc(s)}</label>`).join('')}</div>` : ''}
      </div>
      <div class="pm-actions">${whoBtn}${time}${timerBtn}${r.status === 'open' ? `<button class="btn small" data-mark="${r.id}" data-to="skipped" title="Not needed this time">Skip</button>` : r.status === 'skipped' ? `<button class="btn small" data-mark="${r.id}" data-to="open">Undo skip</button>` : ''}</div>
    </div>`;
  }

  // ---- All tasks (the master list) ---------------------------------------
  function taskList(tasks, locations) {
    const top = tasks.filter((t) => !t.parent_id);
    const active = top.filter((t) => t.active);
    const archived = top.filter((t) => !t.active);
    const LEAD = (n) => (n % 7 === 0 ? `${n / 7} week${n === 7 ? '' : 's'}` : `${n} day${n === 1 ? '' : 's'}`);
    const prepLine = (t) => { const ps = tasks.filter((c) => c.parent_id === t.id && c.active); return ps.length ? `<span class="muted pm-prepline">Get ready: ${ps.map((c) => `${esc(c.name)} · ${LEAD(c.lead_days)} before`).join(' · ')}</span>` : ''; };
    const rows = (list) => `<div class="pm-tasks">${list.map((t) => `<button type="button" class="pm-task-row${t.active ? '' : ' off'}" data-pm-edit="${t.id}">
        <b>${esc(t.name)}</b><span class="muted">${FREQ_LABEL[t.frequency]} · ${windowText(t)}${t.location ? ` · ${esc(t.location)}` : ''}${ctBy(t.contractor_id) ? ` · Contractor: ${esc(ctBy(t.contractor_id).name)}` : ''}${onIt(t).length ? ` · On it: ${onIt(t).map(esc).join(', ')}` : ''}</span>${prepLine(t)}<span class="pm-edit">Edit</span></button>`).join('')}</div>`;
    return `${top.length ? '' : '<div class="card pm-empty"><b>No tasks yet.</b><p class="muted">Use <b>+ Add task</b> above to add your first recurring job.</p></div>'}
      ${FREQS.map(([f, label]) => { const list = active.filter((t) => t.frequency === f); return list.length ? `<h2 class="pm-sect">${label} <span class="muted">${list.length}</span></h2>${rows(list)}` : ''; }).join('')}
      ${archived.length ? `<h2 class="pm-sect">Off the schedule <span class="muted">${archived.length}</span></h2>${rows(archived)}` : ''}`;
  }

  // ---- Add / edit a task (pop-up) -----------------------------------------
  // Asks it the way people think about it: how often, which month(s), and
  // when in that month it should get done. That is stored as a start day and
  // a number of days (start_day / due_days), which the database schedules from.
  // Weeks run Tuesday-Monday: day 1 = Tuesday.
  const WEEK_WIN = [['any', 'Any day that week', null], ['wed', 'By Wednesday', 2], ['fri', 'By Friday', 4], ['sat', 'By Saturday', 5], ['sun', 'By Sunday', 6]];
  // Every 2 weeks: you pick the week it's done in; it shows up that week.
  const BIWEEK_WIN = [['w1', 'Any day that week', 7], ['fri1', 'By Friday that week', 4], ['any', 'Any time in the 2 weeks', null]];
  const LEADS = [[3, '3 days'], [7, '1 week'], [14, '2 weeks'], [21, '3 weeks'], [30, '30 days']];
  const MONTH_WIN = [['any', 'Any time', 1, null], ['w1', 'First week (1st–7th)', 1, 7], ['w2', 'First 2 weeks (1st–14th)', 1, 14], ['h2', 'Second half (15th–28th)', 15, 14]];
  const ord = (n) => `${n}${['th', 'st', 'nd', 'rd'][(n % 10 > 3 || Math.floor(n / 10) % 10 === 1) ? 0 : n % 10]}`;
  function pickCrew(t) {
    return new Promise((resolve) => {
      const sel = new Set(t.assignees || []);
      const back = document.createElement('div');
      back.className = 'modal-back';
      back.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-label="Who's on it">
        <h3>Who's on it?</h3><p class="muted">${esc(t.name)}</p>
        <div class="wk-chips">${crew.map((m) => `<button type="button" class="chip-btn pm-person" data-person="${m.id}">${esc(m.name)}</button>`).join('') || '<span class="muted">No team members yet.</span>'}</div>
        <div class="modal-actions"><button type="button" class="btn" data-clear>Nobody</button><button type="button" class="btn" data-cancel>Cancel</button><button type="button" class="btn primary" data-ok>Save</button></div></div>`;
      const draw = () => back.querySelectorAll('[data-person]').forEach((b) => b.classList.toggle('on', sel.has(b.dataset.person)));
      back.querySelectorAll('[data-person]').forEach((b) => b.addEventListener('click', () => { if (sel.has(b.dataset.person)) sel.delete(b.dataset.person); else sel.add(b.dataset.person); draw(); }));
      const done = (v) => { back.remove(); resolve(v); };
      back.querySelector('[data-ok]').addEventListener('click', () => done([...sel]));
      back.querySelector('[data-clear]').addEventListener('click', () => done([]));
      back.querySelector('[data-cancel]').addEventListener('click', () => done(null));
      back.addEventListener('click', (e) => { if (e.target === back) done(null); });
      draw();
      document.body.appendChild(back);
    });
  }

  function taskModal(places, t = {}) {
    const editing = !!t.id;
    let freq = t.frequency || 'monthly';
    let month = t.start_month || 1;
    let win = 'any';
    let from = 1;
    let to = '';
    let parity = 1;   // every 2 weeks: which Sunday it starts on (1 or 2)
    let prepList = (t.preps || []).map((c) => ({ id: c.id, name: c.name, lead: c.lead_days || 7 }));
    const todayIso = isoOf(new Date());
    let ctId = t.contractor_id || null;
    let people = new Set(t.assignees || []);
    let onceDue = t.once_due || '';
    let onceStart = t.once_start || '';
    let byCt = !!ctId;
    // Work out which choice an existing task matches.
    const load = (x) => {
      freq = x.frequency || freq; month = x.start_month || month;
      if (freq === 'once') { win = 'any'; return; }
      const sd = x.start_day || 1;
      const n = x.due_days ?? null;
      if (freq === 'weekly') { win = (WEEK_WIN.find((w) => w[2] === n) || ['custom'])[0]; from = 1; to = n || ''; return; }
      if (freq === 'biweekly') { parity = x.start_day || 1; win = (BIWEEK_WIN.find((w) => w[2] === n) || ['custom'])[0]; from = 1; to = n || ''; return; }
      const m = MONTH_WIN.find((w) => w[2] === sd && w[3] === n) || (freq === 'quarterly' && sd === 1 && n === 30 ? ['m1'] : null);
      win = m ? m[0] : 'custom'; from = sd; to = n ? Math.min(31, sd + n - 1) : '';
    };
    load(t);
    const CYCLES = [[1, 'Jan · Apr · Jul · Oct'], [2, 'Feb · May · Aug · Nov'], [3, 'Mar · Jun · Sep · Dec']];
    const winChoices = () => (freq === 'weekly' ? WEEK_WIN.map(([k, l]) => [k, l]) : freq === 'biweekly' ? BIWEEK_WIN.map(([k, l]) => [k, l])
      : [...MONTH_WIN.map(([k, l]) => [k, k === 'any' ? (freq === 'monthly' ? 'Any time that month' : freq === 'quarterly' ? 'Any time in the 3 months' : 'Any time that year') : l]),
        ...(freq === 'quarterly' ? [['m1', 'Any time in that first month']] : [])]);
    // start_day / due_days from the choice.
    const params = () => {
      if (freq === 'weekly') { const w = WEEK_WIN.find((x) => x[0] === win); return { sd: null, n: w ? w[2] : (parseInt(to, 10) || null) }; }
      if (freq === 'biweekly') { const w = BIWEEK_WIN.find((x) => x[0] === win); return { sd: parity, n: w ? w[2] : (Math.min(14, parseInt(to, 10)) || null) }; }
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
        <div class="wk-sect">How often</div>
        <div class="wk-chips">${FREQS.map(([k, l]) => `<button type="button" class="chip-btn big" data-freq="${k}">${l}</button>`).join('')}</div>
        ${anchorsReady ? `<div data-for="quarterly"><div class="wk-sect">Which months</div>
          <div class="wk-chips">${CYCLES.map(([m, l]) => `<button type="button" class="chip-btn" data-month="${m}">${l}</button>`).join('')}</div></div>
        <div data-for="yearly"><div class="wk-sect">Which month</div>
          <div class="wk-chips">${MON.map((mn, i) => `<button type="button" class="chip-btn" data-month="${i + 1}">${mn}</button>`).join('')}</div></div>` : ''}
        <div data-for="biweekly"><div class="wk-sect">Which week to do it</div>
          <div class="wk-chips">${[1, 2].sort((x, y) => (fortnightStart(todayIso, y) > fortnightStart(todayIso, x) ? 1 : -1)).map((pp) => {
            const thisSun = weekStart(todayIso);
            const s0 = fortnightStart(todayIso, pp);
            const first = s0 === thisSun ? thisSun : addD(s0, 14);
            const label = first === thisSun ? 'This week' : 'Next week';
            return `<button type="button" class="chip-btn pm-week" data-parity="${pp}"><b>${label}</b> <span>${dshort(first)}–${dshort(addD(first, 6))}, then every other week (${dshort(addD(first, 14))}, ${dshort(addD(first, 28))}…)</span></button>`;
          }).join('')}</div></div>
        <div data-for="once"><div class="wk-sect">When</div>
          <div class="pm-once"><label><span>Due by</span><input type="date" name="once_due" value="${esc(onceDue)}"></label>
          <label><span>Put it on the list on <span class="muted">(optional)</span></span><input type="date" name="once_start" value="${esc(onceStart)}"></label></div>
          <p class="muted pm-once-hint">Leave the second date empty to put it on the list now. It stays on the list until it's done.</p></div>
        <div data-notonce><div class="wk-sect" data-when-title></div>
        <div class="wk-chips" data-wins></div>
        <div class="pm-custom" data-custom-row></div></div>
        <p class="pm-preview" data-pm-preview></p>
        <div data-notonce><div class="wk-sect">Get ready first <span class="muted pm-opt">(optional: ordering parts, booking a vendor…)</span></div>
        <div class="pm-preps" data-preps></div>
        <button type="button" class="dp-link pm-prep-add" data-prep-add>+ Add a get-ready step</button></div>
        <div class="wk-sect">Who does it</div>
        <div class="wk-chips"><button type="button" class="chip-btn" data-by="team">Our team</button><button type="button" class="chip-btn" data-by="ct">A contractor we hire</button></div>
        <div class="pm-ctpick" data-ctpick></div>
        <div class="wk-sect">Who's on it <span class="muted pm-opt">(optional: tap to add or remove)</span></div>
        <div class="wk-chips" data-people>${crew.map((m) => `<button type="button" class="chip-btn pm-person" data-person="${m.id}">${esc(m.name)}</button>`).join('') || '<span class="muted">No team members yet.</span>'}</div>
        <label style="margin-top:12px"><span>Where <span class="muted">(optional)</span></span><input name="location" value="${esc(t.location || '')}" placeholder="Type a place, e.g. Main entrance, Kids wing"></label>
        <details class="pm-more" ${(t.steps || []).length || t.notes ? 'open' : ''}><summary>Steps and notes <span class="muted">(optional)</span></summary>
          <label style="margin-top:10px"><span>Steps <span class="muted">(one per line)</span></span><textarea name="steps" rows="3" placeholder="North entrance&#10;South entrance">${esc((t.steps || []).join('\n'))}</textarea></label>
          <label style="margin-top:10px"><span>Notes <span class="muted">(sizes, part numbers, who to call · start a line with * for a bullet)</span></span><textarea name="notes" class="pm-notes-input" rows="${Math.min(14, Math.max(4, String(t.notes || '').split('\n').length + 1))}" placeholder="Laundry Room&#10;* 2 - 20x25x2">${esc(t.notes || '')}</textarea></label>
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
        const where = freq === 'weekly' ? 'When in the week' : freq === 'biweekly' ? 'When in the 2 weeks' : freq === 'monthly' ? 'When in the month' : freq === 'quarterly' ? 'When in the first of those months' : 'When in that month';
        $('[data-when-title]').textContent = freq === 'quarterly' && win === 'any' ? 'When' : where;
        $('[data-wins]').innerHTML = [...winChoices(), ['custom', freq === 'weekly' ? 'Other' : 'Pick the days']].map(([k, l]) => `<button type="button" class="chip-btn${win === k ? ' on' : ''}" data-win="${k}">${l}</button>`).join('');
        $('[data-custom-row]').innerHTML = win !== 'custom' ? ''
          : freq === 'biweekly' ? `<label class="pm-day">Within the first <input name="to" type="number" min="1" max="14" value="${esc(to)}"> days <span class="muted">(starting Sunday)</span></label>`
          : freq === 'weekly' ? `<label class="pm-day">Within the first <input name="to" type="number" min="1" max="7" value="${esc(to)}"> days of the week <span class="muted">(weeks start Tuesday)</span></label>`
            : `<label class="pm-day">From the <input name="from" type="number" min="1" max="28" value="${esc(from)}"> to the <input name="to" type="number" min="1" max="31" value="${esc(to)}" placeholder="any"> <span class="muted">of the month</span></label>`;
        $('[data-custom-row]').querySelectorAll('input').forEach((i) => i.addEventListener('input', () => { if (i.name === 'from') from = i.value; else to = i.value; preview(); }));
        $('[data-wins]').querySelectorAll('[data-win]').forEach((b) => b.addEventListener('click', () => { win = b.dataset.win; drawWins(); preview(); }));
      };
      const preview = () => {
        if (freq === 'once') { $('[data-pm-preview]').textContent = windowText({ frequency: 'once', once_due: onceDue, once_start: onceStart }); return; }
        const { sd, n } = params();
        let txt = windowText({ frequency: freq, due_days: n, start_month: month, start_day: sd });
        if (win === 'custom' && freq !== 'weekly' && to && parseInt(to, 10) < (parseInt(from, 10) || 1)) txt = 'The end day has to be after the start day.';
        $('[data-pm-preview]').textContent = txt;
        drawPreps();
      };
      // Get-ready steps, each with how long before the round it comes up.
      const drawPreps = () => {
        const { sd } = params();
        const st = nextStart({ frequency: freq, start_month: month, start_day: freq === 'weekly' ? null : sd }, todayIso);
        $('[data-preps]').innerHTML = prepList.map((c, i) => `<div class="pm-prep">
            <input data-pn="${i}" value="${esc(c.name)}" placeholder="e.g. Order filters" aria-label="Get-ready step">
            <select data-pl="${i}" aria-label="How long before">${[...LEADS, ...(LEADS.some(([v]) => v === c.lead) ? [] : [[c.lead, `${c.lead} days`]])].map(([v, l]) => `<option value="${v}" ${v === c.lead ? 'selected' : ''}>${l} before</option>`).join('')}</select>
            <button type="button" class="pm-prep-x" data-pr="${i}" aria-label="Remove">×</button>
            ${st ? `<span class="muted pm-prep-when">Next: ${dshort(addD(st, -c.lead))} – ${dshort(addD(st, -1))}, before the ${dshort(st)} round</span>` : ''}</div>`).join('');
        $('[data-preps]').querySelectorAll('[data-pn]').forEach((x) => x.addEventListener('input', () => { prepList[x.dataset.pn].name = x.value; }));
        $('[data-preps]').querySelectorAll('[data-pl]').forEach((x) => x.addEventListener('change', () => { prepList[x.dataset.pl].lead = Number(x.value); drawPreps(); }));
        $('[data-preps]').querySelectorAll('[data-pr]').forEach((x) => x.addEventListener('click', () => { prepList.splice(Number(x.dataset.pr), 1); drawPreps(); }));
      };
      const drawCt = () => {
        form.querySelectorAll('[data-by]').forEach((b) => b.classList.toggle('on', (b.dataset.by === 'ct') === byCt));
        const box = $('[data-ctpick]');
        if (!byCt) { box.innerHTML = ''; return; }
        const list = contractors.filter((c) => c.active || c.id === ctId);
        const c = ctBy(ctId);
        box.innerHTML = `<div class="pm-ctrow">${list.length ? `<select data-ct aria-label="Contractor"><option value="">— Pick a contractor —</option>${list.map((x) => `<option value="${x.id}" ${x.id === ctId ? 'selected' : ''}>${esc(x.name)}${x.trade ? ` · ${esc(x.trade)}` : ''}</option>`).join('')}</select>` : '<span class="muted">No contractors on the list yet.</span>'}
          ${ctx.isAdmin?.() ? '<button type="button" class="dp-link" data-ct-new>+ New contractor</button>' : ''}</div>
          ${c ? `<p class="pm-ctinfo">${contractorContact(c, esc) || '<span class="muted">No contact info saved</span>'}</p>` : ''}`;
        box.querySelector('[data-ct]')?.addEventListener('change', (e) => { ctId = Number(e.target.value) || null; drawCt(); });
        box.querySelector('[data-ct-new]')?.addEventListener('click', async () => {
          const row = await ctx.contractors.editContractor({});
          if (row) { contractors = [...contractors, row].sort((a, b) => a.name.localeCompare(b.name)); ctId = row.id; drawCt(); }
        });
      };
      form.querySelectorAll('[data-by]').forEach((b) => b.addEventListener('click', () => { byCt = b.dataset.by === 'ct'; drawCt(); }));
      const drawPeople = () => form.querySelectorAll('[data-person]').forEach((b) => b.classList.toggle('on', people.has(b.dataset.person)));
      form.querySelectorAll('[data-person]').forEach((b) => b.addEventListener('click', () => { const id = b.dataset.person; if (people.has(id)) people.delete(id); else people.add(id); drawPeople(); }));
      drawPeople();
      drawCt();
      const sync = () => {
        form.querySelectorAll('[data-parity]').forEach((b) => b.classList.toggle('on', Number(b.dataset.parity) === parity));
        form.querySelectorAll('[data-freq]').forEach((b) => b.classList.toggle('on', b.dataset.freq === freq));
        form.querySelectorAll('[data-for]').forEach((el) => { el.hidden = el.dataset.for !== freq; });
        form.querySelectorAll('[data-notonce]').forEach((el) => { el.hidden = freq === 'once'; });
        form.querySelectorAll('[data-month]').forEach((b) => {
          const m = Number(b.dataset.month);
          b.classList.toggle('on', freq === 'quarterly' ? (m - 1) % 3 === (month - 1) % 3 : m === month);
        });
        drawWins(); preview();
      };
      form.querySelectorAll('[data-parity]').forEach((b) => b.addEventListener('click', () => { parity = Number(b.dataset.parity); sync(); }));
      $('[name=once_due]').addEventListener('change', (e) => { onceDue = e.target.value; preview(); });
      $('[name=once_start]').addEventListener('change', (e) => { onceStart = e.target.value; preview(); });
      $('[data-prep-add]').addEventListener('click', () => { prepList.push({ name: '', lead: 7 }); drawPreps(); $(`[data-pn="${prepList.length - 1}"]`).focus(); });
      form.querySelectorAll('[data-freq]').forEach((b) => b.addEventListener('click', () => {
        if (freq === b.dataset.freq) return;
        freq = b.dataset.freq;
        if (!winChoices().some(([k]) => k === win) && win !== 'custom') win = freq === 'biweekly' ? 'w1' : 'any';
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
        if (freq === 'once' && !onceDue) { toast('Pick the date it is due', true); return; }
        if (freq === 'once' && onceStart && onceStart > onceDue) { toast('The list date has to be on or before the due date', true); return; }
        const { sd, n } = freq === 'once' ? { sd: null, n: null } : params();
        if (win === 'custom' && freq !== 'weekly' && to && parseInt(to, 10) < (parseInt(from, 10) || 1)) { toast('The end day has to be after the start day', true); return; }
        const f = new FormData(form);
        try {
          const id = await rpc('pm_save_task', {
            p_id: t.id || null, p_name: name, p_frequency: freq, p_due_days: n,
            p_location: String(f.get('location') || '').trim() || null, p_notes: f.get('notes') || null,
            p_steps: String(f.get('steps') || '').split('\n').map((x) => x.trim()).filter(Boolean),
            ...(anchorsReady ? { p_start_month: ['quarterly', 'yearly'].includes(freq) ? month : null, p_start_day: ['weekly', 'once'].includes(freq) ? null : sd } : {}),
          });
          if (freq === 'once' && (onceDue !== (t.once_due || '') || onceStart !== (t.once_start || '') || t.frequency !== 'once')) await rpc('pm_set_once', { p_task: t.id || id, p_start: onceStart || null, p_due: onceDue });
          const keep = prepList.filter((c) => c.name.trim());
          const newCt = byCt ? ctId : null;
          if (newCt !== (t.contractor_id || null)) await rpc('pm_set_contractor', { p_task: t.id || id, p_contractor: newCt });
          const ppl = [...people];
          if (ppl.sort().join() !== [...(t.assignees || [])].sort().join()) await rpc('pm_set_assignees', { p_task: t.id || id, p_people: ppl });
          if (freq !== 'once' && (editing || keep.length)) await rpc('pm_set_preps', { p_parent: t.id || id, p_preps: keep.map((c) => ({ id: c.id || null, name: c.name.trim(), lead_days: c.lead })) });
          changed = true;
          toast(editing ? 'Saved' : `Added “${name}” to the schedule`);
          if (!again) return done();
          form.reset(); $('[name=name]').value = ''; win = 'any'; prepList = []; byCt = false; ctId = null; people = new Set(); onceDue = ''; onceStart = ''; drawPeople(); drawCt(); sync(); $('[name=name]').focus();
        } catch (err) { toast(errMsg(err), true); }
      };
      // One save at a time: a double tap or Enter + click must not add the task twice.
      let saving = false;
      const saveOnce = async (again) => {
        if (saving) return;
        saving = true;
        const btns = form.querySelectorAll('.modal-actions button');
        btns.forEach((b) => { b.disabled = true; });
        try { await save(again); } finally { saving = false; btns.forEach((b) => { b.disabled = false; }); }
      };
      $('[data-again]')?.addEventListener('click', () => saveOnce(true));
      form.addEventListener('submit', (e) => { e.preventDefault(); saveOnce(false); });
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
        const par = t.parent_id ? taskBy[t.parent_id] : null;
        return `<tr><td>${par ? `${dshort(r.period_start)} – ${dshort(r.period_end)}` : periodLabel(t.frequency, r.period_start, r.period_end)}</td><td>${esc(t.name)}${par ? ` <span class="muted">· before ${esc(par.name)}</span>` : ''}</td>
        <td><span class="pill ${r.status === 'done' ? 'available' : r.status === 'missed' ? 'lost' : 'closed'}">${label[r.status]}</span>${late ? ' <span class="muted">late</span>' : ''}</td>
        <td>${esc(who[r.done_by] || '')}</td><td>${r.done_at ? new Date(r.done_at).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) : ''}</td><td>${esc(r.note || '')}</td></tr>`; }).join('')}</table></div>`;
  }

  function bind(view, tasks, current) {
    const reload = () => renderSchedule(view);
    app.querySelectorAll('[data-pm-new]').forEach((b) => b.addEventListener('click', async () => {
      if (!manage()) return toast('Only admins and the Maintenance manager can add tasks');
      const added = await taskModal(await loadPlaces(sb), {});
      if (added) reload();
    }));
    app.querySelectorAll('[data-pm-edit]').forEach((b) => b.addEventListener('click', async () => {
      if (!manage()) return toast('Only admins and the Maintenance manager can change tasks');
      const t = tasks.find((x) => x.id === Number(b.dataset.pmEdit));
      if (t && (await taskModal(await loadPlaces(sb), { ...t, preps: tasks.filter((c) => c.parent_id === t.id && c.active) }))) reload();
    }));
    pulled.bind(app, reload);
    app.querySelectorAll('[data-pm-timer]').forEach((b) => b.addEventListener('click', async () => {
      try { await rpc('pm_timer', { p_run: Number(b.dataset.pmTimer), p_run_on: b.dataset.run === '1' }); reload(); } catch (err) { toast(errMsg(err), true); }
    }));
    clearInterval(pmTick);
    if (app.querySelector('[data-pm-live]')) pmTick = setInterval(() => {
      const els = app.querySelectorAll('[data-pm-live]');
      if (!els.length) { clearInterval(pmTick); return; }
      els.forEach((el) => { el.textContent = tdur(Number(el.dataset.base) + (Date.now() - Number(el.dataset.since)) / 1000); });
    }, 1000);
    // Who's on it, right from the card (get-ready steps too).
    app.querySelectorAll('[data-pm-people]').forEach((b) => b.addEventListener('click', async () => {
      const t = tasks.find((x) => x.id === Number(b.dataset.pmPeople));
      if (!t) return;
      const ppl = await pickCrew(t);
      if (!ppl) return;
      try { await rpc('pm_set_assignees', { p_task: t.id, p_people: ppl }); toast(ppl.length ? `On ${t.name}: ${ppl.map((id) => whoAll[id]).join(', ')}` : `Nobody on ${t.name}`); reload(); } catch (err) { toast(errMsg(err), true); }
    }));
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

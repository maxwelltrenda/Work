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
// Set days (0070): the round's own days if it was moved, else the task's usual days.
const WEEK_ORDER = ['Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday', 'Monday'];
const DOW_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const runDays = (r, t) => (r.work_days ?? t.work_days ?? []);
// The dates of those days in the round (first one on/after it starts).
export function runDates(r, t) {
  const days = runDays(r, t);
  if (!days.length) return null;
  const [y, m, d] = String(r.period_start).split('-').map(Number);
  return days.map((name) => { const want = DOW_NAMES.indexOf(name); for (let i = 0; i < 14; i += 1) { const dt = new Date(y, m - 1, d + i); if (dt.getDay() === want) return isoOf(dt); } return null; })
    .filter(Boolean).sort();
}
// The date that decides where a round shows: its next set day, or when it's due.
export const whenOf = (r, t, today) => { const ds = runDates(r, t); return ds ? (ds.find((x) => x >= today) || r.due_on) : r.due_on; };
// "09:00:00" -> "9 AM", "12:30" -> "12:30 PM"
const hm12 = (v) => { if (!v) return ''; const [h, m] = String(v).split(':').map(Number); return `${h % 12 || 12}${m ? `:${String(m).padStart(2, '0')}` : ''} ${h < 12 ? 'AM' : 'PM'}`; };
const slotText = (t) => (t && t.once_from ? `${hm12(t.once_from)}${t.once_to ? `–${hm12(t.once_to)}` : ''}` : '');
const TIMES = Array.from({ length: 33 }, (_, i) => { const mins = 6 * 60 + i * 30; return `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`; });
function windowText(t) {
  if (t.frequency === 'once') return t.once_due ? `One time · ${slotText(t) ? `${dshort(t.once_due)}, ${slotText(t)}` : `due ${dshort(t.once_due)}`}${t.once_start ? ` · shows up ${dshort(t.once_start)}` : ''}` : 'One time · pick the date it is due';
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

import { loadNotes, notesList, noteButton, bindNotes } from './notes.js?v=__V__';

export function schedulePages(ctx) {
  const manage = () => (ctx.canManage ? ctx.canManage() : true);
  let pmTick = null;
  let pmNotes = {};   // notes on this period's rounds, by run id
  const { sb, q, rpc, esc, toast, askConfirm, errMsg, pageHead, pulled } = ctx;
  let contractors = [];   // the Contractors list, loaded with the page
  let crew = [];          // Facilities people who can be put on a task
  let evCrew = [];        // Events people (for tasks shared with Events)
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
      q(sb.from('team_members').select('*')),
      null,
      view === 'now' ? pulled.load('maintenance').catch(() => null) : null,
      q(sb.from('contractors').select('*').order('name')).then((x) => { contractors = x; }, () => { contractors = []; }),
    ]);
    const who = Object.fromEntries(members.map((m) => [m.id, m.name]));
    whoAll = who;
    crew = members.filter((m) => m.active && !['kiosk', 'none'].includes(m.role)).sort((a, b) => a.name.localeCompare(b.name));
    // Events people (Events site only): can be put on tasks shared with Events.
    evCrew = members.filter((m) => m.active && m.events_role && ['none', 'oversight'].includes(m.role)).sort((a, b) => a.name.localeCompare(b.name));
    const taskBy = Object.fromEntries(tasks.map((t) => [t.id, t]));
    preps = tasks.filter((t) => t.parent_id);
    // A one-time task stays on the list until it's done, even past its due date.
    // Finished before this week (Tuesday) moves to Past weeks instead of staying on the list.
    const wk0 = weekStart(today);
    const current = runs.filter((r) => taskBy[r.task_id]?.active && r.period_start <= today && (r.period_end >= today || (taskBy[r.task_id].frequency === 'once' && r.status === 'open'))
      && !(['done', 'skipped'].includes(r.status) && r.done_at && isoOf(new Date(r.done_at)) < wk0));
    allRuns = runs;
    pmNotes = view === 'now' ? await loadNotes(sb, 'maintenance', current.map((r) => r.id)) : {};
    const overdue = current.filter((r) => r.status === 'open' && r.due_on < today);
    const dueSoon = current.filter((r) => r.status === 'open' && r.due_on >= today && dayDiff(r.due_on, today) <= 7);
    const done = current.filter((r) => r.status === 'done');
    const active = tasks.filter((t) => t.active && !t.parent_id);
    const tabs = [['now', 'This period'], ['calendar', 'Calendar'], ['tasks', `All tasks <b>${active.length}</b>`], ['history', 'Past weeks']];

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
      <div id="pm-view">${view === 'tasks' ? taskList(tasks, locations) : view === 'calendar' ? calendarView(tasks, runs, today) : view === 'history' ? await pastWeeks(runs, taskBy, who, today) : nowView(current, taskBy, who, today, active)}</div>`;

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
    // Grouped by WHEN it's due (not how often it repeats): late, today, this
    // week (to Monday), later. Each card says how often it comes back.
    const wkEnd = addD(weekStart(today), 6);
    const all = current.slice().sort((x, y) => x.due_on.localeCompare(y.due_on) || (taskBy[x.task_id].once_from || '').localeCompare(taskBy[y.task_id].once_from || '') || taskBy[x.task_id].sort - taskBy[y.task_id].sort);
    const open = all.filter((r) => r.status === 'open' || r.status === 'missed');
    const card = (r) => { const t = taskBy[r.task_id]; return runCard(r, t, who, today, t.parent_id ? taskBy[t.parent_id] : null); };
    const group = (title, sub, list, cls = '') => (list.length ? `<h2 class="pm-sect ${cls}">${title} <span class="muted">${sub}</span></h2><div class="pm-list">${list.map(card).join('')}</div>` : '');
    const at = (r) => whenOf(r, taskBy[r.task_id], today);
    const late = open.filter((r) => r.due_on < today);
    const now = open.filter((r) => r.due_on >= today && at(r) <= today);
    const week = open.filter((r) => r.due_on >= today && at(r) > today && at(r) <= wkEnd);
    const later = open.filter((r) => r.due_on >= today && at(r) > wkEnd);
    const done = all.filter((r) => r.status === 'done' || r.status === 'skipped');
    return group('Late', `${late.length} past due`, late, 'late')
      + group('Today', `${now.length} to do`, now)
      + group('This week', `by Monday ${dshort(wkEnd)} · ${week.length} to do`, week)
      + (now.length + week.length + late.length ? '' : '<div class="card pm-empty"><b>Nothing due this week.</b></div>')
      + (later.length || waiting.length ? `<details class="pm-later"><summary><h2 class="pm-sect">Later <span class="muted">${later.length + waiting.length} after this week</span></h2></summary>${later.length ? `<div class="pm-list">${later.map(card).join('')}</div>` : ''}${comingUp(waiting, today).replace(/<h2 class="pm-sect">[\s\S]*?<\/h2>/, '')}</details>` : '')
      + (done.length ? `<details class="pm-later"><summary><h2 class="pm-sect">Done <span class="muted">${done.length} this period</span></h2></summary><div class="pm-list">${done.map(card).join('')}</div></details>` : '');
  }

  function dueText(r, today, t = null) {
    if (r.status === 'done') return '';
    const ds = t && r.status !== 'skipped' ? runDates(r, t) : null;
    if (ds) {
      const lbl = ds.map((x) => (x === today ? 'Today' : `${DOW_NAMES[new Date(`${x}T12:00`).getDay()].slice(0, 3)} ${dshort(x)}`)).join(' & ');
      return `<span class="pm-due${ds.includes(today) || ds[0] <= addD(today, 1) ? ' soon' : ''}">${lbl}${r.work_days ? ' <span class="muted">(moved this time)</span>' : ''}</span>${manage() && (r.status === 'open' || r.status === 'missed') ? ` <button type="button" class="dp-link pm-movedays" data-pm-rundays="${r.id}">Change days</button>` : ''}`;
    }
    if (t && t.frequency === 'once' && t.once_from && r.status !== 'skipped') return `<span class="pm-due${r.due_on <= today ? ' soon' : ''}">${r.due_on === today ? 'Today' : dshort(r.due_on)}, ${slotText(t)}</span>`;
    if (r.status === 'skipped') return '<span class="pm-due">Skipped this time</span>';
    if (r.due_on < today) return `<span class="pm-due late">Overdue · was due ${dshort(r.due_on)}</span>`;
    if (r.due_on === today) return '<span class="pm-due soon">Due today</span>';
    const n = dayDiff(r.due_on, today);
    return `<span class="pm-due${n <= 7 ? ' soon' : ''}">Due by ${dshort(r.due_on)}${n <= 7 ? ` · ${n} day${n === 1 ? '' : 's'}` : ''}</span>`;
  }

  // "Done by a contractor" line with tap-to-call / email.
  const ctLine = (t) => {
    const c = ctBy(t.contractor_id);
    return c ? `<span class="pm-ct"><span class="pm-ct-tag">${t.parent_id ? 'Get it from' : 'Contractor'}</span> <b>${esc(c.name)}</b>${contractorContact(c, esc) ? ` · ${contractorContact(c, esc)}` : ''}</span>` : '';
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
    // Each person clocks in themselves: Stop only for me if I'm clocked in; Join if others are.
    const meId = ctx.me?.()?.id;
    const mineIn = (r.clocked || []).includes(meId);
    const inNames = (r.clocked || []).map((id) => whoAll[id]).filter(Boolean);
    const timerBtn = live ? `<button class="btn small${mineIn ? ' b-running' : ''}" data-pm-timer="${r.id}" data-run="${mineIn ? 0 : 1}" title="${mineIn ? 'Clock out' : r.timer_started_at ? 'Clock in too' : 'Clock in'}">${mineIn ? '■ Stop' : r.timer_started_at ? '▶ Join' : '▶ Start'}</button>` : '';
    return `<div class="pm-card ${r.status}${r.timer_started_at ? ' running' : ''}${r.status === 'open' && r.due_on < today ? ' late' : ''}">
      <button class="pm-check" data-mark="${r.id}" data-to="${isDone ? 'open' : 'done'}" aria-label="${isDone ? 'Mark not done' : 'Mark done'}">${isDone ? '✓' : ''}</button>
      <div class="pm-body">
        <b class="pm-name">${esc(t.name)}${t.shared_events || parent?.shared_events ? ' <span class="pm-ev">With Events</span>' : ''} <span class="pm-freq">${parent ? 'Get ready' : t.frequency === 'weekly' ? 'Every week' : FREQ_LABEL[t.frequency]}</span></b>
        ${r.timer_started_at && inNames.length ? `<span class="pm-meta pm-clocked">⏱ ${inNames.map((n) => esc(n.split(' ')[0])).join(', ')} clocked in</span>` : ''}
        <span class="pm-meta">${[parent ? `Before <b>${esc(parent.name)}</b> (starts ${dshort(addD(r.period_end, 1))})` : '', t.location ? esc(t.location) : '', dueText(r, today, t)].filter(Boolean).join(' · ')}</span>
        ${isDone ? `<span class="pm-meta pm-donewho">Done by ${esc(who[r.done_by] || 'someone')} · ${new Date(r.done_at).toLocaleDateString([], { month: 'short', day: 'numeric' })}${r.note ? ` · ${esc(r.note)}` : ''}</span>` : ''}
        ${notesBlock(t.notes, esc)}
        ${parent && parent.notes ? `<div class="pm-parentnotes"><span class="muted">Notes from ${esc(parent.name)}:</span>${notesBlock(parent.notes, esc)}</div>` : ''}
        ${ctLine(t)}
        ${notesList(pmNotes[r.id], esc, ctx.me?.()?.id, ctx.isAdmin?.())}
        ${steps.length ? `<div class="pm-steps">${steps.map((s, i) => {
          // Optional people on each step.
          const sp = ((t.step_people || {})[s] || []).map((id) => whoAll[id]).filter(Boolean);
          const spAv = sp.map((n) => `<span class="b-av" style="background:${hue(n)}" title="${esc(n)}">${esc(initials(n))}</span>`).join('');
          return `<div class="pm-step"><label><input type="checkbox" data-step="${r.id}" data-i="${i}" ${(r.steps_done || []).includes(i) ? 'checked' : ''}> ${esc(s)}</label>
            ${manage() && live ? `<button type="button" class="pm-stepwho${sp.length ? '' : ' empty'}" data-step-who="${t.id}" data-step-i="${i}" title="${sp.length ? esc(sp.join(', ')) : 'Who does this step? (optional)'}">${sp.length ? `<span class="b-avs">${spAv}</span>` : '+'}</button>`
              : sp.length ? `<span class="b-avs pm-stepwho" title="${esc(sp.join(', '))}">${spAv}</span>` : ''}</div>`;
        }).join('')}</div>` : ''}
      </div>
      <div class="pm-actions">${whoBtn}${time}${live || (pmNotes[r.id] || []).length ? noteButton('maintenance', r.id, (pmNotes[r.id] || []).length) : ''}${timerBtn}${r.status === 'open' ? `<button class="btn small" data-mark="${r.id}" data-to="skipped" title="Not needed this time">Skip</button>` : r.status === 'skipped' ? `<button class="btn small" data-mark="${r.id}" data-to="open">Undo skip</button>` : ''}</div>
    </div>`;
  }

  // ---- All tasks (the master list) ---------------------------------------
  function taskList(tasks, locations) {
    const top = tasks.filter((t) => !t.parent_id);
    const active = top.filter((t) => t.active);
    const archived = top.filter((t) => !t.active);
    const LEAD = (n) => (n % 7 === 0 ? `${n / 7} week${n === 7 ? '' : 's'}` : `${n} day${n === 1 ? '' : 's'}`);
    const prepLine = (t) => { const ps = tasks.filter((c) => c.parent_id === t.id && c.active); return ps.length ? `<span class="muted pm-prepline">Get ready: ${ps.map((c) => `${esc(c.name)} · ${LEAD(c.lead_days)} before${ctBy(c.contractor_id) ? ` · from ${esc(ctBy(c.contractor_id).name)}` : ''}`).join(' · ')}</span>` : ''; };
    const rows = (list) => `<div class="pm-tasks">${list.map((t) => `<button type="button" class="pm-task-row${t.active ? '' : ' off'}" data-pm-edit="${t.id}">
        <b>${esc(t.name)}</b><span class="muted">${FREQ_LABEL[t.frequency]} · ${windowText(t)}${(t.work_days || []).length ? ` · on ${t.work_days.map((d) => d.slice(0, 3)).join(' & ')}` : ''}${t.location ? ` · ${esc(t.location)}` : ''}${ctBy(t.contractor_id) ? ` · Contractor: ${esc(ctBy(t.contractor_id).name)}` : ''}${onIt(t).length ? ` · On it: ${onIt(t).map(esc).join(', ')}` : ''}</span>${prepLine(t)}<span class="pm-edit">Edit</span></button>`).join('')}</div>`;
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
  // Days for just this round. Resolves with the days, null (back to usual) or undefined (cancel).
  function pickRunDays(r, t) {
    return new Promise((resolve) => {
      const sel = new Set(runDays(r, t));
      const [y, m, d] = String(r.period_start).split('-').map(Number);
      const dateOf = (name) => { for (let i = 0; i < 14; i += 1) { const dt = new Date(y, m - 1, d + i); if (DOW_NAMES[dt.getDay()] === name) return dshort(isoOf(dt)); } return ''; };
      const back = document.createElement('div');
      back.className = 'modal-back';
      back.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-label="Change days">
        <h3>Change days · just this time</h3>
        <p class="muted">${esc(t.name)}. ${t.work_days?.length ? `Usually ${t.work_days.map((x) => x.slice(0, 3)).join(' & ')}.` : ''} Next round goes back to the usual days.</p>
        <div class="wk-chips">${WEEK_ORDER.map((x) => `<button type="button" class="chip-btn" data-rd="${x}">${x.slice(0, 3)} ${dateOf(x)}</button>`).join('')}</div>
        <div class="modal-actions">${r.work_days ? '<button type="button" class="btn pm-left" data-usual>Back to usual</button>' : ''}<button type="button" class="btn" data-cancel>Cancel</button><button type="button" class="btn primary" data-ok>Save</button></div></div>`;
      const draw = () => back.querySelectorAll('[data-rd]').forEach((x) => x.classList.toggle('on', sel.has(x.dataset.rd)));
      back.querySelectorAll('[data-rd]').forEach((x) => x.addEventListener('click', () => { if (sel.has(x.dataset.rd)) sel.delete(x.dataset.rd); else sel.add(x.dataset.rd); draw(); }));
      const done = (v) => { document.removeEventListener('keydown', onKey, true); back.remove(); resolve(v); };
      const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); done(undefined); } };
      document.addEventListener('keydown', onKey, true);
      back.addEventListener('mousedown', (e) => { if (e.target === back) done(undefined); });
      back.querySelector('[data-cancel]').addEventListener('click', () => done(undefined));
      back.querySelector('[data-usual]')?.addEventListener('click', () => done(null));
      back.querySelector('[data-ok]').addEventListener('click', () => { if (!sel.size) { toast('Pick at least one day', true); return; } done(WEEK_ORDER.filter((x) => sel.has(x))); });
      draw();
      document.body.appendChild(back);
    });
  }

  function pickCrew(t) {
    return new Promise((resolve) => {
      const sel = new Set(t.assignees || []);
      const back = document.createElement('div');
      back.className = 'modal-back';
      back.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-label="Who's on it">
        <h3>Who's on it?</h3><p class="muted">${esc(t.name)}</p>
        <div class="wk-chips">${crew.map((m) => `<button type="button" class="chip-btn b-pp pm-person" data-person="${m.id}"><span class="b-av" style="background:${hue(m.name)}">${esc(initials(m.name))}</span>${esc(m.name)}</button>`).join('') || '<span class="muted">No team members yet.</span>'}</div>
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
    let prepList = (t.preps || []).map((c) => ({ id: c.id, name: c.name, lead: c.lead_days || 7, vendor: c.contractor_id || null }));
    const todayIso = isoOf(new Date());
    let ctId = t.contractor_id || null;
    let people = new Set(t.assignees || []);
    let shared = !!t.shared_events;
    let wdays = new Set(t.work_days || []);
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
          <div class="pm-once"><label><span>From <span class="muted">(optional time)</span></span><select name="once_from"><option value="">Any time that day</option>${TIMES.map((v) => `<option value="${v}" ${String(t.once_from || '').slice(0, 5) === v ? 'selected' : ''}>${hm12(v)}</option>`).join('')}</select></label>
          <label><span>To</span><select name="once_to"><option value="">—</option>${TIMES.map((v) => `<option value="${v}" ${String(t.once_to || '').slice(0, 5) === v ? 'selected' : ''}>${hm12(v)}</option>`).join('')}</select></label></div>
          <p class="muted pm-once-hint">Leave the second date empty to put it on the list now. It stays on the list until it's done.</p></div>
        <div data-notonce><div class="wk-sect" data-when-title></div>
        <div class="wk-chips" data-wins></div>
        <div class="pm-custom" data-custom-row></div></div>
        <div data-workdays><div class="wk-sect">On set days <span class="muted pm-opt">(optional: tap the days it happens, like Thu &amp; Fri)</span></div>
        <div class="wk-chips">${WEEK_ORDER.map((d) => `<button type="button" class="chip-btn" data-wd="${d}">${d.slice(0, 3)}</button>`).join('')}</div></div>
        <p class="pm-preview" data-pm-preview></p>
        <div data-notonce><div class="wk-sect">Get ready first <span class="muted pm-opt">(optional: ordering parts, booking a vendor…)</span></div>
        <div class="pm-preps" data-preps></div>
        <button type="button" class="dp-link pm-prep-add" data-prep-add>+ Add a get-ready step</button></div>
        <div class="wk-sect">Who does it</div>
        <div class="wk-chips"><button type="button" class="chip-btn" data-by="team">Our team</button><button type="button" class="chip-btn" data-by="ct">A contractor we hire</button></div>
        <div class="pm-ctpick" data-ctpick></div>
        <div class="wk-sect">Who's on it <span class="muted pm-opt">(optional: tap to add or remove)</span></div>
        <div class="wk-chips" data-people>${crew.map((m) => `<button type="button" class="chip-btn b-pp pm-person" data-person="${m.id}"><span class="b-av" style="background:${hue(m.name)}">${esc(initials(m.name))}</span>${esc(m.name)}</button>`).join('') || '<span class="muted">No team members yet.</span>'}</div>
        <label class="b-tpweek pm-share"><input type="checkbox" name="shared"${t.shared_events ? ' checked' : ''}> <span><b>Partnering with Events</b> · shows on the Events site too, and Events people can be put on it</span></label>
        <div class="wk-chips" data-evpeople>${evCrew.map((m) => `<button type="button" class="chip-btn b-pp pm-person" data-person="${m.id}"><span class="b-av" style="background:${hue(m.name)}">${esc(initials(m.name))}</span>${esc(m.name)} <span class="muted">· Events</span></button>`).join('')}</div>
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
        if (freq === 'once') { $('[data-pm-preview]').textContent = windowText({ frequency: 'once', once_due: onceDue, once_start: onceStart, once_from: $('[name=once_from]').value, once_to: $('[name=once_to]').value }); return; }
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
            <select class="pm-prep-from" data-pv="${i}" aria-label="Where we get it"><option value="">Where we get it (optional)</option>${contractors.filter((x) => x.active || x.id === c.vendor).map((x) => `<option value="${x.id}" ${x.id === c.vendor ? 'selected' : ''}>From: ${esc(x.name)}${x.trade ? ` · ${esc(x.trade)}` : ''}</option>`).join('')}${ctx.isAdmin?.() ? '<option value="new">+ New place…</option>' : ''}</select>
            ${st ? `<span class="muted pm-prep-when">Next: ${dshort(addD(st, -c.lead))} – ${dshort(addD(st, -1))}, before the ${dshort(st)} round</span>` : ''}</div>`).join('');
        $('[data-preps]').querySelectorAll('[data-pn]').forEach((x) => x.addEventListener('input', () => { prepList[x.dataset.pn].name = x.value; }));
        $('[data-preps]').querySelectorAll('[data-pl]').forEach((x) => x.addEventListener('change', () => { prepList[x.dataset.pl].lead = Number(x.value); drawPreps(); }));
        $('[data-preps]').querySelectorAll('[data-pv]').forEach((x) => x.addEventListener('change', async () => {
          if (x.value === 'new') {
            const row = await ctx.contractors.editContractor({});
            if (row) { contractors = [...contractors, row].sort((a, b) => a.name.localeCompare(b.name)); prepList[x.dataset.pv].vendor = row.id; }
            drawPreps(); return;
          }
          prepList[x.dataset.pv].vendor = Number(x.value) || null;
        }));
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
      const drawPeople = () => {
        form.querySelectorAll('[data-person]').forEach((b) => b.classList.toggle('on', people.has(b.dataset.person)));
        $('[data-evpeople]').hidden = !shared || !evCrew.length;
      };
      $('[name=shared]').addEventListener('change', (e) => {
        shared = e.target.checked;
        if (!shared) evCrew.forEach((m) => people.delete(m.id));
        drawPeople();
      });
      form.querySelectorAll('[data-person]').forEach((b) => b.addEventListener('click', () => { const id = b.dataset.person; if (people.has(id)) people.delete(id); else people.add(id); drawPeople(); }));
      drawPeople();
      drawCt();
      const sync = () => {
        form.querySelectorAll('[data-parity]').forEach((b) => b.classList.toggle('on', Number(b.dataset.parity) === parity));
        form.querySelectorAll('[data-freq]').forEach((b) => b.classList.toggle('on', b.dataset.freq === freq));
        form.querySelectorAll('[data-for]').forEach((el) => { el.hidden = el.dataset.for !== freq; });
        form.querySelectorAll('[data-notonce]').forEach((el) => { el.hidden = freq === 'once'; });
        $('[data-workdays]').hidden = !['weekly', 'biweekly'].includes(freq);
        form.querySelectorAll('[data-wd]').forEach((b) => b.classList.toggle('on', wdays.has(b.dataset.wd)));
        form.querySelectorAll('[data-month]').forEach((b) => {
          const m = Number(b.dataset.month);
          b.classList.toggle('on', freq === 'quarterly' ? (m - 1) % 3 === (month - 1) % 3 : m === month);
        });
        drawWins(); preview();
      };
      form.querySelectorAll('[data-parity]').forEach((b) => b.addEventListener('click', () => { parity = Number(b.dataset.parity); sync(); }));
      $('[name=once_due]').addEventListener('change', (e) => { onceDue = e.target.value; preview(); });
      $('[name=once_start]').addEventListener('change', (e) => { onceStart = e.target.value; preview(); });
      $('[name=once_from]').addEventListener('change', () => { const a = $('[name=once_from]').value; const z = $('[name=once_to]'); if (a && (!z.value || z.value <= a)) z.value = TIMES[Math.min(TIMES.length - 1, TIMES.indexOf(a) + 2)]; preview(); });
      $('[name=once_to]').addEventListener('change', () => preview());
      $('[data-prep-add]').addEventListener('click', () => { prepList.push({ name: '', lead: 7 }); drawPreps(); $(`[data-pn="${prepList.length - 1}"]`).focus(); });
      form.querySelectorAll('[data-freq]').forEach((b) => b.addEventListener('click', () => {
        if (freq === b.dataset.freq) return;
        freq = b.dataset.freq;
        if (!winChoices().some(([k]) => k === win) && win !== 'custom') win = freq === 'biweekly' ? 'w1' : 'any';
        if (freq === 'weekly' && win === 'custom') to = '';
        sync();
      }));
      form.querySelectorAll('[data-month]').forEach((b) => b.addEventListener('click', () => { month = Number(b.dataset.month); sync(); }));
      form.querySelectorAll('[data-wd]').forEach((b) => b.addEventListener('click', () => { if (wdays.has(b.dataset.wd)) wdays.delete(b.dataset.wd); else wdays.add(b.dataset.wd); sync(); }));
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
        const oFrom = $('[name=once_from]').value || null;
        const oTo = oFrom ? ($('[name=once_to]').value || null) : null;
        if (freq === 'once' && oFrom && oTo && oTo <= oFrom) { toast('The end time has to be after the start time', true); return; }
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
          const wd = ['weekly', 'biweekly'].includes(freq) ? WEEK_ORDER.filter((d) => wdays.has(d)) : [];
          if (wd.join() !== (t.work_days || []).join()) await rpc('pm_set_work_days', { p_task: t.id || id, p_days: wd });
          if (freq === 'once' && ((oFrom || '') !== String(t.once_from || '').slice(0, 5) || (oTo || '') !== String(t.once_to || '').slice(0, 5))) await rpc('pm_set_once_time', { p_task: t.id || id, p_from: oFrom, p_to: oTo });
          const keep = prepList.filter((c) => c.name.trim());
          const newCt = byCt ? ctId : null;
          if (newCt !== (t.contractor_id || null)) await rpc('pm_set_contractor', { p_task: t.id || id, p_contractor: newCt });
          const ppl = [...people];
          if (shared !== !!t.shared_events) await rpc('pm_set_shared', { p_task: t.id || id, p_on: shared });
          if (ppl.sort().join() !== [...(t.assignees || [])].sort().join()) await rpc('pm_set_assignees', { p_task: t.id || id, p_people: ppl });
          if (freq !== 'once' && (editing || keep.length)) await rpc('pm_set_preps', { p_parent: t.id || id, p_preps: keep.map((c) => ({ id: c.id || null, name: c.name.trim(), lead_days: c.lead, vendor_id: c.vendor || null })) });
          changed = true;
          toast(editing ? 'Saved' : `Added “${name}” to the schedule`);
          if (!again) return done();
          form.reset(); $('[name=name]').value = ''; win = 'any'; prepList = []; byCt = false; ctId = null; people = new Set(); shared = false; wdays = new Set(); onceDue = ''; onceStart = ''; drawPeople(); drawCt(); sync(); $('[name=name]').focus();
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
  // Past weeks (Tuesday-Monday): what got done, who did it and how long it took,
  // what was skipped or missed, and what people got pulled to.
  async function pastWeeks(runs, taskBy, who, today) {
    const { data: pulledRows } = await sb.from('pulled_work').select('*').order('started_at', { ascending: false }).limit(1000);
    const pulled = pulledRows || [];
    const wkOf = (r) => weekStart(r.done_at ? isoOf(new Date(r.done_at)) : r.period_end);
    const fin = runs.filter((r) => taskBy[r.task_id] && (r.status !== 'open'));
    // Each person's own time (0071): per round, and per person for the week.
    const { data: sessRows } = fin.length ? await sb.from('work_sessions').select('*').eq('kind', 'maintenance').in('task_id', fin.map((r) => r.id)) : { data: [] };
    const sess = sessRows || [];
    const sSecs = (x) => Math.max(0, ((x.ended_at ? new Date(x.ended_at) : new Date()) - new Date(x.started_at)) / 1000);
    const perPerson = (list) => { const by = {}; list.forEach((x) => { by[x.member_id] = (by[x.member_id] || 0) + sSecs(x); }); return by; };
    const weeks = [...new Set([...fin.map(wkOf), ...pulled.map((p) => weekStart(p.day))])].sort().reverse();
    if (!weeks.length) return '<p class="muted">Nothing yet. Each week, what got done shows up here.</p>';
    const thisWk = weekStart(today);
    const dur = (s) => { s = Math.round(s || 0); const h = Math.floor(s / 3600); const m = Math.round((s % 3600) / 60); return h ? `${h}h ${String(m).padStart(2, '0')}m` : s ? `${m}m` : ''; };
    const label = { done: 'Done', skipped: 'Skipped', missed: 'Missed' };
    return weeks.map((w, i) => {
      const rs = fin.filter((r) => wkOf(r) === w).sort((a, b) => String(a.done_at || a.period_end).localeCompare(String(b.done_at || b.period_end)));
      const ps = pulled.filter((p) => weekStart(p.day) === w);
      const nDone = rs.filter((r) => r.status === 'done').length;
      const weekBy = perPerson(sess.filter((x) => rs.some((r) => r.id === x.task_id)));
      ps.forEach((p) => { weekBy[p.member_id] = (weekBy[p.member_id] || 0) + Math.max(0, ((p.ended_at ? new Date(p.ended_at) : new Date()) - new Date(p.started_at)) / 1000 - (p.paused_seconds || 0)); });
      const byLine = Object.entries(weekBy).filter(([, v]) => v >= 60).sort((a, b) => b[1] - a[1]).map(([id, v]) => `${esc(String(who[id] || 'Someone').split(' ')[0])} ${dur(v)}`).join(' · ');
      const time = rs.reduce((a, r) => a + (r.worked_seconds || 0), 0) + ps.reduce((a, p) => a + Math.max(0, ((p.ended_at ? new Date(p.ended_at) : new Date()) - new Date(p.started_at)) / 1000 - (p.paused_seconds || 0)), 0);
      return `<details class="b-group"${i === 0 ? ' open' : ''}><summary><span class="b-gname">Week of ${dshort(w)} – ${dshort(addD(w, 6))}${w === thisWk ? ' <span class="pill planned">This week</span>' : ''}</span>
          <span class="muted">${nDone} done${rs.length - nDone ? ` · ${rs.length - nDone} skipped/missed` : ''}${ps.length ? ` · ${ps.length} quick task${ps.length === 1 ? '' : 's'}` : ''}${time ? ` · ${dur(time)}` : ''}</span></summary>
        ${byLine ? `<p class="pw-by"><b>By person:</b> ${byLine}</p>` : ''}
        ${rs.length ? `<div class="table-wrap"><table class="b-table"><tr><th>Task</th><th>Status</th><th>Who</th><th class="num">Time</th><th>When</th><th>Note</th></tr>
          ${rs.map((r) => { const t = taskBy[r.task_id]; const par = t.parent_id ? taskBy[t.parent_id] : null;
            return `<tr><td>${esc(t.name)}${par ? ` <span class="muted">· before ${esc(par.name)}</span>` : ''}</td>
              <td><span class="pill ${r.status === 'done' ? 'available' : r.status === 'missed' ? 'lost' : 'closed'}">${label[r.status] || r.status}</span></td>
              <td>${esc(who[r.done_by] || '')}</td><td class="num">${dur(r.worked_seconds)}${(() => { const by = perPerson(sess.filter((x) => x.task_id === r.id)); const parts = Object.entries(by).filter(([, v]) => v >= 60); return parts.length ? `<br><small class="muted">${parts.map(([id, v]) => `${esc(String(who[id] || '').split(' ')[0])} ${dur(v)}`).join(', ')}</small>` : ''; })()}</td>
              <td>${r.done_at ? new Date(r.done_at).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }) : ''}</td><td>${esc(r.note || '')}</td></tr>`; }).join('')}</table></div>` : ''}
        ${ps.length ? `<h4 class="pw-h">Quick tasks</h4><div class="table-wrap"><table class="b-table"><tr><th>Who</th><th>What</th><th>Where</th><th>Day</th><th class="num">Time</th></tr>
          ${ps.map((p) => `<tr><td>${esc(who[p.member_id] || '')}</td><td>${esc(p.what)}</td><td>${esc(p.location || '')}</td><td>${new Date(`${p.day}T12:00:00`).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}</td>
            <td class="num">${dur(((p.ended_at ? new Date(p.ended_at) : new Date()) - new Date(p.started_at)) / 1000 - (p.paused_seconds || 0))}${p.ended_at ? '' : ' (still going)'}</td></tr>`).join('')}</table></div>` : ''}
      </details>`;
    }).join('');
  }

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
    bindNotes(app, { sb, toast, errMsg, esc, meId: ctx.me?.()?.id, canDeleteAll: ctx.isAdmin?.(), names: Object.fromEntries(current.map((r) => [`maintenance:${r.id}`, tasks.find((x) => x.id === r.task_id)?.name || ''])) }, reload);
    app.querySelectorAll('[data-pm-timer]').forEach((b) => b.addEventListener('click', async () => {
      try { await rpc('pm_timer', { p_run: Number(b.dataset.pmTimer), p_run_on: b.dataset.run === '1' }); reload(); } catch (err) { toast(errMsg(err), true); }
    }));
    clearInterval(pmTick);
    if (app.querySelector('[data-pm-live]')) pmTick = setInterval(() => {
      const els = app.querySelectorAll('[data-pm-live]');
      if (!els.length) { clearInterval(pmTick); return; }
      els.forEach((el) => { el.textContent = tdur(Number(el.dataset.base) + (Date.now() - Number(el.dataset.since)) / 1000); });
    }, 1000);
    // Who does a step (optional).
    app.querySelectorAll('[data-step-who]').forEach((b) => b.addEventListener('click', async () => {
      const t = tasks.find((x) => x.id === Number(b.dataset.stepWho));
      const step = (t?.steps || [])[Number(b.dataset.stepI)];
      if (!step) return;
      const ppl = await pickCrew({ name: `${step} · ${t.name}`, assignees: (t.step_people || {})[step] || [] });
      if (!ppl) return;
      try { await rpc('pm_set_step_people', { p_task: t.id, p_step: step, p_people: ppl }); toast(ppl.length ? `${step}: ${ppl.map((id) => whoAll[id]).join(', ')}` : `Nobody on ${step}`); reload(); } catch (err) { toast(errMsg(err), true); }
    }));
    // Move one round to other days (just this time).
    app.querySelectorAll('[data-pm-rundays]').forEach((b) => b.addEventListener('click', async () => {
      const r = allRuns.find((x) => x.id === Number(b.dataset.pmRundays));
      const t = r && tasks.find((x) => x.id === r.task_id);
      if (!t) return;
      const pick = await pickRunDays(r, t);
      if (pick === undefined) return;
      try { await rpc('pm_set_run_days', { p_run: r.id, p_days: pick }); toast(pick ? `This time: ${pick.map((d) => d.slice(0, 3)).join(' & ')}` : 'Back to the usual days'); reload(); } catch (err) { toast(errMsg(err), true); }
    }));
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

// Facility boards: Maintenance Requests and the Custodial Weekly Checklist.
// Rebuilt from the monday.com boards: same groups, columns, status labels and
// automations (the automations run in the database, see 0027_facility_boards.sql).

export const REQ_STATUSES = ['New', 'In Progress', 'Scheduled', 'Needs Scheduled', 'Needs Ordered', 'Ordered', 'Paused',
  'Project', 'Needs Onsite Visit', 'Waiting for Approval', 'Executive', 'Complete', 'Declined'];
export const REQ_GROUPS = [
  ['new', 'New ticket'], ['in_progress', 'In Progress'], ['pending_reply', 'Pending Reply'],
  ['executive', 'Executive Requests'], ['solved', 'Ticket solved - user notified'],
];
import { loadNotes, notesList, noteButton, bindNotes } from './notes.js?v=__V__';

const SUB_STATUSES = ['Working on it', 'Done', 'Stuck'];
const CHECK_STATUSES = ['Not started', 'Working on it', 'Done', 'Skipped', 'Missed'];
// The Facilities week runs Tuesday to Monday.
const DAYS = ['Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday', 'Monday', 'Detail Work'];
const AREAS = ['Building', 'Offices', 'Sign-off'];
const SUPPORT_TEAMS = ['Maintenance', 'Custodial/Cleaning', 'Warehouse (Old Foodbank Area)', 'Operational Support (Storage, Furniture, Ops Team Project)'];
const PRIORITIES = ['Emergency (<1 hour)', 'Priority (<3 business days)', 'Specific Due Date needed'];
const CAMPUSES = ['MC Fort Worth', 'MC East Fort Worth', 'MC Dallas', 'MC Online', 'MC Espanol', 'HV - MC Prep', 'HV- MC Media', 'HV- PDN',
  'HV- For Liberty & Justice', 'HV- Citizens for Life', 'HV - Spiritual Leadership School', 'HV- 33rd Company', 'HV- MC Worship'];
const STAFF_TYPES = ['Staff/Contractor/Intern', 'Serve Team'];
const REQ_CATEGORIES = ['Handyman Tasks', 'Painting Requests', 'Plumbing Issues', 'Electrical and Security', 'Flooring and Cleaning', 'Landscaping', 'Cleaning'];
const MAINT_NEEDS = ['Handyman', 'Painting', 'Plumbing', 'AC', 'Lights', 'Electrical', 'Outside Work', 'Flooring', 'Doors', 'Sheetrock',
  'Emergency (Gas leak, break, Danger, Immediate threat)', 'Project (Larger, more time consuming needs, renovations, builds, etc.)', 'Property Attention (Not church campus)'];
const CUSTODIAL_NEEDS = ['Custodial/Cleaning Issue', 'Emergency (Leak, Danger, Immediate threat)'];
const REPEAT = ['No- New Request', 'Yes- Follow-up on existing request'];

const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dshort = (d) => { if (!d) return ''; const [y, m, dd] = String(d).slice(0, 10).split('-'); return `${MON[+m - 1]} ${+dd}${y !== String(new Date().getFullYear()) ? `, ${y}` : ''}`; };
const tshort = (ts) => ts ? new Date(ts).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
const localToday = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const dayDiff = (a, b) => Math.round((new Date(`${a}T12:00:00`) - new Date(`${b}T12:00:00`)) / 864e5);
function dur(sec) {
  sec = Math.max(0, Math.round(sec || 0));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
  if (h >= 24) return `${Math.floor(h / 24)}d ${h % 24}h`;
  if (h) return `${h}h ${String(m).padStart(2, '0')}m`;
  if (m) return `${m}m`;
  return sec ? `${sec}s` : '0m';
}
const liveSecs = (r) => (r.worked_seconds || 0) + (r.timer_started_at ? (Date.now() - new Date(r.timer_started_at)) / 1000 : 0);
const PALETTE = ['#11404b', '#2d6a62', '#6a4cf0', '#a8752a', '#b04437', '#2f5d8a', '#3f7a5a', '#8a6630', '#5a5fa8', '#6b6b6b'];
const hue = (s) => PALETTE[[...String(s)].reduce((a, c) => a + c.charCodeAt(0), 0) % PALETTE.length];
const initials = (n) => String(n).replace(/@.*/, '').split(/[\s.]+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
const shortName = (n) => String(n || '').replace(/@.*/, '').replace(/\./g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

// Monthly Custodial tasks: which week of the month (the 1st..4th <day>, or the last one). Mirrors checklist_month_week (0064).
const hm12 = (v) => { if (!v) return ''; const [h, m] = String(v).split(':').map(Number); return `${h % 12 || 12}${m ? `:${String(m).padStart(2, '0')}` : ''} ${h < 12 ? 'AM' : 'PM'}`; };
const slotOf = (t) => (t && t.once_from ? `${hm12(t.once_from)}${t.once_to ? `–${hm12(t.once_to)}` : ''}` : '');
const TIMES = Array.from({ length: 33 }, (_, i) => { const mins = 6 * 60 + i * 30; return `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`; });
const isoDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const dayNameOf = (iso) => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'long' }); };
const addIso = (iso, n) => { const [y, m, d] = iso.split('-').map(Number); return isoDay(new Date(y, m - 1, d + n)); };
const MONTH_WEEKS = [[1, '1st'], [2, '2nd'], [3, '3rd'], [4, '4th'], [5, 'Last']];
const ordOf = (n) => (MONTH_WEEKS.find(([k]) => k === (n || 1)) || MONTH_WEEKS[0])[1];
function monthHit(week, day, n) {
  const DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const [y, m, d0] = String(week).split('-').map(Number);
  const i = DOW.indexOf(day);
  const d = new Date(y, m - 1, d0 + (i < 0 ? 4 : (i + 5) % 7));   // weeks start Tuesday
  if ((n || 1) >= 5) return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 7).getMonth() !== d.getMonth();
  return d.getDate() > ((n || 1) - 1) * 7 && d.getDate() <= (n || 1) * 7;
}

export function boardPages(ctx) {
  const { sb, q, rpc, esc, toast, askText, askConfirm, errMsg, pageHead, route, canEdit, isAdmin, me, pulled } = ctx;
  const app = document.getElementById('app');
  let tick = null;
  let ckNotes = {};   // notes on this week's tasks, by task id
  const startTick = () => {
    clearInterval(tick);
    tick = setInterval(() => {
      if (!document.body.contains(app.querySelector('[data-live]'))) { clearInterval(tick); return; }
      app.querySelectorAll('[data-live]').forEach((el) => {
        el.textContent = dur(Number(el.dataset.base) + (Date.now() - Number(el.dataset.since)) / 1000);
      });
    }, 1000);
  };
  const liveSpan = (r) => r.timer_started_at
    ? `<span class="b-live" data-live data-base="${r.worked_seconds || 0}" data-since="${new Date(r.timer_started_at).getTime()}">${dur(liveSecs(r))}</span>`
    : `<span>${r.worked_seconds ? dur(r.worked_seconds) : ''}</span>`;
  const avatars = (names, max = 3) => {
    const list = (names || []).filter(Boolean);
    if (!list.length) return '<span class="muted">–</span>';
    return `<span class="b-avs">${list.slice(0, max).map((n) => `<span class="b-av" style="background:${hue(n)}" title="${esc(shortName(n))}">${esc(initials(n))}</span>`).join('')}${list.length > max ? `<span class="b-av more">+${list.length - max}</span>` : ''}</span>`;
  };
  const statusSel = (kind, id, value, list, extra = '') => `<select class="b-status s-${slug(value || 'none')}" data-${kind}="${id}" aria-label="Status"${canEdit() ? '' : ' disabled'} ${extra}>
      ${value ? '' : '<option value="">–</option>'}${list.map((s) => `<option${s === value ? ' selected' : ''}>${esc(s)}</option>`).join('')}</select>`;
  const opts = (list, value, blank = '–') => `<option value="">${blank}</option>${[...new Set([...(value && !list.includes(value) ? [value] : []), ...list])].map((v) => `<option${v === value ? ' selected' : ''}>${esc(v)}</option>`).join('')}`;
  const seg = (base, cur, list) => `<div class="seg b-seg">${list.map(([k, t]) => `<a href="${base}${k === list[0][0] ? '' : `/${k}`}" class="${cur === k ? 'on' : ''}">${t}</a>`).join('')}</div>`;
  const recolor = (sel) => { sel.className = sel.className.replace(/\bs-[\w-]+/, `s-${slug(sel.value || 'none')}`); };

  // -------------------------------------------------------------------------
  // Maintenance Requests
  // -------------------------------------------------------------------------
  // Kept simple on purpose: one list of what's open, one tap to start or finish.
  // Monday's other views (status board, dashboard, Gantt) sit under "More views".
  let search = '';
  let statusPick = '';
  const MORE_VIEWS = [['dashboard', 'Dashboard'], ['timeline', 'Gantt']];

  async function renderRequests(view = 'board') {
    const [rows, ups] = await Promise.all([
      q(sb.from('maint_requests').select('id, subject, status, board_group, requester_name, campus, support_team, priority, experts, location, due_date, completion_date, created_at, request_category, worked_seconds, timer_started_at, department').order('created_at', { ascending: false })),
      q(sb.from('maint_updates').select('request_id').eq('kind', 'update')),
    ]);
    const nUp = {};
    ups.forEach((u) => { nUp[u.request_id] = (nUp[u.request_id] || 0) + 1; });
    const match = (r) => (!statusPick || r.status === statusPick) && (!search || [r.subject, r.requester_name, r.location, r.campus, r.request_category, ...(r.experts || [])].join(' ').toLowerCase().includes(search.toLowerCase()));
    const list = rows.filter(match);
    const open = rows.filter((r) => r.board_group !== 'solved');
    const tabs = [['board', `Status board <b>${open.length}</b>`], ['open', 'List'], ['solved', `Done <b>${rows.length - open.length}</b>`], ...MORE_VIEWS];

    app.innerHTML = `
      <header class="page-head b-simplehead"><h1>Requests</h1>
        ${canEdit() ? '<a class="btn primary b-big" href="#/request/new">+ New request</a>' : ''}</header>
      <div class="b-bar">
        <div class="seg b-seg">${tabs.map(([k, t]) => `<a href="#/requests${k === 'board' ? '' : `/${k}`}" class="${view === k ? 'on' : ''}">${t}</a>`).join('')}</div>
        <select id="b-status" aria-label="Filter by status"><option value="">All statuses</option>${REQ_STATUSES.map((st) => {
          const n = rows.filter((r) => r.status === st).length;
          return n || st === statusPick ? `<option value="${esc(st)}" ${st === statusPick ? 'selected' : ''}>${esc(st)} (${n})</option>` : '';
        }).join('')}</select>
        <input id="b-q" type="search" placeholder="Search" value="${esc(search)}" aria-label="Search requests">
      </div>
      ${statusPick ? `<p class="b-filtered">Showing only <b>${esc(statusPick)}</b>. <a href="#" id="b-clear">Show all</a></p>` : ''}
      <div id="b-view">${view === 'board' ? reqBoard(list) : view === 'dashboard' ? reqDashboard(list) : view === 'timeline' ? reqTimeline(list)
        : view === 'solved' ? reqList(list.filter((r) => r.board_group === 'solved').sort((a, b) => String(b.completion_date || b.created_at).localeCompare(String(a.completion_date || a.created_at))), nUp, true)
        : reqGroups(list, nUp)}</div>`;

    const rerender = () => renderRequests(view);
    let typing;
    app.querySelector('#b-q').addEventListener('input', (e) => { clearTimeout(typing); typing = setTimeout(() => { search = e.target.value; rerender().then(() => { const i = app.querySelector('#b-q'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }); }, 250); });
    app.querySelector('#b-status').addEventListener('change', (e) => { statusPick = e.target.value; rerender(); });
    app.querySelector('#b-clear')?.addEventListener('click', (e) => { e.preventDefault(); statusPick = ''; rerender(); });
    bindReqStatus(rerender);
    app.querySelectorAll('[data-go]').forEach((el) => el.addEventListener('click', (e) => {
      if (e.target.closest('select, a, button, input')) return;
      location.hash = `#/request/${el.dataset.go}`;
    }));
    if (view === 'board') bindDrag(rerender);
    startTick();
  }

  function bindReqStatus(after) {
    const set = async (id, status) => {
      try {
        await q(sb.from('maint_requests').update({ status }).eq('id', id).select('id'));
        toast(status === 'Complete' ? 'Done. Moved to solved and the requester is told.' : status === 'In Progress' ? 'Started. The timer is running.' : `Status: ${status}`);
      } catch (err) { toast(errMsg(err), true); }
      after();
    };
    app.querySelectorAll('select[data-req]').forEach((s) => s.addEventListener('change', () => { recolor(s); set(s.dataset.req, s.value); }));
    app.querySelectorAll('[data-setstatus]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); set(b.dataset.id, b.dataset.setstatus); }));
  }

  // One row: what, where, who, and the one next step.
  function reqItem(r, nUp, solved = false) {
    const today = localToday();
    const late = r.due_date && !solved && r.due_date < today;
    const next = !canEdit() || solved ? '' : r.status === 'In Progress'
      ? `<button class="btn small b-done" data-setstatus="Complete" data-id="${r.id}">✓ Done</button>`
      : `<button class="btn small" data-setstatus="In Progress" data-id="${r.id}">Start</button>`;
    return `<div class="b-item" data-go="${r.id}">
      <div class="b-itemmain">
        <b>${esc(r.subject)}</b>
        <span class="b-itemsub">${[r.location, r.campus && r.campus !== 'MC Fort Worth' ? r.campus : '', r.requester_name ? `from ${r.requester_name}` : ''].filter(Boolean).map(esc).join(' · ')}</span>
        <span class="b-itemtags">
          <span class="b-pill s-${slug(r.status)}">${esc(r.status)}</span>
          ${r.priority && /Emergency/.test(r.priority) ? '<span class="b-pill s-declined">Emergency</span>' : ''}
          ${late ? `<span class="b-late">Due ${dshort(r.due_date)}</span>` : r.due_date && !solved ? `<span class="muted">Due ${dshort(r.due_date)}</span>` : ''}
          ${solved && r.completion_date ? `<span class="muted">Done ${dshort(r.completion_date)}</span>` : ''}
          ${r.timer_started_at ? `<span class="muted">Timer ${liveSpan(r)}</span>` : ''}
          ${nUp[r.id] ? `<span class="muted">${nUp[r.id]} ${nUp[r.id] === 1 ? 'note' : 'notes'}</span>` : ''}
        </span>
      </div>
      <span class="b-itemwho">${avatars(r.experts, 2)}</span>
      ${next}
    </div>`;
  }
  function reqList(rows, nUp, solved = false) {
    if (!rows.length) return `<p class="muted b-emptybig">${search || statusPick ? 'Nothing matches that filter.' : solved ? 'Nothing finished yet.' : 'Nothing open. Nice.'}</p>`;
    return `<div class="b-items">${rows.map((r) => reqItem(r, nUp, solved)).join('')}</div>`;
  }
  // Open tickets in Monday's groups (New ticket, In Progress, Pending Reply, Executive).
  function reqGroups(list, nUp) {
    const groups = REQ_GROUPS.filter(([g]) => g !== 'solved').map(([g, name]) => [name, list.filter((r) => r.board_group === g)]).filter(([, rs]) => rs.length);
    if (!groups.length) return reqList([], nUp);
    return groups.map(([name, rs]) => `<h2 class="b-sect">${esc(name)} <span class="muted">${rs.length}</span></h2>${reqList(rs, nUp)}`).join('');
  }

  function reqBoard(list) {
    const cols = REQ_STATUSES.filter((s) => s !== 'Complete' && s !== 'Declined');
    const open = list.filter((r) => r.board_group !== 'solved');
    return `<p class="muted b-note">Open tickets by status. ${canEdit() ? 'Drag a card to another column to change its status.' : ''}</p>
      <div class="b-kanban">${cols.map((s) => {
        const items = open.filter((r) => r.status === s);
        return `<div class="b-col" data-col="${esc(s)}"><div class="b-colh"><span class="b-pill s-${slug(s)}">${esc(s)}</span><span class="muted">${items.length}</span></div>
          ${items.map((r) => `<div class="b-card" data-go="${r.id}" ${canEdit() ? `draggable="true" data-drag="${r.id}"` : ''}>
            <b>${esc(r.subject)}</b><div class="b-meta">${avatars(r.experts, 2)}${r.due_date ? `<span>${dshort(r.due_date)}</span>` : ''}${r.campus ? `<span class="muted">${esc(r.campus)}</span>` : ''}</div></div>`).join('')}</div>`;
      }).join('')}</div>`;
  }
  function bindDrag(after) {
    let dragId = null;
    app.querySelectorAll('[data-drag]').forEach((c) => {
      c.addEventListener('dragstart', (e) => { dragId = c.dataset.drag; c.classList.add('dragging'); e.dataTransfer.setData('text/plain', dragId); });
      c.addEventListener('dragend', () => { c.classList.remove('dragging'); app.querySelectorAll('.b-col.over').forEach((x) => x.classList.remove('over')); });
    });
    app.querySelectorAll('.b-col').forEach((col) => {
      col.addEventListener('dragover', (e) => { if (!dragId) return; e.preventDefault(); col.classList.add('over'); });
      col.addEventListener('dragleave', () => col.classList.remove('over'));
      col.addEventListener('drop', async (e) => {
        e.preventDefault(); const id = dragId; dragId = null; col.classList.remove('over');
        try { await q(sb.from('maint_requests').update({ status: col.dataset.col }).eq('id', id).select('id')); toast(`Status: ${col.dataset.col}`); } catch (err) { toast(errMsg(err), true); }
        after();
      });
    });
  }
  function barList(title, counts, total) {
    const rows = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 8);
    const max = Math.max(1, ...rows.map((r) => r[1]));
    return `<div class="card b-dash-card"><h2>${title}</h2>${rows.length ? rows.map(([k, v]) => `<div class="b-barrow"><span class="b-barlabel">${esc(k)}</span><span class="b-meter"><i style="width:${(v / max) * 100}%"></i></span><span class="num">${v}</span></div>`).join('') : '<p class="muted">No data.</p>'}${total ? `<p class="muted b-small">${total}</p>` : ''}</div>`;
  }
  function reqDashboard(list) {
    const count = (fn, rows = list) => rows.reduce((m, r) => { const k = fn(r); if (k) m[k] = (m[k] || 0) + 1; return m; }, {});
    const open = list.filter((r) => r.board_group !== 'solved');
    const today = localToday();
    const solved30 = list.filter((r) => r.completion_date && dayDiff(today, r.completion_date) <= 30).length;
    const timed = list.filter((r) => r.board_group === 'solved' && r.worked_seconds > 0);
    const avg = timed.length ? timed.reduce((a, r) => a + r.worked_seconds, 0) / timed.length : 0;
    const late = open.filter((r) => r.due_date && r.due_date < today).length;
    const experts = {};
    open.forEach((r) => (r.experts || []).forEach((e) => { const n = shortName(e); experts[n] = (experts[n] || 0) + 1; }));
    return `<div class="stats">
        <div class="stat"><b>${open.length}</b><span>Open tickets</span></div>
        <div class="stat"><b>${list.filter((r) => r.board_group === 'new').length}</b><span>New, not started</span></div>
        <div class="stat"><b>${late}</b><span>Past their due date</span></div>
        <div class="stat"><b>${solved30}</b><span>Solved in the last 30 days</span></div>
        <div class="stat"><b>${dur(avg)}</b><span>Average time to resolve</span></div>
      </div>
      <div class="b-dash">
        ${barList('Open by status', count((r) => r.status, open))}
        ${barList('Open by category expert', experts)}
        ${barList('All by request category', count((r) => r.request_category || 'Not categorized'))}
        ${barList('All by campus', count((r) => r.campus))}
        ${barList('All by support team', count((r) => r.support_team))}
        ${barList('All by department', count((r) => r.department))}
      </div>`;
  }
  function reqTimeline(list) {
    const rows = list.filter((r) => r.board_group !== 'solved').map((r) => ({ ...r, start: (r.created_at || '').slice(0, 10), end: r.due_date || null }))
      .filter((r) => r.start).sort((a, b) => (a.end || '9').localeCompare(b.end || '9'));
    if (!rows.length) return '<p class="muted">No open tickets.</p>';
    const today = localToday();
    const from = rows.reduce((m, r) => (r.start < m ? r.start : m), today);
    const fromD = new Date(`${from}T12:00:00`); fromD.setDate(fromD.getDate() - fromD.getDay());
    const from0 = fromD.toISOString().slice(0, 10);
    const lastEnd = rows.reduce((m, r) => ((r.end || today) > m ? (r.end || today) : m), today);
    const weeks = Math.min(60, Math.ceil((dayDiff(lastEnd, from0) + 8) / 7));
    const W = 14;
    const x = (d) => dayDiff(d, from0) * W;
    const head = Array.from({ length: weeks }, (_, i) => { const d = new Date(`${from0}T12:00:00`); d.setDate(d.getDate() + i * 7); return `<span style="width:${7 * W}px">${MON[d.getMonth()]} ${d.getDate()}</span>`; }).join('');
    return `<p class="muted b-note">Open tickets from the day they came in to their due date. Striped bars have no due date yet. The red line is today.</p>
      <div class="table-wrap b-gantt"><div class="b-grow b-ghead"><div class="b-gname">Request</div><div class="b-gweeks">${head}</div></div>
      ${rows.map((r) => `<div class="b-grow" data-go="${r.id}"><div class="b-gname">${esc(r.subject)}</div><div class="b-gtrack" style="width:${weeks * 7 * W}px">
        <i class="b-gtoday" style="left:${x(today)}px"></i>
        <span class="b-gbar s-${slug(r.status)}${r.end ? '' : ' nodue'}" style="left:${x(r.start)}px;width:${Math.max(W, x(r.end || today) - x(r.start) + W)}px" title="${esc(r.status)}">${esc(r.status)}</span></div></div>`).join('')}
      </div>`;
  }

  // ----- one request --------------------------------------------------------
  // Top: what it is and the next step as big buttons. Then the notes thread.
  // Every other Monday column lives under "More details".
  async function renderRequest(id) {
    if (id === 'new') return renderNewRequest();
    const [rows, subs, ups, times] = await Promise.all([
      q(sb.from('maint_requests').select('*').eq('id', id)),
      q(sb.from('maint_subtasks').select('*').eq('request_id', id).order('sort').order('id')),
      q(sb.from('maint_updates').select('*').eq('request_id', id).order('created_at')),
      q(sb.from('maint_time').select('*').eq('request_id', id).order('started_at', { ascending: false })),
    ]);
    const r = rows[0];
    if (!r) { app.innerHTML = '<div class="card"><b>Request not found.</b> <a href="#/requests">Back to requests</a></div>'; return; }
    const ed = canEdit();
    const solved = r.board_group === 'solved';
    const top = ups.filter((u) => !u.parent_id).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    const replies = (pid) => ups.filter((u) => u.parent_id === pid);
    const upHtml = (u, reply = false) => `<div class="b-up k-${u.kind}${reply ? ' reply' : ''}">
        ${u.kind === 'update' ? `<span class="b-av" style="background:${hue(u.author)}">${esc(initials(u.author))}</span>` : `<span class="b-av icon">${u.kind === 'email' ? '@' : '↻'}</span>`}
        <div class="b-upbody"><div class="b-uphead"><b>${esc(u.kind === 'update' ? u.author : u.kind === 'email' ? 'Email to requester' : u.author)}</b><span class="muted">${tshort(u.created_at)}</span></div>
        <div class="b-uptext">${esc(u.body).replace(/@([A-Z][\w.]+(?: [A-Z][\w]+)?)/g, '<span class="accent">@$1</span>')}</div>
        ${!reply && u.kind === 'update' ? replies(u.id).map((x) => upHtml(x, true)).join('') : ''}</div></div>`;
    const needs = r.needs || {};
    const extra = r.extra || {};
    const field = (label, name, val, type = 'text') => `<label>${label}<input name="${name}" type="${type}" value="${esc(val ?? '')}"${ed ? '' : ' disabled'}></label>`;
    const pick = (label, name, list, val) => `<label>${label}<select name="${name}"${ed ? '' : ' disabled'}>${opts(list, val)}</select></label>`;
    const facts = [
      ['Where', r.location], ['Asked by', [r.requester_name, r.campus].filter(Boolean).join(', ')],
      ['Handled by', (r.experts || []).map(shortName).join(', ')], ['Due', dshort(r.due_date)],
      ['Time spent', r.timer_started_at || r.worked_seconds ? liveSpan(r) : ''],
    ].filter(([, v]) => v);
    const doneSubs = subs.filter((s) => s.status === 'Done').length;
    const what = r.details || r.task_description || '';
    const addStep = '<form id="r-addsub" class="b-inline"><input name="name" placeholder="Add a step, e.g. Order parts" required aria-label="New step"><button class="btn">Add</button></form>';

    app.innerHTML = `
      <p><a href="#/requests">← Requests</a></p>
      <header class="page-head b-head">
        <span class="b-pill s-${slug(r.status)}">${esc(r.status)}</span>
        <h1>${esc(r.subject)}</h1>
        <dl class="b-facts">${facts.map(([k, v]) => `<div><dt>${k}</dt><dd>${k === 'Time spent' ? v : esc(v)}</dd></div>`).join('')}</dl>
      </header>
      ${ed ? `<div class="b-actions">
        ${solved ? `<button class="btn b-big" data-setstatus="New" data-id="${r.id}">Reopen</button>`
          : `${r.status !== 'In Progress' ? `<button class="btn b-big" data-setstatus="In Progress" data-id="${r.id}">▶ Start</button>` : ''}
             <button class="btn primary b-big b-done" data-setstatus="Complete" data-id="${r.id}">✓ Done</button>`}
        <label class="b-other">Other status ${statusSel('req', r.id, r.status, REQ_STATUSES)}</label>
      </div>` : ''}
      ${what && what.trim().toLowerCase() !== r.subject.trim().toLowerCase() ? `<div class="card b-box b-what"><p class="b-pre">${esc(what)}</p></div>` : ''}
      ${subs.length ? `<div class="card b-box"><h2>Steps ${subs.length ? `<span class="muted">${doneSubs}/${subs.length}</span>` : ''}</h2>
        <div class="b-steps">${subs.map((s) => `<label class="b-step${s.status === 'Done' ? ' done' : ''}"><input type="checkbox" data-step="${s.id}"${s.status === 'Done' ? ' checked' : ''}${ed ? '' : ' disabled'}>
          <span>${esc(s.name)}${s.owner ? ` <span class="muted">· ${esc(shortName(s.owner))}</span>` : ''}</span>
          ${ed ? `<button type="button" class="b-x" data-subdel="${s.id}" aria-label="Remove step">×</button>` : ''}</label>`).join('')}</div>
        ${ed ? addStep : ''}
      </div>` : ''}
      <div class="card b-box"><h2>Notes</h2>
        ${ed ? '<form id="r-addup" class="b-upform"><textarea name="body" rows="2" placeholder="Add a note or photo link. Type @ and a name to tag someone." required></textarea><button class="btn primary">Post</button></form>' : ''}
        <div class="b-ups">${top.length ? top.map((u) => upHtml(u)).join('') : '<p class="muted">No notes yet.</p>'}</div>
        ${!subs.length && ed ? `<details class="b-addstep"><summary>+ Break it into steps</summary>${addStep}</details>` : ''}
      </div>
      <details class="card b-box b-moredetails"><summary><span>More details</span><small class="muted">Requester, campus, cost, links and more</small></summary>
        ${ed ? `<div class="b-headrow">
          ${r.requester_email ? '<button class="btn small" id="r-reply">Reply to requester</button>' : ''}
          <button class="btn small" id="r-timer">${r.timer_started_at ? 'Stop timer' : 'Start timer'}</button>
          <button class="btn small" id="r-rename">Rename</button>
          ${isAdmin() ? '<button class="btn small bad" id="r-delete">Delete</button>' : ''}</div>` : ''}
        <form class="b-fields" id="r-fields">
          ${pick('Support team', 'support_team', SUPPORT_TEAMS, r.support_team)}
          ${pick('Priority', 'priority', PRIORITIES, r.priority)}
          ${field('Category expert (comma between names)', 'experts', (r.experts || []).join(', '))}
          ${field('Location in building or on property', 'location', r.location)}
          ${field('Due date', 'due_date', r.due_date, 'date')}
          ${pick('Request category', 'request_category', REQ_CATEGORIES, r.request_category)}
          ${pick('Maintenance need', 'need_Maintenance', MAINT_NEEDS, needs.Maintenance)}
          ${pick('Custodial need', 'need_Custodial', CUSTODIAL_NEEDS, needs.Custodial)}
          ${field('Completion date', 'completion_date', r.completion_date, 'date')}
          ${field('Cost ($)', 'cost', r.cost, 'number')}
          ${pick('New or repeat request', 'repeat_request', REPEAT, r.repeat_request)}
          ${field('First & last name', 'requester_name', r.requester_name)}
          ${field('Email', 'requester_email', r.requester_email, 'email')}
          ${field('Phone', 'requester_phone', r.requester_phone, 'tel')}
          ${pick('Campus/Org', 'campus', CAMPUSES, r.campus)}
          ${field('Department/Division', 'department', r.department)}
          ${pick('Staff type', 'staff_type', STAFF_TYPES, r.staff_type)}
          ${field('Oversight', 'oversight', r.oversight)}
          <label class="b-wide">Notes field<textarea name="notes" rows="2"${ed ? '' : ' disabled'}>${esc(r.notes || '')}</textarea></label>
          ${ed ? '<div class="b-wide"><button class="btn primary">Save details</button></div>' : ''}
        </form>
        ${r.task_description && r.details && r.task_description !== r.details ? `<p class="b-small"><b>Maintenance task description</b><br>${esc(r.task_description)}</p>` : ''}
        ${r.progress_summary ? `<p class="b-small"><b>Progress summary</b><br>${esc(r.progress_summary)}</p>` : ''}
        ${r.access_reason ? `<p class="b-small"><b>Why is this access needed?</b><br>${esc(r.access_reason)}</p>` : ''}
        ${Object.entries(extra).map(([k, v]) => `<p class="b-small"><b>${esc(k)}</b><br>${/^https?:/.test(v) ? `<a href="${esc(v)}" target="_blank" rel="noopener">Open</a>` : esc(v)}</p>`).join('')}
        ${times.length ? `<p class="b-small"><b>Time log</b></p><ul class="log">${times.map((t) => `<li><b>${dur((new Date(t.ended_at) - new Date(t.started_at)) / 1000)}</b> · ${esc(t.started_by || '')} <span class="muted">${tshort(t.started_at)}</span></li>`).join('')}</ul>` : ''}
        <p class="b-small muted">Added by ${esc(r.created_by_name || 'unknown')} ${tshort(r.created_at)}</p>
      </details>`;

    const reload = () => renderRequest(id);
    bindReqStatus(reload);
    app.querySelectorAll('input[data-step]').forEach((c) => c.addEventListener('change', async () => {
      c.closest('label').classList.toggle('done', c.checked);
      try { await q(sb.from('maint_subtasks').update({ status: c.checked ? 'Done' : null }).eq('id', c.dataset.step).select('id')); } catch (err) { toast(errMsg(err), true); reload(); }
    }));
    app.querySelector('#r-timer')?.addEventListener('click', async () => {
      try { await rpc('maint_timer', { p_id: r.id, p_run: !r.timer_started_at }); toast(r.timer_started_at ? 'Timer stopped' : 'Timer started'); reload(); } catch (err) { toast(errMsg(err), true); }
    });
    app.querySelector('#r-rename')?.addEventListener('click', async () => {
      const name = await askText('Rename request', { value: r.subject, ok: 'Rename' });
      if (!name || name === r.subject) return;
      try { await q(sb.from('maint_requests').update({ subject: name }).eq('id', r.id).select('id')); reload(); } catch (err) { toast(errMsg(err), true); }
    });
    app.querySelector('#r-reply')?.addEventListener('click', async () => {
      const msg = await askText(`Reply to ${r.requester_email}`, { placeholder: 'e.g. We’ll be out Thursday morning to fix it.', ok: 'Save reply', message: 'Saved on the request. Email sending gets switched on before launch.' });
      if (!msg) return;
      try { await rpc('maint_send_reply', { p_id: r.id, p_message: msg }); toast('Reply saved on the request'); reload(); } catch (err) { toast(errMsg(err), true); }
    });
    app.querySelector('#r-delete')?.addEventListener('click', async () => {
      if (!(await askConfirm(`Delete "${r.subject}"?`, { message: 'Its steps, notes and time log go too. This can’t be undone.', ok: 'Delete', danger: true }))) return;
      try { await q(sb.from('maint_requests').delete().eq('id', r.id).select('id')); toast('Deleted'); location.hash = '#/requests'; } catch (err) { toast(errMsg(err), true); }
    });
    app.querySelector('#r-addsub')?.addEventListener('submit', async (e) => {
      e.preventDefault(); const f = new FormData(e.target);
      try { await q(sb.from('maint_subtasks').insert({ request_id: r.id, name: f.get('name').trim(), sort: subs.length }).select('id')); reload(); } catch (err) { toast(errMsg(err), true); }
    });
    app.querySelectorAll('[data-subdel]').forEach((b) => b.addEventListener('click', async (e) => {
      e.preventDefault();
      try { await q(sb.from('maint_subtasks').delete().eq('id', b.dataset.subdel).select('id')); reload(); } catch (err) { toast(errMsg(err), true); }
    }));
    app.querySelector('#r-addup')?.addEventListener('submit', async (e) => {
      e.preventDefault(); const body = new FormData(e.target).get('body').trim(); if (!body) return;
      try { await q(sb.from('maint_updates').insert({ request_id: r.id, author: me()?.name || 'Unknown', body }).select('id')); toast('Note posted'); reload(); } catch (err) { toast(errMsg(err), true); }
    });
    app.querySelector('#r-fields')?.addEventListener('submit', async (e) => {
      e.preventDefault(); const f = new FormData(e.target); const v = (k) => (f.get(k) || '').toString().trim() || null;
      const nextNeeds = { ...needs };
      ['Maintenance', 'Custodial'].forEach((k) => { if (v(`need_${k}`)) nextNeeds[k] = v(`need_${k}`); else delete nextNeeds[k]; });
      const patch = {
        support_team: v('support_team'), priority: v('priority'), location: v('location'), request_category: v('request_category'),
        experts: (v('experts') || '').split(',').map((x) => x.trim()).filter(Boolean), needs: nextNeeds,
        due_date: v('due_date'), completion_date: v('completion_date'), cost: v('cost') == null ? null : Number(v('cost')),
        repeat_request: v('repeat_request'), notes: v('notes'), requester_name: v('requester_name'), requester_email: v('requester_email'),
        requester_phone: v('requester_phone'), campus: v('campus'), department: v('department'), staff_type: v('staff_type'), oversight: v('oversight'),
      };
      try { await q(sb.from('maint_requests').update(patch).eq('id', r.id).select('id')); toast('Saved'); reload(); } catch (err) { toast(errMsg(err), true); }
    });
    startTick();
  }

  // New request: three questions. Name and email come from the login.
  function renderNewRequest() {
    if (!canEdit()) { location.hash = '#/requests'; return; }
    const chips = (name, list, first) => `<div class="b-chips">${list.map(([v, t], i) => `<label class="chip"><input type="radio" name="${name}" value="${esc(v)}"${i === first ? ' checked' : ''}> ${t}</label>`).join('')}</div>`;
    app.innerHTML = `
      <p><a href="#/requests">← Requests</a></p>
      <header class="page-head b-simplehead"><h1>New request</h1></header>
      <form class="card b-form" id="nr">
        <label class="b-wide">What needs doing?<input name="subject" required placeholder="e.g. Sink leaking in the north bathroom" autocomplete="off"></label>
        <label class="b-wide">Where?<input name="location" required placeholder="e.g. Kids wing, room 104" autocomplete="off"></label>
        <div class="b-wide"><span class="b-q">Who should handle it?</span>${chips('support_team', [['Maintenance', 'Maintenance'], ['Custodial/Cleaning', 'Cleaning']], 0)}</div>
        <div class="b-wide"><span class="b-q">How soon?</span>${chips('priority', [['', 'When you can'], ['Priority (<3 business days)', 'This week'], ['Emergency (<1 hour)', 'Emergency']], 0)}</div>
        <label class="b-wide">Anything else? <span class="muted">(optional)</span><textarea name="details" rows="3" placeholder="What’s wrong, when it started"></textarea></label>
        <details class="b-wide b-moredetails-inline"><summary>More options</summary>
          <div class="b-form b-form-nested">
            <label>Campus/Org<select name="campus">${CAMPUSES.map((c) => `<option${c === 'MC Fort Worth' ? ' selected' : ''}>${esc(c)}</option>`).join('')}</select></label>
            <label>Due date<input name="due_date" type="date"></label>
            <label>Asked by<input name="requester_name" value="${esc(me()?.name || '')}"></label>
            <label>Their email<input name="requester_email" type="email" value="${esc(me()?.email || '')}"></label>
          </div>
        </details>
        <div class="b-wide"><button class="btn primary b-big">Send request</button></div>
      </form>`;
    app.querySelector('#nr [name=subject]').focus();
    app.querySelector('#nr').addEventListener('submit', async (e) => {
      e.preventDefault(); const f = new FormData(e.target); const v = (k) => (f.get(k) || '').toString().trim() || null;
      try {
        const [row] = await q(sb.from('maint_requests').insert({
          subject: v('subject'), location: v('location'), support_team: v('support_team'), priority: v('priority'), details: v('details'),
          campus: v('campus'), due_date: v('due_date'), requester_name: v('requester_name'), requester_email: v('requester_email'),
          // Monday's automation: a new item is assigned to Maxwell Trenda.
          experts: ['Maxwell Trenda'],
        }).select('id'));
        toast('Request sent');
        location.hash = `#/request/${row.id}`;
      } catch (err) { toast(errMsg(err), true); }
    });
  }

  // -------------------------------------------------------------------------
  // Custodial Weekly Checklist
  // -------------------------------------------------------------------------
  // Today's tasks first. Tap the circle when it's done. That's it.
  async function renderChecklist(view = 'week') {
    const week = await rpc('start_checklist_week', {});
    const [tasks, subs, pw] = await Promise.all([
      q(sb.from('checklist_tasks').select('*').eq('week_of', week).order('sort').order('id')),
      view === 'week' ? q(sb.from('checklist_subtasks').select('*, checklist_tasks!inner(week_of)').eq('checklist_tasks.week_of', week).order('sort').order('id')) : [],
      view === 'week' ? pulled.load('custodial').catch(() => null) : null,
      q(sb.from('team_members').select('name, role, active')).catch(() => []),
    ]).then((r) => { ckCrew = (r[3] || []).filter((m) => m.active && !['kiosk', 'none'].includes(m.role)).map((m) => m.name).sort(); return r; });
    const tpl = await q(sb.from('checklist_tasks').select('id, name, repeat, once_on, once_from, once_to, who').is('week_of', null)).catch(() => []);
    const nRepeat = tpl.filter((t) => t.repeat !== 'once').length;
    // One-time tasks waiting for a later week.
    const comingUp = tpl.filter((t) => t.repeat === 'once' && t.once_on && t.once_on > addIso(week, 6)).sort((a, b) => a.once_on.localeCompare(b.once_on));
    const byTask = {};
    subs.forEach((s) => { (byTask[s.task_id] = byTask[s.task_id] || []).push(s); });
    ckNotes = view === 'week' ? await loadNotes(sb, 'custodial', tasks.map((t) => t.id)) : {};
    const done = tasks.filter((t) => t.status === 'Done').length;
    const todayName = new Date().toLocaleDateString('en-US', { weekday: 'long' });
    const open = (t) => !['Done', 'Skipped', 'Missed'].includes(t.status);
    const leftToday = tasks.filter((t) => t.day === todayName && open(t)).length;
    const leftWeek = tasks.filter(open).length;
    // Today first, then the rest of the week, then the days already past.
    const ti = DAYS.indexOf(todayName);
    const order = [...DAYS.slice(ti, 7), ...DAYS.slice(0, ti), 'Detail Work'];
    const tabs = [['week', 'This week'], ['template', `Repeating tasks <b>${nRepeat}</b>`], ['log', 'Past weeks']];

    // Same frame as the Maintenance page: heading, numbers, pulled-to, tabs + Add task.
    app.innerHTML = `
      <div class="dept-custodial">${pageHead('<span class="dept-tag">Custodial</span>', 'Custodial <span class="accent">checklist</span>', 'Daily cleaning by day of the week. A fresh list starts every Tuesday, and anything not done becomes Missed.')}</div>
      <div class="stats">
        <div class="stat"><b>${leftToday}</b><span>to do today</span></div>
        <div class="stat"><b>${leftWeek}</b><span>left this week</span></div>
        <div class="stat"><b>${done} of ${tasks.length}</b><span>done this week</span></div>
      </div>
      ${pw && canEdit() ? pulled.block('custodial', pw) : ''}
      <div class="pm-bar"><div class="seg">${tabs.map(([k, t]) => `<a href="#/checklist${k === 'week' ? '' : `/${k}`}" class="${view === k ? 'on' : ''}">${t}</a>`).join('')}</div>
        ${canEdit() ? '<button class="btn primary" data-ck-add>+ Add task</button>' : ''}</div>
      <div id="pm-view">${view === 'week' ? order.map((d) => {
        const items = tasks.filter((t) => (t.day || 'Detail Work') === d);
        if (!items.length) return '';
        const left = items.filter((t) => !['Done', 'Skipped'].includes(t.status)).length;
        const isToday = d === todayName;
        return `<details class="b-group b-day${isToday ? ' today' : ''}"${isToday ? ' open' : ''}><summary><span class="b-gname">${isToday ? `Today · ${d}` : d}</span><span class="muted">${left ? `${left} to do` : 'all done ✓'}</span></summary>
          <div class="b-tasks">${items.map((t) => checkTask(t, byTask[t.id] || [])).join('')}</div></details>`;
      }).join('') + (comingUp.length ? `<details class="b-group"><summary><span class="b-gname">Coming up</span><span class="muted">one-time tasks for later weeks</span></summary>
          <div class="b-tplist">${comingUp.map((t) => `<div class="b-tprow"><span class="b-tpmain"><b>${esc(t.name)}</b><small class="muted">${[`${dayNameOf(t.once_on)}, ${dshort(t.once_on)}`, slotOf(t), t.who ? esc(t.who) : ''].filter(Boolean).join(' · ')}</small></span>
            ${isAdmin() ? `<button type="button" class="btn small" data-ckdrop="${t.id}">Remove</button>` : ''}</div>`).join('')}</div></details>` : '') : ''}</div>
`;
    app.querySelector('[data-ck-add]')?.addEventListener('click', async () => {
      if (await addTask(week, todayName, tasks, view === 'template' ? 'weekly' : 'once')) renderChecklist(view);
    });
    const body = app.querySelector('#pm-view');
    if (view === 'log') return renderTimeLog(week, body);
    if (view === 'template') return renderTemplate(body);
    const rerender = () => renderChecklist('week');
    app.querySelectorAll('[data-ckdrop]').forEach((b) => b.addEventListener('click', async () => {
      if (!(await askConfirm('Remove this one-time task?', { ok: 'Remove', danger: true }))) return;
      try { await q(sb.from('checklist_tasks').delete().eq('id', b.dataset.ckdrop).select('id')); toast('Removed'); } catch (err) { toast(errMsg(err), true); }
      rerender();
    }));
    pulled.bind(app, rerender);
    bindNotes(app, { sb, toast, errMsg, esc, meId: me()?.id, canDeleteAll: isAdmin(), names: Object.fromEntries(tasks.map((t) => [`custodial:${t.id}`, t.name])) }, rerender);
    app.querySelectorAll('[data-tick]').forEach((b) => b.addEventListener('click', async () => {
      const next = b.dataset.done === '1' ? 'Not started' : 'Done';
      b.closest('.b-task').classList.toggle('st-done', next === 'Done');
      try { await q(sb.from('checklist_tasks').update({ status: next }).eq('id', b.dataset.tick).select('id')); if (next === 'Done') toast('Done ✓'); } catch (err) { toast(errMsg(err), true); }
      rerender();
    }));
    app.querySelectorAll('[data-ckwho]').forEach((b) => b.addEventListener('click', async () => {
      const t = tasks.find((x) => String(x.id) === b.dataset.ckwho);
      const names = await pickPeople(t.name, whoList(t));
      if (!names) return;
      try { await q(sb.from('checklist_tasks').update({ who: names.join(', ') || null }).eq('id', t.id).select('id')); toast(names.length ? `On it: ${names.join(', ')}` : 'Nobody on it'); } catch (err) { toast(errMsg(err), true); }
      rerender();
    }));
    app.querySelectorAll('[data-skip]').forEach((b) => b.addEventListener('click', async () => {
      try { await q(sb.from('checklist_tasks').update({ status: 'Skipped' }).eq('id', b.dataset.skip).select('id')); toast('Skipped this week'); } catch (err) { toast(errMsg(err), true); }
      rerender();
    }));
    app.querySelectorAll('[data-cktimer]').forEach((b) => b.addEventListener('click', async () => {
      try { await rpc('checklist_timer', { p_id: Number(b.dataset.cktimer), p_run: b.dataset.run === '1' }); } catch (err) { toast(errMsg(err), true); }
      rerender();
    }));
    app.querySelectorAll('input[data-cksub]').forEach((c) => c.addEventListener('change', async () => {
      c.closest('label').classList.toggle('done', c.checked);
      try { await q(sb.from('checklist_subtasks').update({ done: c.checked }).eq('id', c.dataset.cksub).select('id')); } catch (err) { toast(errMsg(err), true); c.checked = !c.checked; }
      const box = c.closest('.b-task'); const all = box.querySelectorAll('input[data-cksub]');
      box.querySelector('.b-subcount').textContent = `${[...all].filter((x) => x.checked).length}/${all.length}`;
    }));
    startTick();
  }

  // People on a checklist task ("who"), like Monday's person column.
  let ckCrew = [];
  const whoList = (t) => String(t.who || '').split(',').map((x) => x.trim()).filter(Boolean);
  function pickPeople(title, current) {
    return new Promise((resolve) => {
      let sel = new Set(current);
      const names = [...new Set([...ckCrew, ...current])];
      const back = document.createElement('div');
      back.className = 'modal-back';
      back.innerHTML = `<div class="modal b-pickpeople" role="dialog" aria-modal="true" aria-label="Who's on it">
        <h3>Who's on it?</h3><p class="muted">${esc(title)}</p>
        <div class="wk-chips">${names.map((n) => `<button type="button" class="chip-btn b-pp" data-pp="${esc(n)}"><span class="b-av" style="background:${hue(n)}">${esc(initials(n))}</span>${esc(n)}</button>`).join('')}</div>
        <div class="modal-actions"><button type="button" class="btn" data-clear>Nobody</button><button type="button" class="btn" data-cancel>Cancel</button><button type="button" class="btn primary" data-ok>Save</button></div></div>`;
      const draw = () => back.querySelectorAll('[data-pp]').forEach((b) => b.classList.toggle('on', sel.has(b.dataset.pp)));
      back.querySelectorAll('[data-pp]').forEach((b) => b.addEventListener('click', () => { if (sel.has(b.dataset.pp)) sel.delete(b.dataset.pp); else sel.add(b.dataset.pp); draw(); }));
      const done = (v) => { document.removeEventListener('keydown', onKey, true); back.remove(); resolve(v); };
      const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); done(null); } };
      document.addEventListener('keydown', onKey, true);
      back.addEventListener('mousedown', (e) => { if (e.target === back) done(null); });
      back.querySelector('[data-cancel]').addEventListener('click', () => done(null));
      back.querySelector('[data-clear]').addEventListener('click', () => { sel = new Set(); draw(); });
      back.querySelector('[data-ok]').addEventListener('click', () => done(names.filter((n) => sel.has(n))));
      draw();
      document.body.appendChild(back);
    });
  }

  // A task for this week only (not on the weekly template).
  // "+ Add task": one form, like Maintenance's. Just this week, every week, or once a month.
  function addTask(week, todayName, tasks, startFreq = 'once') {
    return new Promise((resolve) => {
      let day = todayName;
      let freq = isAdmin() ? startFreq : 'once';
      let mweek = 1;
      const sel = new Set();
      const FREQ = [['once', 'One time'], ['weekly', 'Every week'], ['monthly', 'Once a month']];
      const todayIso = isoDay(new Date());
      let onceOn = todayIso;
      const back = document.createElement('div');
      back.className = 'modal-back';
      back.innerHTML = `<form class="modal sheet b-ckform" role="dialog" aria-modal="true" aria-labelledby="ck-add-title">
        <h3 id="ck-add-title">New custodial task</h3>
        <label><span>What needs doing?</span><input name="name" required autocomplete="off" placeholder="e.g. Deep clean the green room" class="modal-input"></label>
        ${isAdmin() ? `<div class="wk-sect">How often</div>
        <div class="wk-chips">${FREQ.map(([k, l]) => `<button type="button" class="chip-btn big" data-ckfreq="${k}">${l}</button>`).join('')}</div>` : ''}
        <div data-ckonce><div class="wk-sect">When</div>
          <div class="pm-once"><label><span>Day</span><input type="date" name="once_on" value="${todayIso}" min="${todayIso}"></label><span></span></div>
          <div class="pm-once"><label><span>From <span class="muted">(optional time)</span></span><select name="once_from"><option value="">Any time that day</option>${TIMES.map((v) => `<option value="${v}">${hm12(v)}</option>`).join('')}</select></label>
          <label><span>To</span><select name="once_to"><option value="">—</option>${TIMES.map((v) => `<option value="${v}">${hm12(v)}</option>`).join('')}</select></label></div></div>
        <div data-ckdays><div class="wk-sect">Which day</div>
        <div class="wk-chips">${DAYS.filter((d) => d !== 'Detail Work').map((d) => `<button type="button" class="chip-btn" data-ckday="${d}">${d.slice(0, 3)}${d === todayName ? ' (today)' : ''}</button>`).join('')}</div></div>
        <div data-ckmw><div class="wk-sect">Which week of the month</div>
        <div class="wk-chips">${MONTH_WEEKS.map(([k]) => `<button type="button" class="chip-btn" data-ckmweek="${k}"></button>`).join('')}</div></div>
        <p class="pm-preview" data-ckhelp></p>
        <div class="wk-sect">Who's on it <span class="muted pm-opt">(optional: tap to add or remove)</span></div>
        <div class="wk-chips">${ckCrew.map((n) => `<button type="button" class="chip-btn b-pp" data-ckpp="${esc(n)}"><span class="b-av" style="background:${hue(n)}">${esc(initials(n))}</span>${esc(n)}</button>`).join('') || '<span class="muted">No team members yet.</span>'}</div>
        <details class="pm-more"><summary>Steps and notes <span class="muted">(optional)</span></summary>
          <label style="margin-top:10px"><span>Steps <span class="muted">(one per line)</span></span><textarea name="steps" rows="3" placeholder="Vacuum&#10;Wipe tables&#10;Trash"></textarea></label>
          <label style="margin-top:10px"><span>Note <span class="muted">(shows under the name)</span></span><input name="includes" placeholder="e.g. Also do the Family Center office"></label>
        </details>
        <div class="modal-actions"><button type="button" class="btn" data-cancel>Cancel</button><button class="btn primary">Add task</button></div>
      </form>`;
      const form = back.querySelector('form');
      const draw = () => {
        form.querySelectorAll('[data-ckfreq]').forEach((b) => b.classList.toggle('on', b.dataset.ckfreq === freq));
        form.querySelectorAll('[data-ckday]').forEach((b) => b.classList.toggle('on', b.dataset.ckday === day));
        form.querySelectorAll('[data-ckpp]').forEach((b) => b.classList.toggle('on', sel.has(b.dataset.ckpp)));
        form.querySelector('[data-ckonce]').hidden = freq !== 'once';
        form.querySelector('[data-ckdays]').hidden = freq === 'once';
        const slot = slotOf({ once_from: form.querySelector('[name=once_from]').value, once_to: form.querySelector('[name=once_to]').value });
        form.querySelector('[data-ckhelp]').textContent = freq === 'once' ? (onceOn ? `One time · ${dayNameOf(onceOn)}, ${dshort(onceOn)}${slot ? `, ${slot}` : ''}${addIso(week, 6) < onceOn ? ' · shows up on that week\'s list' : ''}` : 'Pick the day')
          : freq === 'weekly' ? `On the list every ${day}, starting this week.` : `On the list once a month, in the week of the ${ordOf(mweek).toLowerCase()} ${day} of the month.`;
        form.querySelector('[data-ckmw]').hidden = freq !== 'monthly';
        form.querySelectorAll('[data-ckmweek]').forEach((b) => { const k = Number(b.dataset.ckmweek); b.textContent = `${ordOf(k)} ${day.slice(0, 3)}`; b.classList.toggle('on', k === mweek); });
      };
      form.querySelectorAll('[data-ckfreq]').forEach((b) => b.addEventListener('click', () => { freq = b.dataset.ckfreq; draw(); }));
      form.querySelectorAll('[data-ckmweek]').forEach((b) => b.addEventListener('click', () => { mweek = Number(b.dataset.ckmweek); draw(); }));
      form.querySelector('[name=once_on]').addEventListener('change', (e) => { onceOn = e.target.value; draw(); });
      form.querySelector('[name=once_from]').addEventListener('change', () => { const a = form.querySelector('[name=once_from]').value; const z = form.querySelector('[name=once_to]'); if (a && (!z.value || z.value <= a)) z.value = TIMES[Math.min(TIMES.length - 1, TIMES.indexOf(a) + 2)]; draw(); });
      form.querySelector('[name=once_to]').addEventListener('change', () => draw());
      form.querySelectorAll('[data-ckday]').forEach((b) => b.addEventListener('click', () => { day = b.dataset.ckday; draw(); }));
      form.querySelectorAll('[data-ckpp]').forEach((b) => b.addEventListener('click', () => { const n = b.dataset.ckpp; if (sel.has(n)) sel.delete(n); else sel.add(n); draw(); }));
      const done = (v) => { document.removeEventListener('keydown', onKey, true); back.remove(); resolve(v); };
      const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); done(false); } };
      document.addEventListener('keydown', onKey, true);
      back.addEventListener('mousedown', (e) => { if (e.target === back) done(false); });
      form.querySelector('[data-cancel]').addEventListener('click', () => done(false));
      let saving = false;
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (saving) return;
        const f = new FormData(form);
        const name = String(f.get('name') || '').trim();
        if (!name) return form.querySelector('[name=name]').focus();
        const steps = String(f.get('steps') || '').split('\n').map((x) => x.trim()).filter(Boolean);
        const who = sel.size ? [...sel].join(', ') : null;
        const includes = String(f.get('includes') || '').trim() || null;
        const sort = Math.max(0, ...tasks.map((t) => t.sort || 0)) + 1;
        if (freq === 'once') {
          if (!onceOn || onceOn < todayIso) { toast('Pick today or a later day', true); return; }
          const oFrom = form.querySelector('[name=once_from]').value || null;
          const oTo = oFrom ? (form.querySelector('[name=once_to]').value || null) : null;
          if (oFrom && oTo && oTo <= oFrom) { toast('The end time has to be after the start time', true); return; }
          const d = dayNameOf(onceOn);
          const fields = { name, day: d, area: 'Building', status: 'Not started', who, includes, sort, once_on: onceOn, once_from: oFrom, once_to: oTo };
          const later = onceOn > addIso(week, 6);
          saving = true;
          try {
            // This week: straight onto the list. A later week: waits, and lands on that week's list.
            const [row] = await q(sb.from('checklist_tasks').insert(later ? { ...fields, repeat: 'once', week_of: null } : { ...fields, week_of: week }).select('id'));
            if (steps.length) await q(sb.from('checklist_subtasks').insert(steps.map((n, i) => ({ task_id: row.id, name: n, sort: i }))).select('id'));
            toast(`Added for ${d}, ${dshort(onceOn)}${later ? '. It shows up that week.' : ''}`);
            done(true);
          } catch (err) { saving = false; toast(errMsg(err), true); }
          return;
        }
        // Monthly: only on this week's list if this is the week of the first <day> of the month (weeks start Tuesday).
        const thisWeek = freq !== 'monthly' || monthHit(week, day, mweek);
        saving = true;
        try {
          let templateId = null;
          if (freq !== 'once') {
            [{ id: templateId }] = await q(sb.from('checklist_tasks').insert({ name, day, area: 'Building', who, includes, repeat: freq, ...(freq === 'monthly' ? { month_week: mweek } : {}), week_of: null, sort }).select('id'));
            if (steps.length) await q(sb.from('checklist_subtasks').insert(steps.map((n, i) => ({ task_id: templateId, name: n, sort: i }))).select('id'));
          }
          if (thisWeek) {
            const [row] = await q(sb.from('checklist_tasks').insert({
              week_of: week, name, day, area: 'Building', status: 'Not started', includes: freq === 'once' ? (includes || 'This week only') : includes,
              who, sort, template_id: templateId,
            }).select('id'));
            if (steps.length) await q(sb.from('checklist_subtasks').insert(steps.map((n, i) => ({ task_id: row.id, name: n, sort: i }))).select('id'));
          }
          toast(freq === 'once' ? `Added for ${day}` : freq === 'weekly' ? `Added: every ${day}` : `Added: ${ordOf(mweek).toLowerCase()} ${day} of each month${thisWeek ? ', starting this week' : ''}`);
          done(true);
        } catch (err) { saving = false; toast(errMsg(err), true); }
      });
      draw();
      document.body.appendChild(back);
      form.querySelector('[name=name]').focus();
    });
  }

  function checkTask(t, subs) {
    const ed = canEdit();
    const isDone = t.status === 'Done';
    const closed = ['Done', 'Skipped', 'Missed'].includes(t.status);
    const nDone = subs.filter((s) => s.done).length;
    return `<div class="b-task st-${slug(t.status)}">
      <div class="b-taskrow">
        <button class="b-tick${isDone ? ' on' : ''}" data-tick="${t.id}" data-done="${isDone ? 1 : 0}" aria-label="${isDone ? 'Mark not done' : 'Mark done'}: ${esc(t.name)}"${ed ? '' : ' disabled'}>✓</button>
        <div class="b-taskname"><b>${esc(t.name)}</b>
          <small>${[t.timer_started_at && (t.clocked || []).length ? `⏱ ${(t.clocked || []).map((n) => String(n).split(' ')[0]).join(', ')} clocked in` : '', t.status === 'Skipped' ? 'Skipped' : t.status === 'Missed' ? 'Missed' : '', isDone && t.done_on ? `Done ${tshort(t.done_on)}` : '', !isDone && t.once_from ? `⏰ ${slotOf(t)}` : '', !isDone ? t.includes : '']
            .filter(Boolean).map(esc).join(' · ')}</small></div>
        <span class="b-acts">${ed ? `<button class="b-who${whoList(t).length ? '' : ' empty'}" data-ckwho="${t.id}" title="${whoList(t).length ? esc(whoList(t).join(', ')) : 'Add people'}">${whoList(t).length ? avatars(whoList(t), 3) : '<span class="b-whoadd">+ Person</span>'}</button>`
          : whoList(t).length ? `<span class="b-who">${avatars(whoList(t), 3)}</span>` : ''}
        ${t.timer_started_at || t.worked_seconds ? `<span class="b-time num">${liveSpan(t)}</span>` : ''}
        ${ed ? noteButton('custodial', t.id, (ckNotes[t.id] || []).length) : ''}
        ${ed && !closed ? (() => { const mine = (t.clocked || []).some((n) => String(n).toLowerCase() === String(me()?.name || '').toLowerCase());
          return `<button class="btn small${mine ? ' b-running' : ''}" data-cktimer="${t.id}" data-run="${mine ? 0 : 1}" title="${mine ? 'Clock out' : t.timer_started_at ? 'Clock in too' : 'Clock in'}">${mine ? '■ Stop' : t.timer_started_at ? '▶ Join' : '▶ Start'}</button>`; })() : ''}
        ${ed && !closed ? `<button class="btn small" data-skip="${t.id}" title="Skip this week">Skip</button>` : ''}</span>
      </div>
      ${(ckNotes[t.id] || []).length ? `<div class="b-notes">${notesList(ckNotes[t.id], esc, me()?.id, isAdmin())}</div>` : ''}
      ${subs.length && !closed ? `<details class="b-subs"><summary>${subs.length} steps <span class="b-subcount">${nDone}/${subs.length}</span></summary>
        ${subs.map((s) => `<label class="${s.done ? 'done' : ''}"><input type="checkbox" data-cksub="${s.id}"${s.done ? ' checked' : ''}${ed ? '' : ' disabled'}><span>${esc(s.name)}</span></label>`).join('')}</details>` : ''}
    </div>`;
  }

  async function renderTimeLog(current, target = app) {
    const [tasks, pulledRows, members] = await Promise.all([
      q(sb.from('checklist_tasks').select('id, week_of, name, area, status, who, day, worked_seconds, manual_hours, done_on, timer_started_at').not('week_of', 'is', null).order('week_of', { ascending: false }).order('sort')),
      q(sb.from('pulled_work').select('*').order('started_at', { ascending: false }).limit(1000)).catch(() => []),
      q(sb.from('team_members').select('id, name')).catch(() => []),
    ]);
    const whoId = Object.fromEntries(members.map((m) => [m.id, m.name]));
    // Pulled-to work belongs to the week (Tuesday-Monday) of its day.
    const wkOf = (iso) => { const [y, m, d] = iso.split('-').map(Number); const dt = new Date(y, m - 1, d); const s = new Date(y, m - 1, d - ((dt.getDay() + 5) % 7)); return `${s.getFullYear()}-${String(s.getMonth() + 1).padStart(2, '0')}-${String(s.getDate()).padStart(2, '0')}`; };
    // Put each one in the list week it falls in (the latest week starting on or before its day).
    const listWeeks = [...new Set(tasks.map((t) => t.week_of))].sort();
    const weekFor = (day) => listWeeks.filter((x) => x <= day).pop() || wkOf(day);
    const pulledIn = (w) => pulledRows.filter((p) => weekFor(p.day) === w);
    const pSecs = (p) => Math.max(0, ((p.ended_at ? new Date(p.ended_at) : new Date()) - new Date(p.started_at)) / 1000 - (p.paused_seconds || 0));
    const weeks = [...new Set(tasks.map((t) => t.week_of))];
    // Each person's own time (0071 sessions); older tasks without sessions fall back to "who".
    const sess = await q(sb.from('work_sessions').select('*').eq('kind', 'custodial').in('task_id', tasks.map((t) => t.id))).catch(() => []);
    const sSecs = (x) => Math.max(0, ((x.ended_at ? new Date(x.ended_at) : new Date()) - new Date(x.started_at)) / 1000);
    const hasSess = new Set(sess.map((x) => x.task_id));
    const people = {};
    sess.forEach((x) => { const n = whoId[x.member_id] || 'Someone'; people[n] = (people[n] || 0) + sSecs(x); });
    tasks.forEach((t) => { if (hasSess.has(t.id) || !t.who || !(t.worked_seconds || t.manual_hours)) return; t.who.split(',').map((x) => x.trim()).forEach((p) => { people[p] = (people[p] || 0) + liveSecs(t) + (t.manual_hours || 0) * 3600; }); });
    pulledRows.forEach((p) => { const n = whoId[p.member_id] || 'Someone'; people[n] = (people[n] || 0) + pSecs(p); });
    target.innerHTML = `
      <div class="table-wrap"><table class="b-table b-narrow"><tr><th>Week of</th><th class="num">Done</th><th class="num">Missed</th><th class="num">Quick tasks</th><th class="num">Time logged</th><th>Completion</th></tr>
        ${weeks.map((w) => {
          const ts = tasks.filter((t) => t.week_of === w); const c = (s) => ts.filter((t) => t.status === s).length;
          const pct = Math.round((c('Done') / ts.length) * 100);
          return `<tr><td><b>${dshort(w)}</b>${w === current ? ' <span class="pill planned">This week</span>' : ''}</td><td class="num">${c('Done')}</td><td class="num">${c('Missed')}</td><td class="num">${pulledIn(w).length || ''}</td>
            <td class="num">${dur(ts.reduce((a, t) => a + liveSecs(t) + (t.manual_hours || 0) * 3600, 0) + pulledIn(w).reduce((a, p) => a + pSecs(p), 0))}</td>
            <td><span class="b-progbar small"><i style="width:${pct}%"></i></span> ${pct}%</td></tr>`;
        }).join('')}</table></div>
      ${barList('Time by person, all weeks (tasks + quick tasks)', Object.fromEntries(Object.entries(people).map(([k, v]) => [`${k} · ${dur(v)}`, Math.round(v / 60)])), 'Bars are minutes.')}
      ${weeks.map((w, wi) => `<details class="b-group"${wi === 0 ? " open" : ""}><summary><span class="b-gname">Week of ${dshort(w)}</span><span class="muted">${tasks.filter((t) => t.week_of === w).length} tasks${pulledIn(w).length ? ` · ${pulledIn(w).length} quick tasks` : ""}</span></summary>
        ${pulledIn(w).length ? `<h4 class="pw-h">Quick tasks</h4><div class="table-wrap"><table class="b-table"><tr><th>Who</th><th>What</th><th>Where</th><th>When</th><th class="num">Time</th></tr>
          ${pulledIn(w).map((p) => `<tr><td>${esc(whoId[p.member_id] || '')}</td><td>${esc(p.what)}</td><td>${esc(p.location || '')}</td><td class="muted">${tshort(p.started_at)}</td><td class="num">${dur(pSecs(p))}${p.ended_at ? '' : ' (still going)'}</td></tr>`).join('')}</table></div>` : ''}
        <h4 class="pw-h">Tasks</h4>
        <div class="table-wrap"><table class="b-table"><tr><th>Task</th><th>Day</th><th>Area</th><th>Status</th><th>Who</th><th class="num">Time</th><th>Done on</th></tr>
        ${tasks.filter((t) => t.week_of === w).map((t) => `<tr><td>${esc(t.name)}</td><td>${esc(t.day || '')}</td><td>${esc(t.area || '')}</td><td><span class="b-pill s-${slug(t.status)}">${esc(t.status)}</span></td>
          <td>${esc(t.who || '')}</td><td class="num">${liveSecs(t) || t.manual_hours ? dur(liveSecs(t) + (t.manual_hours || 0) * 3600) : ''}${(() => { const by = {}; sess.filter((x) => x.task_id === t.id).forEach((x) => { by[x.member_id] = (by[x.member_id] || 0) + sSecs(x); }); const parts = Object.entries(by).filter(([, v]) => v >= 60); return parts.length ? `<br><small class="muted">${parts.map(([id, v]) => `${esc(String(whoId[id] || '').split(' ')[0])} ${dur(v)}`).join(', ')}</small>` : ''; })()}</td><td class="muted">${tshort(t.done_on)}</td></tr>`).join('')}</table></div></details>`).join('')}`;
  }

  async function renderTemplate(target = app) {
    const [tasks, subs, week, members] = await Promise.all([
      q(sb.from('checklist_tasks').select('*').is('week_of', null).neq('repeat', 'once').order('sort').order('id')),
      q(sb.from('checklist_subtasks').select('*, checklist_tasks!inner(week_of)').is('checklist_tasks.week_of', null).order('sort').order('id')),
      rpc('start_checklist_week', {}).catch(() => null),
      q(sb.from('team_members').select('name, role, active')).catch(() => []),
    ]);
    ckCrew = members.filter((m) => m.active && !['kiosk', 'none'].includes(m.role)).map((m) => m.name).sort();
    const admin = isAdmin();
    const stepsOf = (t) => subs.filter((x) => x.task_id === t.id);
    target.innerHTML = `
      <p class="muted b-note">These are added to the list fresh every Tuesday. ${admin ? 'Tap a task to change it.' : 'Only admins can change them.'}</p>
      ${DAYS.map((d) => {
        const items = tasks.filter((t) => (t.day || 'Detail Work') === d);
        if (!items.length) return '';
        return `<details class="b-group" open><summary><span class="b-gname">${d}</span><span class="muted">${items.length} tasks</span></summary>
          <div class="b-tplist">${items.map((t) => `<button type="button" class="b-tprow" data-tpedit="${t.id}"${admin ? '' : ' disabled'}>
            <span class="b-tpmain"><b>${esc(t.name)}</b><small class="muted">${[t.repeat === 'monthly' ? `Monthly · ${ordOf(t.month_week).toLowerCase()} ${t.day || 'Saturday'}` : '', t.area, stepsOf(t).length ? `${stepsOf(t).length} steps` : '', t.who ? `Usually ${t.who}` : '', t.includes || ''].filter(Boolean).map(esc).join(' · ')}</small></span>
            ${admin ? '<span class="b-tpedit">Edit</span>' : ''}</button>`).join('')}</div></details>`;
      }).join('')}`;
    const reload = () => renderChecklist('template');
    app.querySelectorAll('[data-tpedit]').forEach((b) => b.addEventListener('click', async () => {
      const t = tasks.find((x) => x.id === Number(b.dataset.tpedit));
      if (await editTemplateTask(t, stepsOf(t), week, tasks)) reload();
    }));
  }

  // Add or change a repeating (template) task. Can also update this week's copy.
  function editTemplateTask(t, steps, week, tasks) {
    const editing = !!t;
    return new Promise((resolve) => {
      let day = t?.day || new Date().toLocaleDateString('en-US', { weekday: 'long' });
      let area = t?.area || 'Building';
      let repeat = t?.repeat || 'weekly';
      let mweek = t?.month_week || 1;
      const sel = new Set(String(t?.who || '').split(',').map((x) => x.trim()).filter(Boolean));
      const names = [...new Set([...ckCrew, ...sel])];
      const back = document.createElement('div');
      back.className = 'modal-back';
      back.innerHTML = `<form class="modal sheet b-ckform" role="dialog" aria-modal="true" aria-labelledby="tp-title">
        <h3 id="tp-title">${editing ? 'Edit repeating task' : 'New repeating task'}</h3>
        <p class="muted" data-tphelp></p>
        <label><span>Task</span><input name="name" required autocomplete="off" value="${esc(t?.name || '')}" placeholder="e.g. Wipe lobby glass doors" class="modal-input"></label>
        <div class="wk-sect">Which day</div>
        <div class="wk-chips">${DAYS.map((d) => `<button type="button" class="chip-btn" data-tpday="${d}">${d === 'Detail Work' ? 'Any day (detail work)' : d.slice(0, 3)}</button>`).join('')}</div>
        <div class="wk-sect">How often</div>
        <div class="wk-chips"><button type="button" class="chip-btn" data-tprep="weekly">Every week</button><button type="button" class="chip-btn" data-tprep="monthly">Once a month</button></div>
        <div data-tpmw><div class="wk-sect">Which week of the month</div>
        <div class="wk-chips">${MONTH_WEEKS.map(([k]) => `<button type="button" class="chip-btn" data-tpmweek="${k}"></button>`).join('')}</div></div>
        <div class="wk-sect">Area</div>
        <div class="wk-chips">${AREAS.map((a) => `<button type="button" class="chip-btn" data-tparea="${a}">${a}</button>`).join('')}</div>
        <div class="wk-sect">Who usually does it <span class="muted pm-opt">(optional; fills in each week)</span></div>
        <div class="wk-chips">${names.map((n) => `<button type="button" class="chip-btn b-pp" data-tppp="${esc(n)}"><span class="b-av" style="background:${hue(n)}">${esc(initials(n))}</span>${esc(n)}</button>`).join('') || '<span class="muted">No team members yet.</span>'}</div>
        <label style="margin-top:12px"><span>Steps <span class="muted">(one per line)</span></span><textarea name="steps" rows="5" placeholder="Vacuum&#10;Wipe tables&#10;Trash">${esc(steps.map((x) => x.name).join('\n'))}</textarea></label>
        <label style="margin-top:10px"><span>Note <span class="muted">(optional, shows under the name)</span></span><input name="includes" value="${esc(t?.includes || '')}" placeholder="e.g. Wednesday: also do the Family Center office"></label>
        <label class="b-tpweek"><input type="checkbox" name="thisweek" checked> <span>Also ${editing ? 'update' : 'add it to'} this week's list</span></label>
        <div class="modal-actions">${editing ? '<button type="button" class="btn bad pm-left" data-tpdelete>Remove</button>' : ''}
          <button type="button" class="btn" data-cancel>Cancel</button><button class="btn primary">${editing ? 'Save' : 'Add'}</button></div>
      </form>`;
      const form = back.querySelector('form');
      const draw = () => {
        form.querySelectorAll('[data-tpday]').forEach((b) => b.classList.toggle('on', b.dataset.tpday === (day || 'Detail Work')));
        form.querySelectorAll('[data-tparea]').forEach((b) => b.classList.toggle('on', b.dataset.tparea === area));
        form.querySelectorAll('[data-tprep]').forEach((b) => b.classList.toggle('on', b.dataset.tprep === repeat));
        const dname = day && day !== 'Detail Work' ? day : null;
        form.querySelector('[data-tpmw]').hidden = repeat !== 'monthly';
        form.querySelectorAll('[data-tpmweek]').forEach((b) => { const k = Number(b.dataset.tpmweek); b.textContent = `${ordOf(k)} ${dname ? dname.slice(0, 3) : 'week'}`; b.classList.toggle('on', k === mweek); });
        form.querySelector('[data-tphelp]').textContent = repeat === 'monthly'
          ? `This task is added to the list once a month, in the week of the ${ordOf(mweek).toLowerCase()} ${dname || 'Saturday'} of the month.`
          : 'This task is added to the list every week.';
        form.querySelectorAll('[data-tppp]').forEach((b) => b.classList.toggle('on', sel.has(b.dataset.tppp)));
      };
      form.querySelectorAll('[data-tpday]').forEach((b) => b.addEventListener('click', () => { day = b.dataset.tpday; draw(); }));
      form.querySelectorAll('[data-tparea]').forEach((b) => b.addEventListener('click', () => { area = b.dataset.tparea; draw(); }));
      form.querySelectorAll('[data-tprep]').forEach((b) => b.addEventListener('click', () => { repeat = b.dataset.tprep; draw(); }));
      form.querySelectorAll('[data-tpmweek]').forEach((b) => b.addEventListener('click', () => { mweek = Number(b.dataset.tpmweek); draw(); }));
      form.querySelectorAll('[data-tppp]').forEach((b) => b.addEventListener('click', () => { const n = b.dataset.tppp; if (sel.has(n)) sel.delete(n); else sel.add(n); draw(); }));
      const done = (v) => { document.removeEventListener('keydown', onKey, true); back.remove(); resolve(v); };
      const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); done(false); } };
      document.addEventListener('keydown', onKey, true);
      back.addEventListener('mousedown', (e) => { if (e.target === back) done(false); });
      form.querySelector('[data-cancel]').addEventListener('click', () => done(false));
      form.querySelector('[data-tpdelete]')?.addEventListener('click', async () => {
        if (!(await askConfirm(`Remove "${t.name}"?`, { message: 'It stops being added each week. This week\'s list and past weeks keep it.', ok: 'Remove', danger: true }))) return;
        try { await q(sb.from('checklist_tasks').delete().eq('id', t.id).select('id')); toast('Removed'); done(true); } catch (err) { toast(errMsg(err), true); }
      });
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const f = new FormData(form);
        const name = String(f.get('name') || '').trim();
        if (!name) return form.querySelector('[name=name]').focus();
        const list = String(f.get('steps') || '').split('\n').map((x) => x.trim()).filter(Boolean);
        const fields = { name, day: day === 'Detail Work' ? null : day, area, includes: String(f.get('includes') || '').trim() || null, who: sel.size ? [...sel].join(', ') : null };
        // Monthly: does it belong on this week's list? (the week of the first <day> of the month)
        const inThisWeek = () => {
          if (repeat !== 'monthly' || !week) return true;
          return monthHit(week, fields.day, mweek);
        };
        try {
          // The template row and its steps.
          let id = t?.id;
          if (editing) await q(sb.from('checklist_tasks').update({ ...fields, repeat, ...(repeat === 'monthly' ? { month_week: mweek } : {}) }).eq('id', id).select('id'));
          else [{ id }] = await q(sb.from('checklist_tasks').insert({ ...fields, repeat, ...(repeat === 'monthly' ? { month_week: mweek } : {}), week_of: null, sort: Math.max(0, ...tasks.map((x) => x.sort || 0)) + 1 }).select('id'));
          if (editing) await q(sb.from('checklist_subtasks').delete().eq('task_id', id).select('id'));
          if (list.length) await q(sb.from('checklist_subtasks').insert(list.map((n, i) => ({ task_id: id, name: n, sort: i }))).select('id'));
          // This week's copy: same fields; keep steps already checked off.
          if (f.get('thisweek') && week && !inThisWeek()) {
            // Monthly and not this week: take this week's copy off unless it's been started.
            const [copy] = editing ? await q(sb.from('checklist_tasks').select('*').eq('template_id', id).eq('week_of', week)) : [];
            if (copy && copy.status === 'Not started') await q(sb.from('checklist_tasks').delete().eq('id', copy.id).select('id'));
          } else if (f.get('thisweek') && week) {
            const [copy] = editing ? await q(sb.from('checklist_tasks').select('*').eq('template_id', id).eq('week_of', week)) : [];
            if (copy) {
              await q(sb.from('checklist_tasks').update({ ...fields, who: fields.who || copy.who }).eq('id', copy.id).select('id'));
              const have = await q(sb.from('checklist_subtasks').select('*').eq('task_id', copy.id));
              const drop = have.filter((x) => !list.includes(x.name) && !x.done).map((x) => x.id);
              if (drop.length) await q(sb.from('checklist_subtasks').delete().in('id', drop).select('id'));
              const add = list.filter((n) => !have.some((x) => x.name === n));
              if (add.length) await q(sb.from('checklist_subtasks').insert(add.map((n) => ({ task_id: copy.id, name: n, sort: list.indexOf(n) }))).select('id'));
            } else {
              const [nw] = await q(sb.from('checklist_tasks').insert({ ...fields, week_of: week, template_id: id, status: 'Not started', sort: 999 }).select('id'));
              if (list.length) await q(sb.from('checklist_subtasks').insert(list.map((n, i) => ({ task_id: nw.id, name: n, sort: i }))).select('id'));
            }
          }
          toast(editing ? 'Saved' : 'Added');
          done(true);
        } catch (err) { toast(errMsg(err), true); }
      });
      draw();
      document.body.appendChild(back);
      if (!editing) form.querySelector('[name=name]').focus();
    });
  }


  return { renderRequests, renderRequest, renderChecklist };
}

// Facility boards: Maintenance Requests and the Custodial Weekly Checklist.
// Rebuilt from the monday.com boards: same groups, columns, status labels and
// automations (the automations run in the database, see 0027_facility_boards.sql).

export const REQ_STATUSES = ['New', 'In Progress', 'Scheduled', 'Needs Scheduled', 'Needs Ordered', 'Ordered', 'Paused',
  'Project', 'Needs Onsite Visit', 'Waiting for Approval', 'Executive', 'Complete', 'Declined'];
export const REQ_GROUPS = [
  ['new', 'New ticket'], ['in_progress', 'In Progress'], ['pending_reply', 'Pending Reply'],
  ['executive', 'Executive Requests'], ['solved', 'Ticket solved - user notified'],
];
const SUB_STATUSES = ['Working on it', 'Done', 'Stuck'];
const CHECK_STATUSES = ['Not started', 'Working on it', 'Done', 'Skipped', 'Missed'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Detail Work'];
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

export function boardPages(ctx) {
  const { sb, q, rpc, esc, toast, askText, askConfirm, errMsg, pageHead, route, canEdit, isAdmin, me, pulled } = ctx;
  const app = document.getElementById('app');
  let tick = null;
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
    const tabs = [['board', `Status board <b>${open.length}</b>`], ['open', 'List'], ['solved', `Done <b>${rows.length - open.length}</b>`]];
    const isMore = MORE_VIEWS.some(([k]) => k === view);

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
      <div class="b-more">More views: ${MORE_VIEWS.map(([k, t]) => `<a href="#/requests/${k}" class="${view === k ? 'on' : ''}">${t}</a>`).join(' · ')}${isMore ? ' · <a href="#/requests">Back to the status board</a>' : ''}</div>
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
      <details class="card b-box b-moredetails"><summary>More details</summary>
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
    if (view === 'log') return renderTimeLog(week);
    if (view === 'template') return renderTemplate();
    const [tasks, subs, pw] = await Promise.all([
      q(sb.from('checklist_tasks').select('*').eq('week_of', week).order('sort').order('id')),
      q(sb.from('checklist_subtasks').select('*, checklist_tasks!inner(week_of)').eq('checklist_tasks.week_of', week).order('sort').order('id')),
      pulled.load('custodial').catch(() => null),
    ]);
    const byTask = {};
    subs.forEach((s) => { (byTask[s.task_id] = byTask[s.task_id] || []).push(s); });
    const done = tasks.filter((t) => t.status === 'Done').length;
    const todayName = new Date().toLocaleDateString('en-US', { weekday: 'long' });
    const pct = tasks.length ? Math.round((done / tasks.length) * 100) : 0;
    const order = [todayName, ...DAYS.filter((d) => d !== todayName)];

    app.innerHTML = `
      <header class="page-head b-simplehead dept-custodial"><div><div class="eyebrow dept-tag">Custodial</div><h1>Custodial <span class="accent">checklist</span></h1></div></header>
      <div class="b-progress"><div class="b-progbar"><i style="width:${pct}%"></i></div><span><b>${done} of ${tasks.length}</b> done this week</span></div>
      ${pw && canEdit() ? pulled.block('custodial', pw) : ''}
      ${order.map((d) => {
        const items = tasks.filter((t) => (t.day || 'Detail Work') === d);
        if (!items.length) return '';
        const left = items.filter((t) => !['Done', 'Skipped'].includes(t.status)).length;
        const isToday = d === todayName;
        return `<details class="b-group b-day${isToday ? ' today' : ''}"${isToday ? ' open' : ''}><summary><span class="b-gname">${isToday ? `Today · ${d}` : d}</span><span class="muted">${left ? `${left} to do` : 'all done ✓'}</span></summary>
          <div class="b-tasks">${items.map((t) => checkTask(t, byTask[t.id] || [])).join('')}</div></details>`;
      }).join('')}
      <div class="b-more">More: <a href="#/checklist/log">Past weeks and time log</a> · <a href="#/checklist/template">Weekly template</a></div>`;

    const rerender = () => renderChecklist('week');
    pulled.bind(app, rerender);
    app.querySelectorAll('[data-tick]').forEach((b) => b.addEventListener('click', async () => {
      const next = b.dataset.done === '1' ? 'Not started' : 'Done';
      b.closest('.b-task').classList.toggle('st-done', next === 'Done');
      try { await q(sb.from('checklist_tasks').update({ status: next }).eq('id', b.dataset.tick).select('id')); if (next === 'Done') toast('Done ✓'); } catch (err) { toast(errMsg(err), true); }
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

  function checkTask(t, subs) {
    const ed = canEdit();
    const isDone = t.status === 'Done';
    const closed = ['Done', 'Skipped', 'Missed'].includes(t.status);
    const nDone = subs.filter((s) => s.done).length;
    return `<div class="b-task st-${slug(t.status)}">
      <div class="b-taskrow">
        <button class="b-tick${isDone ? ' on' : ''}" data-tick="${t.id}" data-done="${isDone ? 1 : 0}" aria-label="${isDone ? 'Mark not done' : 'Mark done'}: ${esc(t.name)}"${ed ? '' : ' disabled'}>✓</button>
        <div class="b-taskname"><b>${esc(t.name)}</b>
          <small>${[t.status === 'Skipped' ? 'Skipped' : t.status === 'Missed' ? 'Missed' : '', isDone && t.who ? `${t.who}, ${tshort(t.done_on)}` : '', !isDone ? t.includes : '']
            .filter(Boolean).map(esc).join(' · ')}</small></div>
        ${t.timer_started_at || t.worked_seconds ? `<span class="b-time num">${liveSpan(t)}</span>` : ''}
        ${ed && !closed ? `<button class="btn small${t.timer_started_at ? ' b-running' : ''}" data-cktimer="${t.id}" data-run="${t.timer_started_at ? 0 : 1}">${t.timer_started_at ? '■ Stop' : '▶ Start'}</button>` : ''}
      </div>
      ${subs.length && !closed ? `<details class="b-subs"><summary>${subs.length} steps <span class="b-subcount">${nDone}/${subs.length}</span></summary>
        ${subs.map((s) => `<label class="${s.done ? 'done' : ''}"><input type="checkbox" data-cksub="${s.id}"${s.done ? ' checked' : ''}${ed ? '' : ' disabled'}><span>${esc(s.name)}</span></label>`).join('')}
        ${ed ? `<button class="b-skip" data-skip="${t.id}">Skip this week</button>` : ''}</details>`
        : ed && !closed ? `<button class="b-skip solo" data-skip="${t.id}">Skip this week</button>` : ''}
    </div>`;
  }

  async function renderTimeLog(current) {
    const tasks = await q(sb.from('checklist_tasks').select('id, week_of, name, area, status, who, day, worked_seconds, manual_hours, done_on, timer_started_at').not('week_of', 'is', null).order('week_of', { ascending: false }).order('sort'));
    const weeks = [...new Set(tasks.map((t) => t.week_of))];
    const people = {};
    tasks.forEach((t) => { if (!t.who || !(t.worked_seconds || t.manual_hours)) return; t.who.split(',').map((x) => x.trim()).forEach((p) => { people[p] = (people[p] || 0) + liveSecs(t) + (t.manual_hours || 0) * 3600; }); });
    app.innerHTML = `
      <p><a href="#/checklist">← Checklist</a></p>
      <header class="page-head b-simplehead"><h1>Past weeks</h1></header>
      <p class="muted b-note">Every Sunday a fresh week starts. Anything not done becomes Missed.</p>
      <div class="table-wrap"><table class="b-table b-narrow"><tr><th>Week of</th><th class="num">Done</th><th class="num">Missed</th><th class="num">Time logged</th><th>Completion</th></tr>
        ${weeks.map((w) => {
          const ts = tasks.filter((t) => t.week_of === w); const c = (s) => ts.filter((t) => t.status === s).length;
          const pct = Math.round((c('Done') / ts.length) * 100);
          return `<tr><td><b>${dshort(w)}</b>${w === current ? ' <span class="pill planned">This week</span>' : ''}</td><td class="num">${c('Done')}</td><td class="num">${c('Missed')}</td>
            <td class="num">${dur(ts.reduce((a, t) => a + liveSecs(t) + (t.manual_hours || 0) * 3600, 0))}</td>
            <td><span class="b-progbar small"><i style="width:${pct}%"></i></span> ${pct}%</td></tr>`;
        }).join('')}</table></div>
      ${barList('Time logged by person, all weeks', Object.fromEntries(Object.entries(people).map(([k, v]) => [`${k} · ${dur(v)}`, Math.round(v / 60)])), 'Bars are minutes.')}
      ${weeks.map((w) => `<details class="b-group"><summary><span class="b-gname">Week of ${dshort(w)}</span><span class="muted">${tasks.filter((t) => t.week_of === w).length} tasks</span></summary>
        <div class="table-wrap"><table class="b-table"><tr><th>Task</th><th>Day</th><th>Area</th><th>Status</th><th>Who</th><th class="num">Time</th><th>Done on</th></tr>
        ${tasks.filter((t) => t.week_of === w).map((t) => `<tr><td>${esc(t.name)}</td><td>${esc(t.day || '')}</td><td>${esc(t.area || '')}</td><td><span class="b-pill s-${slug(t.status)}">${esc(t.status)}</span></td>
          <td>${esc(t.who || '')}</td><td class="num">${liveSecs(t) || t.manual_hours ? dur(liveSecs(t) + (t.manual_hours || 0) * 3600) : ''}</td><td class="muted">${tshort(t.done_on)}</td></tr>`).join('')}</table></div></details>`).join('')}`;
  }

  async function renderTemplate() {
    const [tasks, subs] = await Promise.all([
      q(sb.from('checklist_tasks').select('*').is('week_of', null).order('sort').order('id')),
      q(sb.from('checklist_subtasks').select('*, checklist_tasks!inner(week_of)').is('checklist_tasks.week_of', null).order('sort').order('id')),
    ]);
    const admin = isAdmin();
    app.innerHTML = `
      <p><a href="#/checklist">← Checklist</a></p>
      <header class="page-head b-simplehead"><h1>Weekly template</h1></header>
      <p class="muted b-note">${tasks.length} tasks, copied into a fresh week every Sunday. ${admin ? 'Changes show up from next week.' : 'Only admins can change it.'}</p>
      ${admin ? `<form id="tp-add" class="card b-inline"><input name="name" required placeholder="New task, e.g. Wipe lobby glass doors" aria-label="New task">
        <select name="day" aria-label="Day">${DAYS.map((d) => `<option>${d}</option>`).join('')}</select>
        <select name="area" aria-label="Area">${AREAS.map((a) => `<option>${a}</option>`).join('')}</select><button class="btn primary">Add</button></form>` : ''}
      ${DAYS.map((d) => {
        const items = tasks.filter((t) => (t.day || 'Detail Work') === d);
        if (!items.length) return '';
        return `<details class="b-group"><summary><span class="b-gname">${d}</span><span class="muted">${items.length} tasks</span></summary>
          <div class="table-wrap"><table class="b-table b-narrow"><tr><th>Task</th><th>Area</th><th class="num">Steps</th><th></th></tr>
          ${items.map((t) => `<tr><td><b>${esc(t.name)}</b>${t.includes ? `<br><small class="muted">${esc(t.includes)}</small>` : ''}</td><td>${esc(t.area || '')}</td><td class="num">${subs.filter((s) => s.task_id === t.id).length || ''}</td>
            <td style="text-align:right;white-space:nowrap">${admin ? `<button class="btn small" data-tpren="${t.id}">Rename</button> <button class="btn small bad" data-tpdel="${t.id}">Remove</button>` : ''}</td></tr>`).join('')}</table></div></details>`;
      }).join('')}`;
    const reload = () => renderChecklist('template');
    app.querySelector('#tp-add')?.addEventListener('submit', async (e) => {
      e.preventDefault(); const f = new FormData(e.target);
      try { await q(sb.from('checklist_tasks').insert({ name: f.get('name').trim(), day: f.get('day'), area: f.get('area'), sort: (tasks.at(-1)?.sort || 0) + 1 }).select('id')); toast('Added to the template'); reload(); } catch (err) { toast(errMsg(err), true); }
    });
    app.querySelectorAll('[data-tpren]').forEach((b) => b.addEventListener('click', async () => {
      const t = tasks.find((x) => x.id === Number(b.dataset.tpren));
      const name = await askText('Rename task', { value: t.name, ok: 'Rename' });
      if (!name || name === t.name) return;
      try { await q(sb.from('checklist_tasks').update({ name }).eq('id', t.id).select('id')); reload(); } catch (err) { toast(errMsg(err), true); }
    }));
    app.querySelectorAll('[data-tpdel]').forEach((b) => b.addEventListener('click', async () => {
      const t = tasks.find((x) => x.id === Number(b.dataset.tpdel));
      if (!(await askConfirm(`Remove "${t.name}" from the template?`, { message: 'This week and past weeks keep it. From next Sunday it won’t be added.', ok: 'Remove', danger: true }))) return;
      try { await q(sb.from('checklist_tasks').delete().eq('id', t.id).select('id')); reload(); } catch (err) { toast(errMsg(err), true); }
    }));
  }

  return { renderRequests, renderRequest, renderChecklist };
}

// Overview (Facilities admins' start page): every department at a glance —
// requests, custodial, maintenance, the team today, tools and stock, and the
// weekend plan. Each card links to its page.
import { weekendOf, loadWeekendWeather, wxCard } from './weather.js?v=__V__';

const pad = (n) => String(n).padStart(2, '0');
const isoOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dshort = (iso) => { const [, m, d] = String(iso).slice(0, 10).split('-').map(Number); return `${MON[m - 1]} ${d}`; };
const hm = (t) => { const [h, m] = String(t).split(':').map(Number); return `${h % 12 || 12}${m ? `:${pad(m)}` : ''} ${h < 12 ? 'AM' : 'PM'}`; };

export function overviewPages(ctx) {
  const { sb, q, rpc, esc, me } = ctx;
  const app = document.getElementById('app');
  const safe = (p, fallback) => p.catch(() => fallback);

  async function renderOverview() {
    const today = isoOf(new Date());
    const todayName = new Date().toLocaleDateString('en-US', { weekday: 'long' });
    const week = await safe(rpc('start_checklist_week', {}), null);
    await safe(rpc('pm_refresh'), null);
    const [reqs, ck, runs, tasks, members, off, outs, items, pulled, plan, wx, tools] = await Promise.all([
      safe(q(sb.from('maint_requests').select('id, subject, status, board_group, location, due_date, created_at, experts').neq('board_group', 'solved').order('created_at', { ascending: false })), []),
      week ? safe(q(sb.from('checklist_tasks').select('id, name, status, day, who').eq('week_of', week)), []) : [],
      safe(q(sb.from('pm_runs').select('*').order('due_on')), []),
      safe(q(sb.from('pm_tasks').select('id, name, frequency, active, parent_id')), []),
      safe(q(sb.from('team_members').select('id, name, role, active, team, work_hours')), []),
      safe(q(sb.from('time_off').select('*').lte('starts_on', today).gte('ends_on', today)), []),
      safe(q(sb.from('tool_checkouts').select('id, tool_id, borrower_id, checked_out_at').is('returned_at', null)), []),
      safe(q(sb.from('items').select('id, name, quantity, reorder_level, category').eq('active', true)), []),
      safe(q(sb.from('pulled_work').select('*').eq('day', today).is('ended_at', null)), []),
      safe(rpc('get_gameplan', { p_weekend: weekendOf()[1] }).then((r) => (Array.isArray(r) ? r[0] : r) || null), null),
      safe(loadWeekendWeather(), null),
      safe(q(sb.from('tools').select('id, name')), []),
    ]);
    const toolName = Object.fromEntries(tools.map((t) => [t.id, t.name]));
    const who = Object.fromEntries(members.map((m) => [m.id, m.name]));
    const first = (n) => String(n || '').split(' ')[0];

    // Requests
    const isNew = reqs.filter((r) => r.status === 'New');
    const late = reqs.filter((r) => r.due_date && r.due_date < today);
    const working = reqs.filter((r) => r.status === 'In Progress');
    // Custodial (today)
    const ckToday = ck.filter((t) => (t.day || '') === todayName);
    const ckDone = ckToday.filter((t) => t.status === 'Done').length;
    const ckWeekDone = ck.filter((t) => t.status === 'Done').length;
    const ckNow = ck.filter((t) => t.status === 'Working on it');
    // Maintenance
    const taskBy = Object.fromEntries(tasks.map((t) => [t.id, t]));
    const cur = runs.filter((r) => taskBy[r.task_id]?.active && r.period_start <= today && (r.period_end >= today || (taskBy[r.task_id].frequency === 'once' && r.status === 'open')));
    const pmOpen = cur.filter((r) => r.status === 'open');
    const pmLate = pmOpen.filter((r) => r.due_on < today);
    const pmSoon = pmOpen.filter((r) => r.due_on >= today && (new Date(`${r.due_on}T12:00:00`) - new Date(`${today}T12:00:00`)) / 864e5 <= 7);
    const pmDone = cur.filter((r) => r.status === 'done').length;
    // Team today
    const crew = members.filter((m) => m.active && !['kiosk', 'none'].includes(m.role));
    const outIds = new Set(off.filter((o) => !o.part).map((o) => o.member_id));
    const key = DAY_KEYS[new Date().getDay()];
    const working_today = crew.filter((m) => (m.work_hours || {})[key] && !outIds.has(m.id));
    const outToday = off.map((o) => `${first(who[o.member_id])}${o.part ? ` (${o.part.toLowerCase()})` : ''} · ${o.kind}`);
    // Where people are: what each person is on right now.
    const hue = (n) => ['#11404b', '#2f5d8a', '#8a6630', '#3c418f', '#9b2763', '#a3470f', '#2d6a62', '#6a4cf0'][[...String(n)].reduce((a, c) => a + c.charCodeAt(0), 0) % 8];
    const has = (list, name) => String(list || '').split(',').map((x) => x.trim().toLowerCase()).some((x) => x && (x === name.toLowerCase() || x === first(name).toLowerCase()));
    const since = (iso) => { const m = Math.max(0, Math.round((Date.now() - new Date(iso)) / 60000)); return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${pad(m % 60)}m`; };
    const where = crew.map((m) => {
      const h = (m.work_hours || {})[key];
      const offRow = off.find((o) => o.member_id === m.id);
      const p = pulled.find((x) => x.member_id === m.id);
      const r = working.find((x) => (x.experts || []).some((e) => has(e, m.name)));
      const c = ckNow.find((x) => has(x.who, m.name));
      const tl = outs.find((x) => x.borrower_id === m.id);
      let tag; let text; let rank = 1;
      if (offRow && !offRow.part) { tag = ['Out', 'out']; text = `Out today · ${offRow.kind}`; rank = 3; }
      else if (p) { tag = ['Pulled', 'work']; text = `<b>${esc(p.what)}</b>${p.location ? ` · ${esc(p.location)}` : ''} · ${since(p.started_at)}`; rank = 0; }
      else if (r) { tag = ['Request', 'new']; text = `<b>${esc(r.subject)}</b>${r.location ? ` · ${esc(r.location)}` : ''}`; rank = 0; }
      else if (c) { tag = ['Custodial', 'work']; text = `<b>${esc(c.name)}</b>`; rank = 0; }
      else if (tl) { tag = ['Tool', 'out']; text = `Has the <b>${esc(toolName[tl.tool_id] || 'a tool')}</b> since ${esc(new Date(tl.checked_out_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }))}`; rank = 0; }
      else if (h) { tag = ['Free', 'free']; text = 'Not on anything right now'; }
      else { tag = ['Off', 'free']; text = 'Not scheduled today'; rank = 4; }
      return { m, tag, text, rank, hours: h && !(offRow && !offRow.part) ? `${hm(h.start)} – ${hm(h.end)}${offRow?.part ? ` · ${offRow.part.toLowerCase()} off` : ''}` : '' };
    }).sort((a, b) => a.rank - b.rank || a.m.name.localeCompare(b.m.name));

    // Tools and stock
    const low = items.filter((i) => i.reorder_level > 0 && i.quantity <= i.reorder_level);

    const card = (href, title, dept, body) => `<a class="ov-card ${dept}" href="${href}"><div class="ov-head"><h3>${title}</h3><span class="ov-go">Open ›</span></div>${body}</a>`;
    const nums = (list) => `<div class="ov-nums">${list.map(([n, l, cls = '']) => `<div class="${cls}"><b>${n}</b><span>${l}</span></div>`).join('')}</div>`;
    const lines = (arr, empty) => (arr.length ? `<ul class="ov-list">${arr.map((x) => `<li>${x}</li>`).join('')}</ul>` : `<p class="ov-empty">${empty}</p>`);
    const greet = new Date().getHours() < 12 ? 'Good morning' : new Date().getHours() < 17 ? 'Good afternoon' : 'Good evening';

    app.innerHTML = `
      <header class="page-head"><div class="eyebrow">Facilities</div><h1>${greet}, <span class="accent">${esc(first(me()?.name))}</span>.</h1>
        <p class="lede">All your departments today: ${esc(new Date().toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' }))}.</p></header>
      <section class="ov-where"><div class="ov-where-head"><h2>Where people are</h2><a href="#/team">Team schedule ›</a></div>
        <div class="ov-people">${where.map(({ m, tag, text, hours }) => `<div class="ov-person${tag[0] === 'Out' || tag[0] === 'Off' ? ' away' : ''}">
          <span class="ov-av" style="background:${hue(m.name)}">${esc(m.name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase())}</span>
          <span class="ov-who"><span><b>${esc(m.name)}</b>${m.team ? ` <span class="muted">· ${esc(m.team)}</span>` : ''}</span><small>${text}</small></span>
          ${hours ? `<span class="ov-hrs">${esc(hours)}</span>` : ''}<span class="ov-tag ${tag[1]}">${tag[0]}</span></div>`).join('') || '<p class="ov-empty">No one on the team list yet.</p>'}</div></section>
      <div class="ov-grid">
        ${card('#/requests', 'Requests', 'ov-req', nums([[reqs.length, 'open'], [isNew.length, 'new', isNew.length ? 'hot' : ''], [late.length, 'past due', late.length ? 'bad' : '']])
          + lines([...working.slice(0, 2).map((r) => `<span class="ov-pill work">Working</span> ${esc(r.subject)}${r.experts?.length ? ` <span class="muted">· ${esc(r.experts.map(first).join(', '))}</span>` : ''}`),
            ...isNew.slice(0, 3).map((r) => `<span class="ov-pill new">New</span> ${esc(r.subject)}${r.location ? ` <span class="muted">· ${esc(r.location)}</span>` : ''}`)], 'Nothing new.'))}
        ${card('#/checklist', 'Custodial', 'ov-cus', `<div class="ov-prog"><div class="ov-bar"><i style="width:${ckToday.length ? Math.round((ckDone / ckToday.length) * 100) : 0}%"></i></div><span><b>${ckDone} of ${ckToday.length}</b> done today · ${ckWeekDone} of ${ck.length} this week</span></div>`
          + lines([...ckNow.map((t) => `<span class="ov-pill work">Now</span> ${esc(t.name)}${t.who ? ` <span class="muted">· ${esc(t.who)}</span>` : ''}`),
            ...ckToday.filter((t) => !['Done', 'Skipped', 'Working on it'].includes(t.status)).slice(0, 3).map((t) => `<span class="ov-pill todo">To do</span> ${esc(t.name)}`)], ckToday.length ? 'All done for today.' : 'Nothing on today\'s list.'))}
        ${card('#/schedule', 'Maintenance', 'ov-mnt', nums([[pmLate.length, 'overdue', pmLate.length ? 'bad' : ''], [pmSoon.length, 'due in 7 days'], [`${pmDone}/${cur.length}`, 'done this period']])
          + lines(pmOpen.slice(0, 4).map((r) => `<span class="ov-pill ${r.due_on < today ? 'late' : 'todo'}">${r.due_on < today ? 'Late' : `Due ${dshort(r.due_on)}`}</span> ${esc(taskBy[r.task_id].name)}`), 'Nothing due right now.'))}
        ${card('#/team', 'Team today', 'ov-team', nums([[working_today.length, 'working'], [off.length, 'out', off.length ? 'hot' : ''], [pulled.length, 'pulled off plan']])
          + lines([...outToday.map((t) => `<span class="ov-pill out">Out</span> ${esc(t)}`),
            ...pulled.map((p) => `<span class="ov-pill work">Pulled</span> ${esc(first(who[p.member_id]))} · ${esc(p.what)}`)], working_today.length ? `On today: ${working_today.map((m) => esc(first(m.name))).join(', ')}` : 'No hours set for today.'))}
        ${card('#/out', 'Tools & stock', 'ov-tools', nums([[outs.length, 'tools out'], [low.length, 'low on stock', low.length ? 'hot' : '']])
          + lines([...outs.slice(0, 3).map((c) => `<span class="ov-pill out">Out</span> ${esc(toolName[c.tool_id] || 'A tool')} <span class="muted">· ${esc(first(who[c.borrower_id]))}</span>`),
            ...low.slice(0, 3).map((i) => `<span class="ov-pill late">Low</span> ${esc(i.name)} <span class="muted">· ${i.quantity} left</span>`)], 'All tools in, nothing low.'))}
        ${card('#/gameplan', 'This weekend', 'ov-wx', wx ? wxCard(wx, plan) : `<p class="ov-empty">${plan ? 'Plan posted.' : 'No plan yet.'}</p>`)}
      </div>`;
  }

  return { renderOverview };
}

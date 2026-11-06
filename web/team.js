// Team schedule: days off, vacation, sick days and so on, for everyone on all
// three sites. Anyone adds their own; admins add anyone's. See 0032_time_off.sql.

const KINDS = ['Day off', 'Vacation', 'Sick', 'Out of office', 'Other'];
const KIND_CLASS = { 'Day off': 'k-off', Vacation: 'k-vac', Sick: 'k-sick', 'Out of office': 'k-ooo', Other: 'k-other' };
const MONTH = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MON = MONTH.map((m) => m.slice(0, 3));
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromIso = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = fromIso(s); d.setDate(d.getDate() + n); return iso(d); };
const short = (s) => { const d = fromIso(s); return `${DOW[d.getDay()]} ${MON[d.getMonth()]} ${d.getDate()}`; };
const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const DEFAULT_TEAMS = ['Maintenance', 'Custodial'];
// "08:00" -> "8a", "16:30" -> "4:30p"
const hm = (t) => { const [h, m] = t.split(':').map(Number); return `${h % 12 || 12}${m ? `:${pad(m)}` : ''}${h < 12 ? 'a' : 'p'}`; };
const hours = (h) => (h ? `${hm(h.start)}–${hm(h.end)}` : '');
let weekOffset = 0;   // the "This week" view: 0 = this week, -1 = last week, ...
let teamFilter = '';
const span = (r) => (r.starts_on === r.ends_on ? `${short(r.starts_on)}${r.part ? ` (${r.part.toLowerCase()})` : ''}` : `${short(r.starts_on)} – ${short(r.ends_on)}`);

export function teamPages(ctx) {
  const { sb, q, rpc, esc, toast, askConfirm, errMsg, pageHead, me, canManage, canEditPerson } = ctx;
  const app = document.getElementById('app');

  async function renderTeam(monthArg) {
    const today = iso(new Date());
    const ym = /^\d{4}-\d{2}$/.test(monthArg || '') ? monthArg : today.slice(0, 7);
    const first = `${ym}-01`;
    const firstD = fromIso(first);
    const gridStart = addDays(first, -firstD.getDay());
    const last = iso(new Date(firstD.getFullYear(), firstD.getMonth() + 1, 0));
    const gridEnd = addDays(last, 6 - fromIso(last).getDay());
    const listEnd = addDays(today, 90);
    const weekStart = addDays(today, -fromIso(today).getDay() + weekOffset * 7);
    const weekDays = [0, 1, 2, 3, 4, 5, 6].map((i) => addDays(weekStart, i));
    const from = [gridStart, today, weekStart].sort()[0];
    const to = [gridEnd, listEnd, weekDays[6]].sort()[2];
    const [rows, members] = await Promise.all([
      q(sb.from('time_off').select('*').lte('starts_on', to).gte('ends_on', from).order('starts_on')),
      // Team and hours need the 0034 database update; until it's in, show the rest without them.
      q(sb.from('team_members').select('id, name, active, role, media_role, events_role, team, work_hours').order('name'))
        .catch(() => q(sb.from('team_members').select('id, name, active, role, media_role, events_role').order('name')).then((ms) => ms.map((m) => ({ ...m, noHours: true })))),
    ]);
    const hoursReady = !members.some((m) => m.noHours);
    const who = Object.fromEntries(members.map((m) => [m.id, m.name]));
    const mine = (r) => r.member_id === me()?.id;
    const manage = canManage();
    const on = (day) => rows.filter((r) => r.starts_on <= day && r.ends_on >= day);
    const outToday = on(today);
    const upcoming = rows.filter((r) => r.ends_on >= today && r.starts_on <= listEnd);
    const prev = iso(new Date(firstD.getFullYear(), firstD.getMonth() - 1, 1)).slice(0, 7);
    const next = iso(new Date(firstD.getFullYear(), firstD.getMonth() + 1, 1)).slice(0, 7);
    const pill = (r) => `<button type="button" data-to-info="${r.id}" class="to-pill ${KIND_CLASS[r.kind]}" title="${esc(`${who[r.member_id] || ''} · ${r.kind}${r.part ? ` (${r.part})` : ''}${r.note ? ` · ${r.note}` : ''}`)}">${esc((who[r.member_id] || '?').split(' ')[0])}${r.part ? ' ½' : ''}</button>`;

    const days = [];
    for (let d = gridStart; d <= gridEnd; d = addDays(d, 1)) days.push(d);

    // Who works when: the Facilities team (not the shared iPad), grouped by team.
    const people = members.filter((m) => m.active && !['kiosk', 'none'].includes(m.role));
    const teams = [...new Set([...DEFAULT_TEAMS, ...people.map((m) => m.team).filter(Boolean)])];
    const shownTeams = [...teams.filter((t) => people.some((m) => m.team === t)), ...(people.some((m) => !m.team) ? [''] : [])];
    const offOn = (m, day) => rows.find((r) => r.member_id === m.id && r.starts_on <= day && r.ends_on >= day);
    const shift = (m, day) => (m.work_hours || {})[DAY_KEYS[fromIso(day).getDay()]];
    const workingToday = people.filter((m) => shift(m, today) && !(offOn(m, today) && !offOn(m, today).part));
    const cell = (m, day) => {
      const off = offOn(m, day);
      const h = shift(m, day);
      if (off && !off.part) return `<button type="button" data-to-info="${off.id}" class="to-pill ${KIND_CLASS[off.kind]}">${esc(off.kind)}</button>`;
      if (off) return `${h ? `<span class="wk-hours k-work">${hours(h)}</span>` : ''}<button type="button" data-to-info="${off.id}" class="to-pill ${KIND_CLASS[off.kind]}">${esc(off.kind)} ${off.part === 'Morning' ? 'AM' : 'PM'}</button>`;
      return h ? `<span class="wk-hours k-work">${hours(h)}</span>` : '<span class="wk-off">Off</span>';
    };
    // Month calendar: time off first, then who's working that day (green).
    const dayEntries = (d) => {
      const offs = on(d).filter((r) => !teamFilter || (members.find((m) => m.id === r.member_id)?.team || '') === teamFilter);
      const offWhole = new Set(offs.filter((r) => !r.part).map((r) => r.member_id));
      const working = !hoursReady ? [] : people.filter((m) => (!teamFilter || (m.team || '') === teamFilter) && shift(m, d) && !offWhole.has(m.id));
      return [...offs.map(pill), ...working.map((m) => `<span class="to-pill k-work" title="${esc(`${m.name} · ${hours(shift(m, d))}`)}">${esc(m.name.split(' ')[0])}</span>`)];
    };
    const monthCal = `<div class="to-monthbar"><a class="btn small" href="#/team/${prev}" aria-label="Previous month">‹</a><h2>${MONTH[firstD.getMonth()]} ${firstD.getFullYear()}</h2><a class="btn small" href="#/team/${next}" aria-label="Next month">›</a>
        ${ym !== today.slice(0, 7) ? '<a class="btn small" href="#/team">This month</a>' : ''}
        <span class="to-legend">${hoursReady ? '<span class="to-pill k-work">Working</span>' : ''}${KINDS.map((k) => `<span class="to-pill ${KIND_CLASS[k]}">${k}</span>`).join('')}</span></div>
      <div class="to-grid">${DOW.map((d) => `<div class="to-dow">${d}</div>`).join('')}
        ${days.map((d) => { const dd = fromIso(d); const list = dayEntries(d); return `<div class="to-day${d.slice(0, 7) !== ym ? ' other' : ''}${d === today ? ' today' : ''}${dd.getDay() % 6 === 0 ? ' weekend' : ''}">
          <span class="to-num">${dd.getDate()}</span>${list.slice(0, 5).join('')}${list.length > 5 ? `<span class="muted to-more">+${list.length - 5} more</span>` : ''}</div>`; }).join('')}
      </div>`;
    const weekLabel = `${MON[fromIso(weekStart).getMonth()]} ${fromIso(weekStart).getDate()} – ${MON[fromIso(weekDays[6]).getMonth()]} ${fromIso(weekDays[6]).getDate()}`;
    const weekTable = !hoursReady ? '' : `<div class="wk-bar"><button class="btn small" data-wk="-1" aria-label="Previous week">‹</button><h2>${weekOffset === 0 ? 'This week' : weekOffset === 1 ? 'Next week' : weekOffset === -1 ? 'Last week' : 'Week'} <span class="muted">${weekLabel}</span></h2><button class="btn small" data-wk="1" aria-label="Next week">›</button>
        ${weekOffset ? '<button class="btn small" data-wk="0">This week</button>' : ''}
        <span class="wk-filter">${['', ...shownTeams.filter(Boolean)].map((t) => `<button class="chip-btn${teamFilter === t ? ' on' : ''}" data-team="${esc(t)}">${t ? esc(t) : 'Everyone'}</button>`).join('')}</span></div>
      <div class="table-wrap wk-wrap"><table class="wk-table"><tr><th>Person</th>${weekDays.map((d) => `<th class="${d === today ? 'today' : ''}">${DOW[fromIso(d).getDay()]} ${fromIso(d).getDate()}</th>`).join('')}</tr>
        ${shownTeams.filter((t) => !teamFilter || t === teamFilter).map((t) => `<tr class="wk-team"><td colspan="8">${t ? esc(t) : 'No team yet'}</td></tr>
          ${people.filter((m) => (m.team || '') === t).map((m) => `<tr><td class="wk-name">${canEditPerson(m) ? `<button class="wk-edit" data-person="${m.id}" title="Set ${esc(m.name)}'s team and hours">${esc(m.name)} <span aria-hidden="true">✎</span></button>` : esc(m.name)}</td>
            ${weekDays.map((d) => `<td class="${d === today ? 'today' : ''}">${cell(m, d)}</td>`).join('')}</tr>`).join('')}`).join('')}
      </table></div>
      ${people.some((m) => canEditPerson(m)) ? '<p class="muted wk-hint">Tap a name to set their team and regular hours. Time off on the schedule covers their hours automatically.</p>' : ''}`;

    app.innerHTML = `
      ${pageHead('Facilities team', 'Team <span class="accent">schedule</span>', 'Who works when, and who\'s out. Add your days off so the team can plan around it.')}
      ${monthCal}
      ${!hoursReady ? '' : `<div class="to-today card"><b>Working today</b>${workingToday.length ? workingToday.map((m) => `<span class="to-chip wk-in">${esc(m.name)} · ${hours(shift(m, today))}</span>`).join('') : '<span class="muted">No hours set for today yet.</span>'}</div>`}
      <div class="to-today card"><b>Out today</b>${outToday.length ? outToday.map((r) => `<button type="button" data-to-info="${r.id}" class="to-chip ${KIND_CLASS[r.kind]}">${esc(who[r.member_id] || '?')} · ${esc(r.kind)}${r.part ? ` (${r.part.toLowerCase()})` : ''}</button>`).join('') : '<span class="muted">Everyone is in.</span>'}</div>
      ${weekTable}
      <details class="card" id="to-add-card"><summary><b>+ Add time off</b></summary>
        <form id="to-add" style="margin-top:12px">
          <div class="row">
            ${manage ? `<label style="flex:1;min-width:180px">Who <select name="member">${people.map((m) => `<option value="${m.id}" ${m.id === me()?.id ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}</select></label>` : ''}
            <label style="width:170px">What <select name="kind">${KINDS.map((k) => `<option>${k}</option>`).join('')}</select></label>
            <label>From <input type="date" name="start" required value="${today}"></label>
            <label>To <input type="date" name="end" value="${today}"></label>
            <label style="width:150px">Day <select name="part"><option value="">Whole day</option><option>Morning</option><option>Afternoon</option></select></label>
          </div>
          <label style="margin-top:10px">Note <span class="muted">(optional)</span><input name="note" placeholder="Out of town, back Monday"></label>
          <div style="margin-top:12px"><button class="btn primary">Add</button></div>
        </form></details>
      <h2>Coming up</h2>
      <div class="to-list">${upcoming.length ? upcoming.map((r) => `<div class="to-row">
          <span class="to-dot ${KIND_CLASS[r.kind]}"></span>
          <div class="to-rowtext"><b>${esc(who[r.member_id] || 'Someone')}</b> · ${esc(r.kind)}<span class="muted">${span(r)}${r.note ? ` · ${esc(r.note)}` : ''}</span></div>
          ${mine(r) || manage ? `<button class="btn small" data-to-del="${r.id}">Remove</button>` : ''}</div>`).join('')
        : '<p class="muted">Nobody has time off in the next 90 days.</p>'}</div>`;

    const form = app.querySelector('#to-add');
    const start = form.querySelector('[name=start]');
    const end = form.querySelector('[name=end]');
    start.addEventListener('change', () => { if (!end.value || end.value < start.value) end.value = start.value; });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = new FormData(form);
      try {
        await rpc('time_off_add', { p_member: f.get('member') || null, p_kind: f.get('kind'), p_start: f.get('start'), p_end: f.get('end') || f.get('start'),
          p_part: f.get('part') || null, p_note: f.get('note') || null });
        toast('Added to the team schedule');
        renderTeam(ym);
      } catch (err) { toast(errMsg(err), true); }
    });
    app.querySelectorAll('[data-wk]').forEach((b) => b.addEventListener('click', () => {
      weekOffset = b.dataset.wk === '0' ? 0 : weekOffset + Number(b.dataset.wk);
      renderTeam(ym);
    }));
    app.querySelectorAll('[data-team]').forEach((b) => b.addEventListener('click', () => { teamFilter = b.dataset.team; renderTeam(ym); }));
    app.querySelectorAll('[data-person]').forEach((b) => b.addEventListener('click', async () => {
      const m = members.find((x) => x.id === b.dataset.person);
      if (await editPerson(m, teams)) renderTeam(ym);
    }));
    // Tap any time off (calendar, week view, Out today) for the full details.
    app.querySelectorAll('[data-to-info]').forEach((b) => b.addEventListener('click', async () => {
      const r = rows.find((x) => x.id === Number(b.dataset.toInfo));
      if (r && (await showInfo(r, who, mine(r) || manage))) renderTeam(ym);
    }));
    app.querySelectorAll('[data-to-del]').forEach((b) => b.addEventListener('click', async () => {
      if (!(await askConfirm('Remove this time off?', { ok: 'Remove', danger: true }))) return;
      try { await rpc('time_off_remove', { p_id: Number(b.dataset.toDel) }); toast('Removed'); renderTeam(ym); } catch (err) { toast(errMsg(err), true); }
    }));
  }

  // Full details of one time off, with Remove for its owner or an admin.
  function showInfo(r, who, canRemove) {
    const days = Math.round((fromIso(r.ends_on) - fromIso(r.starts_on)) / 864e5) + 1;
    return new Promise((resolve) => {
      const back = document.createElement('div');
      back.className = 'modal-back';
      back.innerHTML = `<div class="modal to-info" role="dialog" aria-modal="true" aria-labelledby="to-info-title">
        <span class="to-chip ${KIND_CLASS[r.kind]}">${esc(r.kind)}</span>
        <h3 id="to-info-title">${esc(who[r.member_id] || 'Someone')}</h3>
        <dl>
          <dt>When</dt><dd>${span(r)}${r.part ? '' : ` · ${days} day${days === 1 ? '' : 's'}`}</dd>
          ${r.note ? `<dt>Note</dt><dd>${esc(r.note)}</dd>` : ''}
          ${r.created_by ? `<dt>Added by</dt><dd>${esc(who[r.created_by] || 'Someone')}${r.created_at ? ` · ${new Date(r.created_at).toLocaleDateString([], { month: 'short', day: 'numeric' })}` : ''}</dd>` : ''}
        </dl>
        <div class="modal-actions">${canRemove ? '<button type="button" class="btn bad" data-remove>Remove</button>' : ''}<button type="button" class="btn primary" data-close>Close</button></div>
      </div>`;
      const done = (v) => { document.removeEventListener('keydown', onKey, true); back.remove(); resolve(v); };
      const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); done(false); } };
      document.addEventListener('keydown', onKey, true);
      back.addEventListener('click', (e) => { if (e.target === back) done(false); });
      back.querySelector('[data-close]').addEventListener('click', () => done(false));
      back.querySelector('[data-remove]')?.addEventListener('click', async () => {
        try { await rpc('time_off_remove', { p_id: r.id }); toast('Removed'); done(true); } catch (err) { toast(errMsg(err), true); }
      });
      document.body.appendChild(back);
      back.querySelector('[data-close]').focus();
    });
  }

  // Set someone's team and regular weekly hours.
  // Set someone's team and regular hours: tap the days, tap a shift. Custom times
  // and different hours on different days are there when needed.
  const SHIFTS = [['06:00', '14:30'], ['07:00', '15:30'], ['07:30', '16:00'], ['08:00', '16:30'], ['08:00', '17:00'], ['09:00', '17:30']];
  function editPerson(m, teams) {
    const cur = m.work_hours || {};
    const set = DAY_KEYS.filter((k) => cur[k]);
    const kinds = new Set(set.map((k) => `${cur[k].start}-${cur[k].end}`));
    let days = new Set(set.length ? set : ['mon', 'tue', 'wed', 'thu', 'fri']);
    let same = kinds.size <= 1;
    let shift = set.length ? [cur[set[0]].start, cur[set[0]].end] : ['08:00', '16:30'];
    const timeOpts = (sel) => { const o = []; for (let t = 5 * 60; t <= 22 * 60; t += 30) { const v = `${pad(Math.floor(t / 60))}:${pad(t % 60)}`; o.push(`<option value="${v}" ${v === sel ? 'selected' : ''}>${hm(v)}</option>`); } if (sel && !o.some((x) => x.includes(`"${sel}"`))) o.push(`<option value="${sel}" selected>${hm(sel)}</option>`); return o.join(''); };
    return new Promise((resolve) => {
      const back = document.createElement('div');
      back.className = 'modal-back';
      back.innerHTML = `<form class="modal wk-modal" role="dialog" aria-modal="true" aria-labelledby="wk-title">
        <h3 id="wk-title">${esc(m.name)}</h3>
        <div class="wk-sect">Team</div>
        <div class="wk-chips" data-teams>${teams.map((t) => `<button type="button" class="chip-btn${(m.team || '') === t ? ' on' : ''}" data-team-pick="${esc(t)}">${esc(t)}</button>`).join('')}
          <input name="team" value="${esc(m.team || '')}" placeholder="Other team…" autocomplete="off" class="wk-teamtext"></div>
        <div class="wk-sect">Works on <button type="button" class="dp-link" data-days="mon tue wed thu fri">Mon–Fri</button><button type="button" class="dp-link" data-days="">None</button></div>
        <div class="wk-chips" data-daychips>${DAY_KEYS.map((k, i) => `<button type="button" class="chip-btn day" data-day="${k}">${DOW[i]}</button>`).join('')}</div>
        <div data-same>
          <div class="wk-sect">Hours</div>
          <div class="wk-chips">${SHIFTS.map(([a, b]) => `<button type="button" class="chip-btn" data-shift="${a}-${b}">${hm(a)}–${hm(b)}</button>`).join('')}</div>
          <div class="wk-custom"><span class="muted">or</span><select name="s_start" aria-label="Start">${timeOpts(shift[0])}</select><span class="muted">to</span><select name="s_end" aria-label="End">${timeOpts(shift[1])}</select></div>
        </div>
        <div data-perday hidden><div class="wk-days">${DAY_KEYS.map((k, i) => `<div class="wk-dayrow" data-row="${k}"><b>${DOW[i]}</b>
            <select name="start_${k}" aria-label="${DOW[i]} start">${timeOpts(cur[k]?.start || shift[0])}</select><span class="muted">to</span>
            <select name="end_${k}" aria-label="${DOW[i]} end">${timeOpts(cur[k]?.end || shift[1])}</select></div>`).join('')}</div></div>
        <button type="button" class="dp-link wk-toggle" data-toggle></button>
        <p class="wk-summary" data-summary></p>
        <div class="modal-actions"><button type="button" class="btn" data-cancel>Cancel</button><button class="btn primary">Save</button></div>
      </form>`;
      const form = back.querySelector('form');
      const $ = (sel) => form.querySelector(sel);
      const sync = () => {
        form.querySelectorAll('[data-day]').forEach((b) => b.classList.toggle('on', days.has(b.dataset.day)));
        form.querySelectorAll('[data-shift]').forEach((b) => b.classList.toggle('on', b.dataset.shift === `${shift[0]}-${shift[1]}`));
        form.querySelectorAll('[data-team-pick]').forEach((b) => b.classList.toggle('on', b.dataset.teamPick === $('[name=team]').value.trim()));
        $('[data-same]').hidden = !same;
        $('[data-perday]').hidden = same;
        form.querySelectorAll('[data-row]').forEach((r) => { r.hidden = !days.has(r.dataset.row); });
        $('[data-toggle]').textContent = same ? 'Different hours on different days?' : 'Same hours every day';
        const list = DAY_KEYS.filter((k) => days.has(k));
        $('[data-summary]').textContent = !list.length ? 'Not on the schedule (no regular hours).'
          : same ? `${list.map((k) => DOW[DAY_KEYS.indexOf(k)]).join(', ')} · ${hm(shift[0])}–${hm(shift[1])}`
            : list.map((k) => `${DOW[DAY_KEYS.indexOf(k)]} ${hm($(`[name=start_${k}]`).value)}–${hm($(`[name=end_${k}]`).value)}`).join(' · ');
      };
      form.querySelectorAll('[data-day]').forEach((b) => b.addEventListener('click', () => { days.has(b.dataset.day) ? days.delete(b.dataset.day) : days.add(b.dataset.day); sync(); }));
      form.querySelectorAll('[data-days]').forEach((b) => b.addEventListener('click', () => { days = new Set(b.dataset.days.split(' ').filter(Boolean)); sync(); }));
      form.querySelectorAll('[data-shift]').forEach((b) => b.addEventListener('click', () => {
        shift = b.dataset.shift.split('-');
        $('[name=s_start]').value = shift[0];
        $('[name=s_end]').value = shift[1];
        sync();
      }));
      form.querySelectorAll('[data-team-pick]').forEach((b) => b.addEventListener('click', () => { $('[name=team]').value = b.dataset.teamPick; sync(); }));
      $('[name=team]').addEventListener('input', sync);
      $('[name=s_start]').addEventListener('change', (e) => { shift = [e.target.value, shift[1]]; sync(); });
      $('[name=s_end]').addEventListener('change', (e) => { shift = [shift[0], e.target.value]; sync(); });
      form.querySelectorAll('[data-row] select').forEach((x) => x.addEventListener('change', sync));
      $('[data-toggle]').addEventListener('click', () => {
        // Going to per-day starts every day from the shift picked so far.
        if (same) DAY_KEYS.forEach((k) => { if (!cur[k] || kinds.size <= 1) { $(`[name=start_${k}]`).value = shift[0]; $(`[name=end_${k}]`).value = shift[1]; } });
        same = !same;
        sync();
      });
      sync();
      const done = (v) => { document.removeEventListener('keydown', onKey, true); back.remove(); resolve(v); };
      const onKey = (e) => { if (e.key === 'Escape' && !document.querySelector('.dd-menu')) { e.preventDefault(); done(false); } };
      document.addEventListener('keydown', onKey, true);
      $('[data-cancel]').addEventListener('click', () => done(false));
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const hrs = {};
        DAY_KEYS.filter((k) => days.has(k)).forEach((k) => {
          hrs[k] = same ? { start: shift[0], end: shift[1] } : { start: $(`[name=start_${k}]`).value, end: $(`[name=end_${k}]`).value };
        });
        try {
          await rpc('set_member_schedule', { p_member: m.id, p_team: $('[name=team]').value.trim() || null, p_hours: hrs });
          toast(`Saved ${m.name}'s schedule`);
          done(true);
        } catch (err) { toast(errMsg(err), true); }
      });
      document.body.appendChild(back);
    });
  }

  return { renderTeam };
}

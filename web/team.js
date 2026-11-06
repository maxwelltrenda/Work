// Team schedule: days off, vacation, sick days and so on, for everyone on all
// three sites. Anyone adds their own; admins add anyone's. See 0032_time_off.sql.

const KINDS = ['Day off', 'Vacation', 'Sick', 'Training', 'Out of office', 'Other'];
const KIND_CLASS = { 'Day off': 'k-off', Vacation: 'k-vac', Sick: 'k-sick', Training: 'k-train', 'Out of office': 'k-ooo', Other: 'k-other' };
const MONTH = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MON = MONTH.map((m) => m.slice(0, 3));
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromIso = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = fromIso(s); d.setDate(d.getDate() + n); return iso(d); };
const short = (s) => { const d = fromIso(s); return `${DOW[d.getDay()]} ${MON[d.getMonth()]} ${d.getDate()}`; };
const span = (r) => (r.starts_on === r.ends_on ? `${short(r.starts_on)}${r.part ? ` (${r.part.toLowerCase()})` : ''}` : `${short(r.starts_on)} – ${short(r.ends_on)}`);

export function teamPages(ctx) {
  const { sb, q, rpc, esc, toast, askConfirm, errMsg, pageHead, me, canManage } = ctx;
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
    const from = gridStart < today ? gridStart : today;
    const to = gridEnd > listEnd ? gridEnd : listEnd;
    const [rows, members] = await Promise.all([
      q(sb.from('time_off').select('*').lte('starts_on', to).gte('ends_on', from).order('starts_on')),
      q(sb.from('team_members').select('id, name, active').order('name')),
    ]);
    const who = Object.fromEntries(members.map((m) => [m.id, m.name]));
    const mine = (r) => r.member_id === me()?.id;
    const manage = canManage();
    const on = (day) => rows.filter((r) => r.starts_on <= day && r.ends_on >= day);
    const outToday = on(today);
    const upcoming = rows.filter((r) => r.ends_on >= today && r.starts_on <= listEnd);
    const prev = iso(new Date(firstD.getFullYear(), firstD.getMonth() - 1, 1)).slice(0, 7);
    const next = iso(new Date(firstD.getFullYear(), firstD.getMonth() + 1, 1)).slice(0, 7);
    const pill = (r) => `<span class="to-pill ${KIND_CLASS[r.kind]}" title="${esc(`${who[r.member_id] || ''} · ${r.kind}${r.part ? ` (${r.part})` : ''}${r.note ? ` · ${r.note}` : ''}`)}">${esc((who[r.member_id] || '?').split(' ')[0])}${r.part ? ' ½' : ''}</span>`;

    const days = [];
    for (let d = gridStart; d <= gridEnd; d = addDays(d, 1)) days.push(d);

    app.innerHTML = `
      ${pageHead('Team', 'Team <span class="accent">schedule</span>', 'Days off, vacation and time out for everyone. Add yours so the team can plan around it.')}
      <div class="to-today card"><b>Out today</b>${outToday.length ? outToday.map((r) => `<span class="to-chip ${KIND_CLASS[r.kind]}">${esc(who[r.member_id] || '?')} · ${esc(r.kind)}${r.part ? ` (${r.part.toLowerCase()})` : ''}</span>`).join('') : '<span class="muted">Everyone is in.</span>'}</div>
      <details class="card" id="to-add-card"><summary><b>+ Add time off</b></summary>
        <form id="to-add" style="margin-top:12px">
          <div class="row">
            ${manage ? `<label style="flex:1;min-width:180px">Who <select name="member">${members.filter((m) => m.active).map((m) => `<option value="${m.id}" ${m.id === me()?.id ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}</select></label>` : ''}
            <label style="width:170px">What <select name="kind">${KINDS.map((k) => `<option>${k}</option>`).join('')}</select></label>
            <label>From <input type="date" name="start" required value="${today}"></label>
            <label>To <input type="date" name="end" value="${today}"></label>
            <label style="width:150px">Day <select name="part"><option value="">Whole day</option><option>Morning</option><option>Afternoon</option></select></label>
          </div>
          <label style="margin-top:10px">Note <span class="muted">(optional)</span><input name="note" placeholder="Out of town, back Monday"></label>
          <div style="margin-top:12px"><button class="btn primary">Add</button></div>
        </form></details>
      <div class="to-monthbar"><a class="btn small" href="#/team/${prev}" aria-label="Previous month">‹</a><h2>${MONTH[firstD.getMonth()]} ${firstD.getFullYear()}</h2><a class="btn small" href="#/team/${next}" aria-label="Next month">›</a>
        ${ym !== today.slice(0, 7) ? '<a class="btn small" href="#/team">This month</a>' : ''}
        <span class="to-legend">${KINDS.map((k) => `<span class="to-pill ${KIND_CLASS[k]}">${k}</span>`).join('')}</span></div>
      <div class="to-grid">${DOW.map((d) => `<div class="to-dow">${d}</div>`).join('')}
        ${days.map((d) => { const dd = fromIso(d); const list = on(d); return `<div class="to-day${d.slice(0, 7) !== ym ? ' other' : ''}${d === today ? ' today' : ''}${dd.getDay() % 6 === 0 ? ' weekend' : ''}">
          <span class="to-num">${dd.getDate()}</span>${list.slice(0, 4).map(pill).join('')}${list.length > 4 ? `<span class="muted to-more">+${list.length - 4} more</span>` : ''}</div>`; }).join('')}
      </div>
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
    app.querySelectorAll('[data-to-del]').forEach((b) => b.addEventListener('click', async () => {
      if (!(await askConfirm('Remove this time off?', { ok: 'Remove', danger: true }))) return;
      try { await rpc('time_off_remove', { p_id: Number(b.dataset.toDel) }); toast('Removed'); renderTeam(ym); } catch (err) { toast(errMsg(err), true); }
    }));
  }

  return { renderTeam };
}

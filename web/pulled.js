// "I got pulled to something": shared by the custodial Checklist and the
// Maintenance schedule. Shows today's unplanned work for that department (who,
// what, where, how long) and the button to log it. See 0030_pulled_work.sql.

const pad = (n) => String(n).padStart(2, '0');
const localDay = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const clock = (ts) => new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
function dur(ms) {
  const m = Math.max(0, Math.round(ms / 60000));
  return m >= 60 ? `${Math.floor(m / 60)}h ${pad(m % 60)}m` : `${m}m`;
}

export function pulledKit({ sb, q, rpc, esc, toast, errMsg, me, isAdmin, loadLocations }) {
  let tick = null;

  async function load(dept) {
    const [rows, members] = await Promise.all([
      q(sb.from('pulled_work').select('*').eq('dept', dept).eq('day', localDay()).order('started_at', { ascending: false })),
      q(sb.from('team_members').select('id, name')),
    ]);
    return { rows, who: Object.fromEntries(members.map((m) => [m.id, m.name])) };
  }

  function block(dept, { rows, who }) {
    const open = rows.filter((r) => !r.ended_at);
    const ended = rows.filter((r) => r.ended_at);
    const mine = open.find((r) => r.member_id === me()?.id);
    const line = (r) => {
      const live = !r.ended_at;
      const canEnd = live && (r.member_id === me()?.id || isAdmin());
      return `<li class="pw-item${live ? ' live' : ''}">
        <span class="pw-dot" aria-hidden="true"></span>
        <div class="pw-text"><b>${esc(who[r.member_id] || 'Someone')}</b> · ${esc(r.what)}${r.location ? ` <span class="muted">· ${esc(r.location)}</span>` : ''}
          <span class="pw-time">${live ? `since ${clock(r.started_at)} · <span data-pw-since="${new Date(r.started_at).getTime()}">${dur(Date.now() - new Date(r.started_at))}</span>`
            : `${clock(r.started_at)}–${clock(r.ended_at)} · ${dur(new Date(r.ended_at) - new Date(r.started_at))}`}${r.note ? ` · ${esc(r.note)}` : ''}</span></div>
        ${canEnd ? `<button class="btn small" data-pw-end="${r.id}">${r.member_id === me()?.id ? "I'm back" : 'End'}</button>` : ''}
      </li>`;
    };
    return `<section class="pw-box ${dept === 'custodial' ? 'dept-custodial' : 'dept-maint'}">
      <div class="pw-head"><div><b>Pulled to today</b><span class="muted">${open.length ? `${open.length} away from the plan right now` : 'Work that wasn\'t on the plan'}</span></div>
        <button class="btn ${mine ? '' : 'primary'}" data-pw-start="${dept}">↪ ${mine ? 'Pulled to something else' : 'I got pulled to something'}</button></div>
      ${rows.length ? `<ul class="pw-list">${[...open, ...ended].map(line).join('')}</ul>` : '<p class="muted pw-empty">Nobody has been pulled off the plan today.</p>'}
    </section>`;
  }

  // The pop-up: what, where, and (optionally) which open request it's for.
  async function ask(dept) {
    const [locations, reqs] = await Promise.all([
      loadLocations().catch(() => []),
      q(sb.from('maint_requests').select('id, subject, location, board_group').neq('board_group', 'solved').order('created_at', { ascending: false }).limit(200)).catch(() => []),
    ]);
    return new Promise((resolve) => {
      const back = document.createElement('div');
      back.className = 'modal-back';
      back.innerHTML = `<form class="modal pw-modal" role="dialog" aria-modal="true" aria-labelledby="pw-title">
        <h3 id="pw-title">What did you get pulled to?</h3>
        <p class="muted">It goes on today's list under your name with a running clock, so the team can see where you are.</p>
        ${reqs.length ? `<label>Is it a request? <span class="muted">(optional)</span><select name="request"><option value="">No, something else</option>${reqs.map((r) => `<option value="${r.id}" data-subject="${esc(r.subject)}" data-loc="${esc(r.location || '')}">${esc(r.subject)}${r.location ? ` · ${esc(r.location)}` : ''}</option>`).join('')}</select></label>` : ''}
        <label>What <input name="what" required autocomplete="off" placeholder="${dept === 'custodial' ? 'Cleaning up a spill in the lobby' : 'Helping set up chairs for a funeral'}"></label>
        <label>Where <span class="muted">(optional)</span><select name="location"><option value="">— Pick a place —</option>${locations.map((l) => `<option>${esc(l.name)}</option>`).join('')}</select></label>
        <div class="modal-actions"><button type="button" class="btn" data-cancel>Cancel</button><button class="btn primary">Start</button></div>
      </form>`;
      const form = back.querySelector('form');
      const done = (v) => { document.removeEventListener('keydown', onKey, true); back.remove(); resolve(v); };
      const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); done(null); } };
      document.addEventListener('keydown', onKey, true);
      form.querySelector('[name=request]')?.addEventListener('change', (e) => {
        const o = e.target.selectedOptions[0];
        if (!o?.value) return;
        form.querySelector('[name=what]').value = o.dataset.subject;
        const loc = form.querySelector('[name=location]');
        if (o.dataset.loc && [...loc.options].some((x) => x.value === o.dataset.loc)) loc.value = o.dataset.loc;
      });
      form.querySelector('[data-cancel]').addEventListener('click', () => done(null));
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const f = new FormData(form);
        const what = String(f.get('what') || '').trim();
        if (!what) return form.querySelector('[name=what]').focus();
        done({ what, location: f.get('location') || null, request: f.get('request') ? Number(f.get('request')) : null });
      });
      document.body.appendChild(back);
      form.querySelector('[name=what]').focus();
    });
  }

  function bind(root, reload) {
    root.querySelectorAll('[data-pw-start]').forEach((b) => b.addEventListener('click', async () => {
      const v = await ask(b.dataset.pwStart);
      if (!v) return;
      try { await rpc('pulled_start', { p_dept: b.dataset.pwStart, p_what: v.what, p_location: v.location, p_request: v.request }); toast('Logged. Tap "I\'m back" when you\'re done.'); reload(); } catch (err) { toast(errMsg(err), true); }
    }));
    root.querySelectorAll('[data-pw-end]').forEach((b) => b.addEventListener('click', async () => {
      try { await rpc('pulled_end', { p_id: Number(b.dataset.pwEnd), p_note: null }); toast('Welcome back'); reload(); } catch (err) { toast(errMsg(err), true); }
    }));
    clearInterval(tick);
    tick = setInterval(() => {
      const els = root.querySelectorAll('[data-pw-since]');
      if (!els.length || !document.body.contains(els[0])) { clearInterval(tick); return; }
      els.forEach((el) => { el.textContent = dur(Date.now() - Number(el.dataset.pwSince)); });
    }, 30000);
  }

  return { load, block, bind };
}

import { loadPlaces as placesFrom, attachPlaces } from './places.js?v=__V__';
import { loadNotes, notesList, noteButton, bindNotes } from './notes.js?v=__V__';
// "I got pulled to something": shared by the custodial Checklist and the
// Maintenance schedule: one shared list of today's unplanned work for everyone (who,
// what, where, how long) and the button to log it. See 0030_pulled_work.sql.

const pad = (n) => String(n).padStart(2, '0');
const localDay = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const clock = (ts) => new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
// Time on it, leaving out breaks (paused_seconds, and a pause still going).
const worked = (r, now = Date.now()) => new Date(r.ended_at || (r.paused_at || now)).getTime() - new Date(r.started_at).getTime() - (r.paused_seconds || 0) * 1000;
function dur(ms) {
  const m = Math.max(0, Math.round(ms / 60000));
  return m >= 60 ? `${Math.floor(m / 60)}h ${pad(m % 60)}m` : `${m}m`;
}

export function pulledKit({ sb, q, rpc, esc, toast, errMsg, me, isAdmin }) {
  const loadPlaces = () => placesFrom(sb);
  let tick = null;
  let lastRows = [];

  async function load(dept) {
    const [rows, members] = await Promise.all([
      // Today's, plus any still going from an earlier day (someone forgot "I'm back").
      q(sb.from('pulled_work').select('*').gte('day', (() => { const d = new Date(); d.setDate(d.getDate() - 30); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; })()).order('started_at', { ascending: false }))
        .then((all) => all.filter((r) => r.day === localDay() || !r.ended_at)),
      q(sb.from('team_members').select('id, name')),
    ]);
    // Names of what each open one paused, to show "picks back up when you're back".
    const tIds = [...new Set(rows.filter((r) => !r.ended_at).flatMap((r) => r.paused_tasks || []))];
    const rIds = [...new Set(rows.filter((r) => !r.ended_at).flatMap((r) => r.paused_requests || []))];
    const [tasks, reqs] = await Promise.all([
      tIds.length ? q(sb.from('checklist_tasks').select('id, name').in('id', tIds)) : [],
      rIds.length ? q(sb.from('maint_requests').select('id, subject').in('id', rIds)) : [],
    ]);
    const held = Object.fromEntries([...tasks.map((t) => [`t${t.id}`, t.name]), ...reqs.map((x) => [`r${x.id}`, x.subject])]);
    const notes = await loadNotes(sb, 'pulled', rows.map((r) => r.id));
    lastRows = rows;
    return { rows, held, notes, who: Object.fromEntries(members.map((m) => [m.id, m.name])) };
  }

  function block(dept, { rows, who, held = {}, notes = {} }) {
    const open = rows.filter((r) => !r.ended_at);
    const ended = rows.filter((r) => r.ended_at);
    const mine = open.find((r) => r.member_id === me()?.id);
    const line = (r) => {
      const live = !r.ended_at;
      const canEnd = live && (r.member_id === me()?.id || isAdmin());
      const paused = live && r.paused_at;
      const waiting = live ? [...(r.paused_tasks || []).map((id) => held[`t${id}`]), ...(r.paused_requests || []).map((id) => held[`r${id}`])].filter(Boolean) : [];
      return `<li class="pw-item${live ? ' live' : ''}${paused ? ' paused' : ''}">
        <span class="pw-dot" aria-hidden="true"></span>
        <div class="pw-text"><b>${esc(who[r.member_id] || 'Someone')}</b> · ${esc(r.what)}${r.location ? ` <span class="muted">· ${esc(r.location)}</span>` : ''}
          <span class="pw-time">${live ? (paused ? `<b class="pw-paused">⏸ Paused since ${clock(r.paused_at)}</b> · ${dur(worked(r))} so far`
            : `since ${r.day !== localDay() ? `${new Date(r.started_at).toLocaleDateString([], { month: 'short', day: 'numeric' })}, ` : ''}${clock(r.started_at)} · <span data-pw-since="${Date.now() - worked(r)}">${dur(worked(r))}</span>`)
            : `${clock(r.started_at)}–${clock(r.ended_at)} · ${dur(worked(r))}${r.paused_seconds ? ` <span class="muted">(${dur(r.paused_seconds * 1000)} break)</span>` : ''}`}${r.note ? ` · ${esc(r.note)}` : ''}</span>
          ${notesList(notes[r.id], esc)}
          ${waiting.length ? `<span class="pw-held">⏸ ${waiting.map(esc).join(', ')} · picks back up when ${r.member_id === me()?.id ? "you're" : "they're"} back</span>` : ''}</div>
        ${!canEnd ? `<div class="pw-btns">${noteButton('pulled', r.id, (notes[r.id] || []).length)}</div>` : ''}
        ${canEnd ? `<div class="pw-btns">${noteButton('pulled', r.id, (notes[r.id] || []).length)}<button class="btn small" data-pw-pause="${r.id}" data-on="${paused ? 0 : 1}">${paused ? '▶ Resume' : '⏸ Pause'}</button>
          <button class="btn small" data-pw-end="${r.id}">${r.member_id === me()?.id ? "I'm back" : 'End'}</button></div>` : ''}
      </li>`;
    };
    return `<section class="pw-box">
      <div class="pw-head"><div><b>Pulled to today</b><span class="muted">${open.length ? `${open.length} away from the plan right now` : 'Work that wasn\'t on the plan'}</span></div>
        <button class="btn primary" data-pw-start="${dept}">↪ ${mine ? 'Pulled to something else' : 'I got pulled to something'}</button></div>
      ${open.length ? `<ul class="pw-list">${open.map(line).join('')}</ul>` : ''}
      ${ended.length ? `<details class="pw-done"><summary>${ended.length} finished today · ${dur(ended.reduce((a, r) => a + worked(r), 0))}</summary>
        <ul class="pw-mini">${ended.map((r) => `<li><span><b>${esc((who[r.member_id] || 'Someone').split(' ')[0])}</b> · ${esc(r.what)}${r.location ? ` <span class="muted">· ${esc(r.location)}</span>` : ''}</span>
          <span class="muted pw-mini-t">${clock(r.started_at)}–${clock(r.ended_at)} · ${dur(worked(r))}</span>${noteButton('pulled', r.id, (notes[r.id] || []).length)}</li>`).join('')}</ul></details>` : ''}
      ${rows.length ? '' : '<p class="muted pw-empty">Nobody has been pulled off the plan today.</p>'}
    </section>`;
  }

  // The pop-up: what, where, and (optionally) which open request it's for.
  async function ask(dept) {
    const [locations, reqs] = await Promise.all([
      loadPlaces().catch(() => []),
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
        <label><span>Where <span class="muted">(optional)</span></span><input name="location" placeholder="Type a place, e.g. Sanctuary, Kids wing"></label>
        <div class="modal-actions"><button type="button" class="btn" data-cancel>Cancel</button><button class="btn primary">Start</button></div>
      </form>`;
      const form = back.querySelector('form');
      const done = (v) => { document.removeEventListener('keydown', onKey, true); back.remove(); resolve(v); };
      const onKey = (e) => { if (e.key === 'Escape' && !document.querySelector('.place-menu, .dd-menu')) { e.preventDefault(); done(null); } };
      document.addEventListener('keydown', onKey, true);
      form.querySelector('[name=request]')?.addEventListener('change', (e) => {
        const o = e.target.selectedOptions[0];
        if (!o?.value) return;
        form.querySelector('[name=what]').value = o.dataset.subject;
        if (o.dataset.loc) form.querySelector('[name=location]').value = o.dataset.loc;
      });
      form.querySelector('[data-cancel]').addEventListener('click', () => done(null));
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const f = new FormData(form);
        const what = String(f.get('what') || '').trim();
        if (!what) return form.querySelector('[name=what]').focus();
        done({ what, location: String(f.get('location') || '').trim() || null, request: f.get('request') ? Number(f.get('request')) : null });
      });
      document.body.appendChild(back);
      attachPlaces(form.querySelector('[name=location]'), locations);
      form.querySelector('[name=what]').focus();
    });
  }

  function bind(root, reload) {
    bindNotes(root, { sb, toast, errMsg, esc, meId: me()?.id, canDeleteAll: isAdmin(), names: Object.fromEntries(lastRows.map((r) => [`pulled:${r.id}`, r.what])) }, reload);
    root.querySelectorAll('[data-pw-start]').forEach((b) => b.addEventListener('click', async () => {
      const v = await ask(b.dataset.pwStart);
      if (!v) return;
      try { await rpc('pulled_start', { p_dept: b.dataset.pwStart, p_what: v.what, p_location: v.location, p_request: v.request }); toast('Logged. What you were on is paused. Tap "I\'m back" to pick it back up.'); reload(); } catch (err) { toast(errMsg(err), true); }
    }));
    root.querySelectorAll('[data-pw-end]').forEach((b) => b.addEventListener('click', async () => {
      try { await rpc('pulled_end', { p_id: Number(b.dataset.pwEnd), p_note: null }); toast('Welcome back'); reload(); } catch (err) { toast(errMsg(err), true); }
    }));
    root.querySelectorAll('[data-pw-pause]').forEach((b) => b.addEventListener('click', async () => {
      const on = b.dataset.on === '1';
      try { await rpc('pulled_pause', { p_id: Number(b.dataset.pwPause), p_pause: on }); toast(on ? 'Paused. Tap Resume when you start again.' : 'Resumed'); reload(); } catch (err) { toast(errMsg(err), true); }
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

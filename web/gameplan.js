// Weekend plan (Facilities admins): this weekend's weather hour by hour, and
// a Facilities gameplan for each day (Fri / Sat / Sun). Skyler sees the same
// weather and each day's plan on the Operations page (operations/index.html
// reads it with get_gameplan).
import { weekendOf, wxDayLabel, loadWeekendWeather, wxCard, wxHourly, wxIcon, dayKey, dayPlan, GAMEPLAN_STATUS } from './weather.js?v=__V__';

export function gameplanPages(ctx) {
  const { rpc, esc, toast, errMsg, pageHead } = ctx;
  const app = document.getElementById('app');
  let dayIdx = 0;   // which day's hours are showing

  async function renderGameplan() {
    const dates = weekendOf();
    const [fri, sat, sun] = dates;
    const [plan, wx] = await Promise.all([
      rpc('get_gameplan', { p_weekend: sat }).then((r) => (Array.isArray(r) ? r[0] : r) || null),
      loadWeekendWeather().catch((e) => ({ error: errMsg(e) })),
    ]);
    if (!wx.error) dayIdx = Math.min(dayIdx, wx.days.length - 1);
    const state = Object.fromEntries(dates.map((d) => { const p = dayPlan(plan, d); return [dayKey(d), { status: p?.status || 'normal', plan: p?.plan || '' }]; }));
    const wxFor = (iso) => (wx.days || []).find((d) => d.date === iso);
    const when = plan?.updated_at ? new Date(plan.updated_at).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
    const HINT = { fri: 'e.g. Rain tonight: tarps on the outdoor stage, mats at the entrances.', sat: 'e.g. Wet until noon: wet-floor signs, extra mats, push lawn care to Monday.', sun: 'e.g. Clear and 70°. Normal setup, blow the lot at 6 AM.' };
    app.innerHTML = `
      ${pageHead('Facilities', 'Weekend <span class="accent">plan</span>', `${wxDayLabel(fri)} – ${wxDayLabel(sun)}. Check the weather, then write the Facilities gameplan for each day. Skyler sees it on the Operations page.`)}
      <div class="gp-page">
        <section class="card"><h2>Weather</h2>
          ${wx.error ? `<p class="muted">${esc(wx.error)}</p>` : `${wxCard(wx, null, false)}
          <div class="wx-tabs" style="margin-top:14px">${wx.days.map((d, i) => `<button type="button" class="chip-btn big${i === dayIdx ? ' on' : ''}" data-wxday="${i}">${esc(wxDayLabel(d.date))}</button>`).join('')}</div>
          <div data-wxhours>${wxHourly(wx.days[dayIdx])}</div>
          <p class="muted" style="font-size:12px;margin:8px 0 0">National Weather Service forecast for Fort Worth.</p>`}
        </section>
        <section class="card"><h2>Facilities gameplan</h2>
          <form id="gp-form" class="gp-days">
            ${dates.map((iso) => { const k = dayKey(iso); const w = wxFor(iso); return `<div class="gp-day" data-gpday="${k}">
              <div class="gp-dayhead"><b>${esc(wxDayLabel(iso))}</b>${w && w.hours.length ? `<span class="muted">${wxIcon(w.summary)} ${w.hi}° / ${w.lo}° · 💧 ${w.rain}%</span>` : ''}</div>
              <div class="gp-status">${Object.entries(GAMEPLAN_STATUS).map(([s, [label, cls]]) => `<button type="button" class="chip-btn ${cls}${s === state[k].status ? ' on' : ''}" data-gpstatus="${s}">${label}</button>`).join('')}</div>
              <textarea name="plan_${k}" rows="3" placeholder="${esc(HINT[k])}">${esc(state[k].plan)}</textarea></div>`; }).join('')}
            <div class="row" style="align-items:center"><button class="btn primary">Save gameplan</button>
              <span class="muted" style="font-size:13px">${plan ? `Last saved by ${esc(plan.updated_by || 'someone')} · ${esc(when)}` : 'Not saved yet for this weekend.'}</span></div>
          </form>
        </section>
      </div>`;
    app.querySelectorAll('[data-wxday]').forEach((b) => b.addEventListener('click', () => {
      dayIdx = Number(b.dataset.wxday);
      app.querySelectorAll('[data-wxday]').forEach((x) => x.classList.toggle('on', x === b));
      app.querySelector('[data-wxhours]').innerHTML = wxHourly(wx.days[dayIdx]);
    }));
    app.querySelectorAll('[data-gpday]').forEach((box) => box.querySelectorAll('[data-gpstatus]').forEach((b) => b.addEventListener('click', () => {
      state[box.dataset.gpday].status = b.dataset.gpstatus;
      box.querySelectorAll('[data-gpstatus]').forEach((x) => x.classList.toggle('on', x === b));
    })));
    app.querySelector('#gp-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      const days = Object.fromEntries(Object.keys(state).map((k) => [k, { status: state[k].status, plan: String(f.get(`plan_${k}`) || '') }]));
      try {
        await rpc('set_gameplan_days', { p_weekend: sat, p_days: days });
        toast('Gameplan saved. Skyler will see it on Operations.');
        renderGameplan();
      } catch (err) { toast(errMsg(err), true); }
    });
  }

  return { renderGameplan };
}

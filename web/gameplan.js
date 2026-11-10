// Weekend plan (Facilities admins): this weekend's weather hour by hour, and
// the Facilities gameplan for it. Skyler sees the same card and plan on the
// Operations page (operations/index.html reads it with get_gameplan).
import { weekendOf, wxDayLabel, loadWeekendWeather, wxCard, wxHourly, GAMEPLAN_STATUS } from './weather.js?v=__V__';

export function gameplanPages(ctx) {
  const { rpc, esc, toast, errMsg, pageHead } = ctx;
  const app = document.getElementById('app');
  let dayIdx = 0;

  async function renderGameplan() {
    const [sat, sun] = weekendOf();
    const [plan, wx] = await Promise.all([
      rpc('get_gameplan', { p_weekend: sat }).then((r) => (Array.isArray(r) ? r[0] : r) || null),
      loadWeekendWeather().catch((e) => ({ error: errMsg(e) })),
    ]);
    let status = plan?.status || 'normal';
    const when = plan?.updated_at ? new Date(plan.updated_at).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
    app.innerHTML = `
      ${pageHead('Facilities', 'Weekend <span class="accent">plan</span>', `${wxDayLabel(sat)} – ${wxDayLabel(sun).split(', ')[1]}. Check the weather, then write the Facilities gameplan. Skyler sees it on the Operations page.`)}
      <div class="gp-page">
        <section class="card"><h2>Weather</h2>
          ${wx.error ? `<p class="muted">${esc(wx.error)}</p>` : `${wxCard(wx, null, false)}
          <div class="wx-tabs" style="margin-top:14px">${wx.days.map((d, i) => `<button type="button" class="chip-btn big${i === dayIdx ? ' on' : ''}" data-wxday="${i}">${esc(wxDayLabel(d.date))}</button>`).join('')}</div>
          <div data-wxhours>${wxHourly(wx.days[dayIdx])}</div>
          <p class="muted" style="font-size:12px;margin:8px 0 0">National Weather Service forecast for Fort Worth.</p>`}
        </section>
        <section class="card"><h2>Facilities gameplan</h2>
          <form id="gp-form">
            <div class="gp-status">${Object.entries(GAMEPLAN_STATUS).map(([k, [label, cls]]) => `<button type="button" class="chip-btn ${cls}${k === status ? ' on' : ''}" data-gpstatus="${k}">${label}</button>`).join('')}</div>
            <label><span>The plan <span class="muted">(what we're doing because of the weather)</span></span>
              <textarea name="plan" placeholder="e.g.&#10;Sat: rain until noon. Tarps on the outdoor stage Fri night, wet-floor signs and extra mats at both entrances.&#10;Sun: clear and 70°. Normal setup. Blow the parking lot at 6 AM.">${esc(plan?.plan || '')}</textarea></label>
            <div class="row" style="margin-top:12px;align-items:center"><button class="btn primary">Save gameplan</button>
              <span class="muted" style="font-size:13px">${plan ? `Last saved by ${esc(plan.updated_by || 'someone')} · ${esc(when)}` : 'Not saved yet for this weekend.'}</span></div>
          </form>
        </section>
      </div>`;
    app.querySelectorAll('[data-wxday]').forEach((b) => b.addEventListener('click', () => {
      dayIdx = Number(b.dataset.wxday);
      app.querySelectorAll('[data-wxday]').forEach((x) => x.classList.toggle('on', x === b));
      app.querySelector('[data-wxhours]').innerHTML = wxHourly(wx.days[dayIdx]);
    }));
    app.querySelectorAll('[data-gpstatus]').forEach((b) => b.addEventListener('click', () => {
      status = b.dataset.gpstatus;
      app.querySelectorAll('[data-gpstatus]').forEach((x) => x.classList.toggle('on', x === b));
    }));
    app.querySelector('#gp-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await rpc('set_gameplan', { p_weekend: sat, p_status: status, p_plan: new FormData(e.target).get('plan') });
        toast('Gameplan saved. Skyler will see it on Operations.');
        renderGameplan();
      } catch (err) { toast(errMsg(err), true); }
    });
  }

  return { renderGameplan };
}

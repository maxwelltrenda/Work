// Weekend weather for Mercy Culture (Fort Worth) from the National Weather
// Service (free, no key, works from the browser), plus the HTML for the
// weekend card and the hour-by-hour view. Used by the Facilities "Weekend
// plan" page and copied to operations/weather.js for Skyler's Operations page
// (keep the two the same; that copy has no "export").

const NWS = 'https://api.weather.gov/gridpoints/FWD/70,104/forecast';
const CACHE = 'mc-wx-v1';
const pad = (n) => String(n).padStart(2, '0');
const isoOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const DAYN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const wxEsc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// This weekend's Friday, Saturday and Sunday (on a weekend, the one we're in).
// The gameplan is saved under the Saturday: weekendOf()[1].
export function weekendOf(now = new Date()) {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dow = d.getDay();
  const sat = new Date(d.getFullYear(), d.getMonth(), d.getDate() + (dow === 6 ? 0 : dow === 0 ? -1 : 6 - dow));
  return [-1, 0, 1].map((k) => isoOf(new Date(sat.getFullYear(), sat.getMonth(), sat.getDate() + k)));
}
export const wxDayLabel = (iso) => { const [y, m, d] = iso.split('-').map(Number); const dt = new Date(y, m - 1, d); return `${DAYN[dt.getDay()]}, ${MONS[m - 1]} ${d}`; };
export const wxHour = (h) => `${h % 12 || 12} ${h < 12 ? 'AM' : 'PM'}`;

export function wxIcon(text, day = true) {
  const t = String(text || '').toLowerCase();
  if (/thunder|t-storm/.test(t)) return '⛈️';
  if (/snow|flurr|blizzard/.test(t)) return '🌨️';
  if (/sleet|freezing|ice/.test(t)) return '🧊';
  if (/rain|shower|drizzle/.test(t)) return '🌧️';
  if (/fog|haze|smoke/.test(t)) return '🌫️';
  if (/wind|breezy|blustery/.test(t)) return '💨';
  if (/mostly cloudy|overcast|^cloudy/.test(t)) return '☁️';
  if (/partly|mostly sunny|mostly clear/.test(t)) return day ? '⛅' : '☁️';
  return day ? '☀️' : '🌙';
}

// { days: [{ date, hours:[{hour,temp,rain,wind,text,day}], hi, lo, rain, summary, detail, night }], at }
export async function loadWeekendWeather() {
  try { const c = JSON.parse(sessionStorage.getItem(CACHE) || 'null'); if (c && Date.now() - c.at < 30 * 60e3 && c.key === weekendOf()[1] + isoOf(new Date())) return c; } catch { /* no storage */ }
  const get = (u) => fetch(u, { headers: { Accept: 'application/geo+json' } }).then((r) => { if (!r.ok) throw new Error('The weather service did not answer. Try again in a minute.'); return r.json(); });
  const [h, d] = await Promise.all([get(`${NWS}/hourly`), get(NWS)]);
  const hp = h.properties.periods;
  const dp = d.properties.periods;
  const today = isoOf(new Date());
  const days = weekendOf().filter((date) => date >= today).map((date) => {
    const hours = hp.filter((p) => p.startTime.slice(0, 10) === date).map((p) => ({
      hour: Number(p.startTime.slice(11, 13)), temp: p.temperature, rain: p.probabilityOfPrecipitation?.value ?? 0,
      wind: `${p.windSpeed}${p.windDirection ? ` ${p.windDirection}` : ''}`, text: p.shortForecast, day: p.isDaytime,
    }));
    const dayP = dp.find((p) => p.startTime.slice(0, 10) === date && p.isDaytime);
    const nightP = dp.find((p) => p.startTime.slice(0, 10) === date && !p.isDaytime);
    const awake = hours.filter((x) => x.hour >= 6 && x.hour <= 22);
    const temps = hours.map((x) => x.temp);
    const noon = hours.find((x) => x.hour === 12) || awake[0] || hours[0];
    return {
      date, hours,
      hi: dayP ? dayP.temperature : (temps.length ? Math.max(...temps) : null),
      lo: nightP ? nightP.temperature : (temps.length ? Math.min(...temps) : null),
      rain: Math.max(0, ...(awake.length ? awake : hours).map((x) => x.rain || 0)),
      summary: dayP ? dayP.shortForecast : noon ? noon.text : '',
      detail: dayP ? dayP.detailedForecast : '', night: nightP ? nightP.detailedForecast : '',
    };
  });
  const out = { days, at: Date.now(), key: weekendOf()[1] + today };
  try { sessionStorage.setItem(CACHE, JSON.stringify(out)); } catch { /* no storage */ }
  return out;
}

export const GAMEPLAN_STATUS = { normal: ['All normal', 'gp-normal'], watch: ['Watching the weather', 'gp-watch'], action: ['Weather plan in place', 'gp-action'] };

// Small weekend card (the corner on Operations, the top of the Facilities page).
export function wxCard(w, plan, showPlan = true) {
  const st = plan && GAMEPLAN_STATUS[plan.status];
  return `<div class="wx-card-days">${w.days.map((d) => `<div class="wx-mini">
      <span class="wx-mini-day">${wxDayLabel(d.date).split(',')[0].slice(0, 3)}</span>
      <span class="wx-mini-ico" aria-hidden="true">${d.hours.length ? wxIcon(d.summary) : '–'}</span>
      <span class="wx-mini-t">${d.hi != null ? `${d.hi}°` : '–'}<small>${d.lo != null ? ` / ${d.lo}°` : ''}</small></span>
      <span class="wx-mini-rain${d.rain >= 40 ? ' wet' : ''}">${d.hours.length ? `💧 ${d.rain}%` : 'Not out yet'}</span></div>`).join('')}</div>
    ${!showPlan ? '' : st ? `<span class="gp-pill ${st[1]}">${st[0]}</span>` : '<span class="gp-pill gp-none">No gameplan yet</span>'}`;
}

// Hour by hour for one day, 6 AM - 10 PM.
export function wxHourly(d) {
  const hrs = d.hours.filter((x) => x.hour >= 6 && x.hour <= 22);
  if (!hrs.length) return '<p class="muted">The hourly forecast for this day isn\'t out yet. It comes out about a week ahead.</p>';
  return `<p class="wx-detail">${wxEsc(d.detail || d.summary)}${d.night ? `<br><span class="muted">Night: ${wxEsc(d.night)}</span>` : ''}</p>
    <div class="wx-hours">${hrs.map((x) => `<div class="wx-h${x.rain >= 40 ? ' wet' : ''}">
      <span class="wx-h-time">${wxHour(x.hour)}</span><span class="wx-h-ico" title="${wxEsc(x.text)}">${wxIcon(x.text, x.day)}</span>
      <span class="wx-h-temp">${x.temp}°</span><span class="wx-h-text">${wxEsc(x.text)}</span>
      <span class="wx-h-rain">💧 ${x.rain}%</span><span class="wx-h-wind">${wxEsc(x.wind)}</span></div>`).join('')}</div>`;
}

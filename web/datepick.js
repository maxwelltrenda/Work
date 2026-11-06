// Styled date and time pickers. Native ones open the system picker (Apple's
// on a Mac or iPhone), so every <input type="date"> and <input type="time"> is
// wrapped with a button and our own calendar / time list, like the dropdowns
// in select.js. The real input stays in the DOM, hidden, so forms, `.value`,
// min / max / required and 'change' listeners keep working unchanged.

const CAL = '<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><rect x="2" y="3" width="12" height="11" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M2 6.5h12M5.5 1.5v3M10.5 1.5v3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
const CLOCK = '<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M8 4.8V8l2.2 1.6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
const MONTH = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MON = MONTH.map((m) => m.slice(0, 3));
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromIso = (s) => { const [y, m, d] = String(s).split('-').map(Number); return new Date(y, m - 1, d); };
const dateLabel = (v) => { const d = fromIso(v); return `${DOW[d.getDay()]}, ${MON[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`; };
const timeLabel = (v) => { const [h, m] = v.split(':').map(Number); return `${h % 12 || 12}:${pad(m)} ${h < 12 ? 'AM' : 'PM'}`; };

let open = null; // { input, pop, view }

function sync(input) {
  const dp = input.__dp;
  if (!dp) return;
  const v = input.value;
  dp.label.textContent = v ? (input.type === 'date' ? dateLabel(v) : timeLabel(v)) : (input.placeholder || (input.type === 'date' ? 'Pick a date' : 'Pick a time'));
  dp.btn.classList.toggle('placeholder', !v);
  dp.btn.disabled = input.disabled;
}

// Programmatic `input.value = …` fires no event, so keep the label in step.
const valueDesc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
Object.defineProperty(HTMLInputElement.prototype, 'value', {
  configurable: true,
  get() { return valueDesc.get.call(this); },
  set(v) { valueDesc.set.call(this, v); if (this.__dp) sync(this); },
});

export function enhance(input) {
  if (input.__dp || !['date', 'time'].includes(input.type) || 'native' in input.dataset) return;
  const wrap = document.createElement('div');
  wrap.className = 'dd dp';
  wrap.style.cssText = input.style.cssText;
  input.style.cssText = '';
  input.parentNode.insertBefore(wrap, input);
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'dd-btn dp-btn';
  btn.setAttribute('aria-haspopup', 'dialog');
  btn.innerHTML = `<span class="dd-label"></span>${input.type === 'date' ? CAL : CLOCK}`;
  if (input.getAttribute('aria-label')) btn.setAttribute('aria-label', input.getAttribute('aria-label'));
  wrap.append(btn, input);
  input.classList.add('dd-native');
  input.tabIndex = -1;
  input.setAttribute('aria-hidden', 'true');
  // Something focusing the hidden input (a label tap, a validation message) lands on the button.
  input.addEventListener('focus', () => btn.focus());
  input.__dp = { wrap, btn, label: btn.querySelector('.dd-label') };
  btn.addEventListener('click', () => (open?.input === input ? close() : openPicker(input)));
  btn.addEventListener('keydown', (e) => { if (['ArrowDown', 'Enter', ' '].includes(e.key)) { e.preventDefault(); openPicker(input); } });
  input.addEventListener('change', () => sync(input));
  input.form?.addEventListener('reset', () => setTimeout(() => sync(input)));
  new MutationObserver(() => sync(input)).observe(input, { attributes: true, attributeFilter: ['disabled', 'value', 'placeholder'] });
  sync(input);
}

function set(input, v) {
  const changed = input.value !== v;
  close();
  input.__dp.btn.focus();
  if (!changed) return;
  input.value = v;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

function openPicker(input) {
  close();
  const pop = document.createElement('div');
  pop.className = 'dd-menu dp-pop';
  pop.setAttribute('role', 'dialog');
  pop.addEventListener('mousedown', (e) => e.preventDefault());
  document.body.appendChild(pop);
  const start = input.value || (input.type === 'date' ? iso(new Date()) : '');
  open = { input, pop, view: input.type === 'date' ? fromIso(start) : null };
  input.__dp.wrap.classList.add('open');
  if (input.type === 'date') drawCalendar(); else drawTimes();
  place();
}

function drawCalendar() {
  const { input, pop, view } = open;
  const y = view.getFullYear();
  const m = view.getMonth();
  const first = new Date(y, m, 1);
  const today = iso(new Date());
  const min = input.min || '';
  const max = input.max || '';
  const cells = [];
  for (let i = 0; i < first.getDay(); i++) cells.push('<span></span>');
  const days = new Date(y, m + 1, 0).getDate();
  for (let d = 1; d <= days; d++) {
    const v = iso(new Date(y, m, d));
    const off = (min && v < min) || (max && v > max);
    cells.push(`<button type="button" class="dp-day${v === input.value ? ' on' : ''}${v === today ? ' today' : ''}" data-v="${v}" ${off ? 'disabled' : ''}>${d}</button>`);
  }
  pop.innerHTML = `<div class="dp-head"><button type="button" class="dp-nav" data-step="-1" aria-label="Previous month">‹</button>
      <b>${MONTH[m]} ${y}</b><button type="button" class="dp-nav" data-step="1" aria-label="Next month">›</button></div>
    <div class="dp-grid">${DOW.map((d) => `<span class="dp-dow">${d.slice(0, 2)}</span>`).join('')}${cells.join('')}</div>
    <div class="dp-foot"><button type="button" class="dp-link" data-v="${today}" ${(min && today < min) || (max && today > max) ? 'disabled' : ''}>Today</button>
      ${input.required ? '' : '<button type="button" class="dp-link" data-v="">Clear</button>'}</div>`;
  pop.querySelectorAll('[data-step]').forEach((b) => b.addEventListener('click', () => {
    open.view = new Date(y, m + Number(b.dataset.step), 1);
    drawCalendar();
  }));
  pop.querySelectorAll('[data-v]').forEach((b) => b.addEventListener('click', () => set(input, b.dataset.v)));
  (pop.querySelector('.dp-day.on') || pop.querySelector('.dp-day.today'))?.focus({ preventScroll: true });
}

function drawTimes() {
  const { input, pop } = open;
  const step = Math.max(5, Math.round((Number(input.step) || 900) / 60)); // minutes
  const opts = [];
  for (let t = 0; t < 24 * 60; t += step) opts.push(`${pad(Math.floor(t / 60))}:${pad(t % 60)}`);
  if (input.value && !opts.includes(input.value)) { opts.push(input.value); opts.sort(); }
  pop.classList.add('dp-times');
  pop.innerHTML = opts.map((v) => `<button type="button" class="dd-opt dp-time${v === input.value ? ' selected' : ''}" data-v="${v}">${timeLabel(v)}</button>`).join('');
  pop.querySelectorAll('[data-v]').forEach((b) => b.addEventListener('click', () => set(input, b.dataset.v)));
  const cur = pop.querySelector('.selected') || pop.querySelector('[data-v="08:00"]');
  if (cur) pop.scrollTop = cur.offsetTop - pop.clientHeight / 2 + cur.offsetHeight / 2;
}

function place() {
  if (!open) return;
  const { pop, input } = open;
  const r = input.__dp.btn.getBoundingClientRect();
  const gap = 6;
  const below = window.innerHeight - r.bottom - gap - 8;
  const above = r.top - gap - 8;
  if (input.type === 'time') pop.style.maxHeight = `${Math.min(280, Math.max(below, above))}px`;
  const h = pop.offsetHeight;
  const up = below < h && above > below;
  pop.style.minWidth = input.type === 'time' ? `${Math.max(r.width, 150)}px` : '';
  const w = pop.offsetWidth;
  pop.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - w - 8))}px`;
  pop.style.top = up ? `${Math.max(8, r.top - gap - h)}px` : `${r.bottom + gap}px`;
  pop.classList.toggle('up', up);
}

function close() {
  if (!open) return;
  open.pop.remove();
  open.input.__dp.wrap.classList.remove('open');
  open = null;
}

document.addEventListener('keydown', (e) => {
  if (!open) return;
  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); const { input } = open; close(); input.__dp.btn.focus(); return; }
  if (open.input.type !== 'date' || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
  // Arrow keys move between days.
  const f = document.activeElement?.closest?.('.dp-day');
  if (!f) return;
  e.preventDefault();
  const d = fromIso(f.dataset.v);
  d.setDate(d.getDate() + { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key]);
  const v = iso(d);
  if (d.getMonth() !== open.view.getMonth()) { open.view = new Date(d.getFullYear(), d.getMonth(), 1); drawCalendar(); place(); }
  open.pop.querySelector(`[data-v="${v}"]`)?.focus();
}, true);
document.addEventListener('mousedown', (e) => {
  if (open && !open.pop.contains(e.target) && !open.input.__dp.wrap.contains(e.target)) close();
});
window.addEventListener('resize', close);
window.addEventListener('scroll', (e) => { if (open && !open.pop.contains(e.target)) place(); }, true);
window.addEventListener('hashchange', close);

const enhanceAll = (root) => root.querySelectorAll?.('input[type="date"], input[type="time"]').forEach(enhance);
enhanceAll(document);
new MutationObserver((muts) => {
  for (const m of muts) m.addedNodes.forEach((n) => { if (n.nodeType === 1) { if (n.tagName === 'INPUT') enhance(n); else enhanceAll(n); } });
}).observe(document.body, { childList: true, subtree: true });

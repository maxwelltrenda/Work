// "Where" box: type any place, with suggestions from places already used on
// requests, pulled-to entries and maintenance tasks (not tool storage spots).
// The menu looks like the site's dropdowns (.dd-menu / .dd-opt).

export async function loadPlaces(sb) {
  const pick = async (table) => {
    try { const { data } = await sb.from(table).select('location').not('location', 'is', null).limit(1000); return (data || []).map((r) => r.location); } catch { return []; }
  };
  const all = (await Promise.all(['maint_requests', 'pulled_work', 'pm_tasks'].map(pick))).flat();
  const seen = new Map();
  all.forEach((p) => {
    const v = String(p || '').trim().replace(/\s+/g, ' ').replace(/\.$/, '');
    if (!v || v.length > 60) return;
    const k = v.toLowerCase();
    const e = seen.get(k);
    if (e) e.n += 1; else seen.set(k, { name: v, n: 1 });
  });
  return [...seen.values()].sort((a, b) => b.n - a.n || a.name.localeCompare(b.name)).map((x) => x.name);
}

export function attachPlaces(input, places) {
  let menu = null;
  let items = [];
  let active = -1;
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const close = () => { menu?.remove(); menu = null; active = -1; };
  const choose = (v) => { input.value = v; input.dispatchEvent(new Event('input', { bubbles: true })); close(); };
  const show = () => {
    const typed = input.value.trim().toLowerCase();
    items = places.filter((p) => !typed || p.toLowerCase().includes(typed)).filter((p) => p.toLowerCase() !== typed).slice(0, 8);
    if (!items.length) return close();
    if (!menu) {
      menu = document.createElement('div');
      menu.className = 'dd-menu place-menu';
      menu.addEventListener('mousedown', (e) => e.preventDefault());
      document.body.appendChild(menu);
    }
    menu.innerHTML = items.map((p, i) => `<div class="dd-opt${i === active ? ' active' : ''}" data-i="${i}">${esc(p)}</div>`).join('');
    menu.querySelectorAll('[data-i]').forEach((o) => o.addEventListener('click', () => choose(items[o.dataset.i])));
    const r = input.getBoundingClientRect();
    const below = window.innerHeight - r.bottom - 14;
    const up = below < 200 && r.top > below;
    menu.style.minWidth = `${r.width}px`;
    menu.style.left = `${r.left}px`;
    menu.style.maxHeight = `${Math.min(300, up ? r.top - 14 : below)}px`;
    menu.style.top = up ? `${r.top - 6 - menu.offsetHeight}px` : `${r.bottom + 6}px`;
  };
  input.setAttribute('autocomplete', 'off');
  input.addEventListener('focus', show);
  input.addEventListener('input', () => { active = -1; show(); });
  input.addEventListener('blur', () => setTimeout(close, 100));
  input.addEventListener('keydown', (e) => {
    if (!menu) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); active = (active + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length; show(); }
    else if (e.key === 'Enter' && active >= 0) { e.preventDefault(); choose(items[active]); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
  });
  window.addEventListener('scroll', close, true);
}

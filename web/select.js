// Styled dropdowns. Native <select> menus can't be styled (on a Mac they're
// always the system menu), so every <select> on the page is wrapped with a
// button and a custom menu. The real <select> stays in the DOM, hidden, so
// forms, `select.value` and 'change' listeners keep working unchanged.

const CHEVRON = '<svg class="dd-chev" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const CHECK = '<svg class="dd-check" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

let open = null; // { sel, menu, items, active }
let typed = '';
let typedTimer;

function sync(sel) {
  const dd = sel.__dd;
  if (!dd) return;
  const opt = sel.options[sel.selectedIndex];
  dd.label.textContent = opt ? opt.textContent : '';
  dd.btn.classList.toggle('placeholder', !sel.value);
  dd.btn.disabled = sel.disabled;
}

// Programmatic `select.value = …` fires no event, so keep the label in step.
for (const prop of ['value', 'selectedIndex']) {
  const desc = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, prop);
  Object.defineProperty(HTMLSelectElement.prototype, prop, {
    configurable: true,
    get() { return desc.get.call(this); },
    set(v) { desc.set.call(this, v); sync(this); },
  });
}

export function enhance(sel) {
  if (sel.__dd || sel.multiple || 'native' in sel.dataset) return;
  const wrap = document.createElement('div');
  wrap.className = 'dd';
  wrap.style.cssText = sel.style.cssText;
  sel.style.cssText = '';
  sel.parentNode.insertBefore(wrap, sel);

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'dd-btn';
  btn.setAttribute('aria-haspopup', 'listbox');
  btn.setAttribute('aria-expanded', 'false');
  btn.innerHTML = `<span class="dd-label"></span>${CHEVRON}`;
  // Button first, so clicking the surrounding <label> text opens the menu.
  wrap.append(btn, sel);
  sel.classList.add('dd-native');
  sel.tabIndex = -1;
  sel.setAttribute('aria-hidden', 'true');

  sel.__dd = { wrap, btn, label: btn.querySelector('.dd-label') };
  btn.addEventListener('click', () => (open?.sel === sel ? close() : openMenu(sel)));
  btn.addEventListener('keydown', (e) => {
    if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
      e.preventDefault();
      openMenu(sel);
    }
  });
  sel.addEventListener('change', () => sync(sel));
  new MutationObserver(() => sync(sel)).observe(sel, { childList: true, subtree: true, attributes: true });
  sync(sel);
}

function openMenu(sel) {
  close();
  const menu = document.createElement('div');
  menu.className = 'dd-menu';
  menu.setAttribute('role', 'listbox');
  const items = [];
  const addOption = (o) => {
    if (o.hidden) return;
    const d = document.createElement('div');
    d.className = 'dd-opt';
    d.setAttribute('role', 'option');
    d.innerHTML = `<span></span>${CHECK}`;
    d.firstChild.textContent = o.textContent;
    if (o.value.startsWith('__')) d.classList.add('action');
    if (o.disabled) d.classList.add('disabled');
    if (o.selected) { d.classList.add('selected'); d.setAttribute('aria-selected', 'true'); }
    d.addEventListener('mousedown', (e) => e.preventDefault());
    d.addEventListener('click', () => !o.disabled && choose(o));
    d.addEventListener('mousemove', () => setActive(items.indexOf(d)));
    d.__opt = o;
    items.push(d);
    menu.appendChild(d);
  };
  for (const node of sel.children) {
    if (node.tagName === 'OPTGROUP') {
      const g = document.createElement('div');
      g.className = 'dd-group';
      g.textContent = node.label;
      menu.appendChild(g);
      [...node.children].forEach(addOption);
    } else {
      addOption(node);
    }
  }
  document.body.appendChild(menu);
  open = { sel, menu, items, active: -1 };
  sel.__dd.btn.setAttribute('aria-expanded', 'true');
  sel.__dd.wrap.classList.add('open');
  place();
  const cur = items.findIndex((d) => d.classList.contains('selected'));
  setActive(cur >= 0 ? cur : 0, true);
}

function place() {
  if (!open) return;
  const { menu, sel } = open;
  const r = sel.__dd.btn.getBoundingClientRect();
  const gap = 6;
  const below = window.innerHeight - r.bottom - gap - 8;
  const above = r.top - gap - 8;
  const up = below < 220 && above > below;
  menu.style.minWidth = `${Math.max(r.width, 180)}px`;
  menu.style.maxHeight = `${Math.min(340, up ? above : below)}px`;
  const w = menu.offsetWidth;
  menu.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - w - 8))}px`;
  menu.style.top = up ? `${r.top - gap - menu.offsetHeight}px` : `${r.bottom + gap}px`;
  menu.classList.toggle('up', up);
}

function setActive(i, scroll = false) {
  if (!open || i < 0 || i >= open.items.length) return;
  open.items[open.active]?.classList.remove('active');
  open.active = i;
  const d = open.items[i];
  d.classList.add('active');
  if (scroll) d.scrollIntoView({ block: 'nearest' });
}

function move(step) {
  if (!open) return;
  let i = open.active;
  for (let n = 0; n < open.items.length; n++) {
    i = (i + step + open.items.length) % open.items.length;
    if (!open.items[i].classList.contains('disabled')) return setActive(i, true);
  }
}

function choose(o) {
  const { sel } = open;
  const changed = sel.value !== o.value;
  close();
  sel.__dd.btn.focus();
  if (!changed) return;
  sel.value = o.value;
  sel.dispatchEvent(new Event('input', { bubbles: true }));
  sel.dispatchEvent(new Event('change', { bubbles: true }));
}

function close() {
  if (!open) return;
  open.menu.remove();
  open.sel.__dd.btn.setAttribute('aria-expanded', 'false');
  open.sel.__dd.wrap.classList.remove('open');
  open = null;
}

document.addEventListener('keydown', (e) => {
  if (!open) return;
  // Keys handled here must not also reach the button underneath (which would reopen the menu).
  const handled = () => { e.preventDefault(); e.stopPropagation(); };
  if (e.key === 'ArrowDown') { handled(); move(1); }
  else if (e.key === 'ArrowUp') { handled(); move(-1); }
  else if (e.key === 'Enter' || e.key === ' ') { handled(); const d = open.items[open.active]; if (d && !d.classList.contains('disabled')) choose(d.__opt); }
  else if (e.key === 'Escape') { handled(); const { sel } = open; close(); sel.__dd.btn.focus(); }
  else if (e.key === 'Tab') close();
  else if (e.key.length === 1 && /\S/.test(e.key)) {
    // Type-to-jump, like a native menu.
    clearTimeout(typedTimer);
    typed += e.key.toLowerCase();
    typedTimer = setTimeout(() => (typed = ''), 700);
    const i = open.items.findIndex((d) => d.textContent.trim().toLowerCase().startsWith(typed));
    if (i >= 0) setActive(i, true);
  }
}, true);

document.addEventListener('mousedown', (e) => {
  if (open && !open.menu.contains(e.target) && !open.sel.__dd.wrap.contains(e.target)) close();
});
window.addEventListener('resize', close);
window.addEventListener('scroll', (e) => { if (open && !open.menu.contains(e.target)) place(); }, true);
window.addEventListener('hashchange', close);

// Enhance every <select> now and whenever new ones are rendered.
const enhanceAll = (root) => root.querySelectorAll?.('select').forEach(enhance);
enhanceAll(document);
new MutationObserver((muts) => {
  for (const m of muts) m.addedNodes.forEach((n) => { if (n.nodeType === 1) { if (n.tagName === 'SELECT') enhance(n); else enhanceAll(n); } });
}).observe(document.body, { childList: true, subtree: true });

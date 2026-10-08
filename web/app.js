import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.58.0/+esm';
import { SUPABASE_URL, SUPABASE_KEY, APP_NAME } from './config.js';
import './select.js';
import { openCamera } from './camera.js';

const sb = createClient(SUPABASE_URL, SUPABASE_KEY);
const app = document.getElementById('app');

// Special barcodes you can print from the Labels page and scan to switch modes.
const CMD = { IN: 'CMD-IN', OUT: 'CMD-OUT', COUNT: 'CMD-COUNT', DONE: 'CMD-DONE' };

const LABEL_SIZES = {
  // Continuous rolls: the page width is the tape width and the label is only
  // as long as the page, so these give the shortest labels.
  'brother-62c': { name: 'Brother 62mm continuous roll (DK-2205 / DK-2251) — 2.4" × 1.25"', w: 2.44, h: 1.25 },
  'brother-29c': { name: 'Brother 29mm continuous roll (DK-2210) — 2.6" × 1.1"', w: 2.6, h: 1.1 },
  'brother-dk1201': { name: 'Brother DK-1201 — 1.1" × 3.5" (address)', w: 3.5, h: 1.1 },
  'brother-dk1209': { name: 'Brother DK-1209 — 1.1" × 2.4" (small address)', w: 2.4, h: 1.1 },
  'brother-dk1208': { name: 'Brother DK-1208 — 1.4" × 3.5" (large address)', w: 3.5, h: 1.4 },
  'brother-dk1202': { name: 'Brother DK-1202 — 2.4" × 3.9" (shipping)', w: 3.9, h: 2.4 },
  'dymo-30334': { name: 'Dymo 30334 — 2¼" × 1¼"', w: 2.25, h: 1.25 },
  'dymo-30252': { name: 'Dymo 30252 — 3½" × 1⅛" (address)', w: 3.5, h: 1.125 },
  'dymo-30336': { name: 'Dymo 30336 — 2⅛" × 1"', w: 2.125, h: 1 },
  'zebra-2x1': { name: 'Zebra / Rollo — 2" × 1"', w: 2, h: 1 },
  'zebra-3x2': { name: 'Zebra / Rollo — 3" × 2"', w: 3, h: 2 },
  'zebra-4x6': { name: 'Shipping — 4" × 6"', w: 4, h: 6 },
};

// Logo mark: three stacked crates.
const MARK = `<svg viewBox="0 0 40 40" width="26" height="26" fill="none" aria-hidden="true">
  <rect x="6" y="22" width="12" height="11" rx="1.5" fill="currentColor" opacity=".45"/>
  <rect x="21" y="22" width="12" height="11" rx="1.5" fill="currentColor" opacity=".7"/>
  <rect x="13.5" y="9" width="12" height="11" rx="1.5" fill="#ad4e12"/></svg>`;

const state = {
  session: null,
  me: null,
  stockMode: 'out',
  stockLog: [],
  kiosk: { person: null, event: null, dest: null, mode: 'out', qty: 1, log: [], idle: null, pendingTool: null },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const isAdmin = () => state.me?.role === 'admin';
const LOADER = '<div class="loader" role="status" aria-label="Loading"><span></span><span></span><span></span></div>';
const pageHead = (eyebrow, title, sub = '') =>
  `<header class="page-head"><div class="eyebrow">${eyebrow}</div><h1>${title}</h1>${sub ? `<p class="lede">${sub}</p>` : ''}</header>`;
const isKiosk = () => state.me?.role === 'kiosk';

// What each role can open. Only admin and the kiosk can change anything; the
// database enforces the same rules (see 0008_view_roles.sql).
const ALL_PAGES = [
  ['kiosk', 'Check In / Out'], ['out', 'Who Has What'], ['events', 'Events'],
  ['items/facilities', 'Facilities Stock'], ['items/maintenance', 'Maintenance Stock'], ['items/events', 'Event Stock'], ['toollist', 'Tools'],
  ['stock', 'Scan Stock'], ['history', 'History'], ['labels', 'Labels'], ['people', 'People'], ['locations', 'Locations'],
];
const ROLES = {
  admin: { label: 'Admin', act: true, home: 'kiosk', stock: ['facilities', 'maintenance', 'events'], tools: true,
    scanStock: ['facilities', 'maintenance', 'events'], scanTools: true,
    pages: [...ALL_PAGES.map(([k]) => k), 'item', 'tool', 'event'] },
  kiosk: { label: 'Kiosk (shared iPad)', act: true, home: 'kiosk', stock: ['facilities', 'maintenance', 'events'], tools: true,
    scanStock: ['facilities', 'maintenance', 'events'], scanTools: true,
    pages: ['kiosk', 'out', 'events', 'event'] },
  // Team roles scan their own area from their own login (phone camera or scanner).
  member: { label: 'Facilities & Maintenance', act: false, home: 'kiosk', stock: ['facilities', 'maintenance'], tools: true,
    scanStock: ['facilities', 'maintenance'], scanTools: true,
    pages: ['kiosk', 'items/facilities', 'items/maintenance', 'toollist', 'out', 'history', 'item', 'tool'] },
  maintenance: { label: 'Maintenance manager', act: false, home: 'kiosk', stock: ['maintenance'], tools: true,
    scanStock: ['maintenance'], scanTools: true,
    pages: ['kiosk', 'items/maintenance', 'toollist', 'out', 'history', 'item', 'tool'] },
  custodian: { label: 'Custodian manager', act: false, home: 'kiosk', stock: ['facilities'], tools: false,
    scanStock: ['facilities'], scanTools: false,
    pages: ['kiosk', 'items/facilities', 'history', 'item'] },
  oversight: { label: 'Oversight', act: false, home: 'out', stock: ['facilities', 'maintenance', 'events'], tools: true,
    scanStock: [], scanTools: false,
    pages: ['out', 'events', 'items/facilities', 'items/maintenance', 'items/events', 'toollist', 'history', 'locations', 'item', 'tool', 'event'] },
};
const ROLE_ORDER = ['member', 'maintenance', 'custodian', 'oversight', 'admin', 'kiosk'];
const myRole = () => ROLES[state.me?.role] || ROLES.member;
const canAct = () => myRole().act;
const pageKey = (name, arg) => (name === 'items' ? `items/${stockKind(arg)}` : name);

function fmtDate(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function since(ts) {
  const mins = Math.round((Date.now() - new Date(ts)) / 60000);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.round(mins / 60);
  if (hrs < 48) return `${hrs}h`;
  return `${Math.round(hrs / 24)}d`;
}

let toastTimer;
function toast(msg, isErr = false) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = `toast show${isErr ? ' err' : ''}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.className = 'toast'), 3500);
}

// In-app dialogs (instead of the browser's own prompt/confirm boxes).
// askText resolves to the trimmed text, or null if cancelled; askConfirm to true/false.
function dialog({ title, message = '', input = null, ok = 'OK', danger = false }) {
  return new Promise((resolve) => {
    const back = document.createElement('div');
    back.className = 'modal-back';
    back.innerHTML = `
      <form class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <h3 id="modal-title">${esc(title)}</h3>
        ${message ? `<p class="muted">${esc(message)}</p>` : ''}
        ${input ? `<input class="modal-input" type="text" autocomplete="off" placeholder="${esc(input.placeholder || '')}" value="${esc(input.value || '')}">` : ''}
        <div class="modal-actions">
          <button type="button" class="btn" data-cancel>Cancel</button>
          <button class="btn ${danger ? 'bad-solid' : 'primary'}">${esc(ok)}</button>
        </div>
      </form>`;
    const prev = document.activeElement;
    const field = back.querySelector('.modal-input');
    const done = (value) => {
      document.removeEventListener('keydown', onKey, true);
      back.remove();
      prev?.focus?.();
      resolve(value);
    };
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); done(input ? null : false); } };
    back.querySelector('form').addEventListener('submit', (e) => {
      e.preventDefault();
      if (!input) return done(true);
      const v = field.value.trim();
      if (!v && input.required !== false) { field.focus(); return; }
      done(v);
    });
    back.querySelector('[data-cancel]').addEventListener('click', () => done(input ? null : false));
    back.addEventListener('mousedown', (e) => { if (e.target === back) done(input ? null : false); });
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(back);
    (field || back.querySelector('button.primary, button.bad-solid')).focus();
    field?.select();
  });
}
const askText = (title, opts = {}) => dialog({ title, input: { value: opts.value, placeholder: opts.placeholder, required: opts.required }, ok: opts.ok || 'Save', message: opts.message });
const askConfirm = (title, opts = {}) => dialog({ title, message: opts.message, ok: opts.ok || 'OK', danger: opts.danger });

function errMsg(e) {
  return e?.message || e?.error_description || String(e);
}

async function rpc(name, args) {
  const { data, error } = await sb.rpc(name, args);
  if (error) throw new Error(error.message);
  return data;
}

async function q(promise) {
  const { data, error } = await promise;
  if (error) throw new Error(error.message);
  return data;
}

function downloadCsv(filename, rows) {
  if (!rows.length) return toast('Nothing to export');
  const cols = Object.keys(rows[0]);
  const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const text = [cols.map(cell).join(','), ...rows.map((r) => cols.map((c) => cell(r[c])).join(','))].join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

function beep(ok) {
  try {
    const ctx = (beep.ctx ||= new AudioContext());
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = ok ? 880 : 220;
    g.gain.value = 0.08;
    o.connect(g).connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + (ok ? 0.08 : 0.3));
  } catch { /* sound is optional */ }
}

// Scanners act like keyboards: they type the code and press Enter.
function bindScanner(input, onScan) {
  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const code = input.value.trim();
    input.value = '';
    if (code) onScan(code);
  });
  const refocus = (e) => {
    if (!document.body.contains(input)) return document.removeEventListener('click', refocus);
    if (document.querySelector('.modal-back')) return;
    if (!e.target.closest('input, select, textarea, button, a')) input.focus();
  };
  document.addEventListener('click', refocus);

  // A scan typed while something else has focus (a button, a dropdown, the
  // page itself, or the quantity box) still goes to the scan box: the first
  // character moves focus there, and the rest of the scan plus Enter follow.
  const capture = (e) => {
    if (!document.body.contains(input)) return document.removeEventListener('keydown', capture, true);
    if (e.target === input || e.ctrlKey || e.metaKey || e.altKey || e.key.length !== 1) return;
    if (document.querySelector('.dd-menu, .modal-back')) return; // typing in an open dropdown or dialog
    const t = e.target;
    const isText = t.matches?.('textarea, input:not([type]), input[type=text], input[type=search], input[type=email], input[type=password]');
    const isNumber = t.matches?.('input[type=number], input[type=date]');
    if (isText) return; // someone is typing a note or a name
    if (isNumber && /[0-9.\-]/.test(e.key)) return; // typing a quantity
    e.preventDefault();
    input.focus();
    input.value += e.key;
  };
  document.addEventListener('keydown', capture, true);
  input.focus();
}

const loadMembers = () => q(sb.from('team_members').select('*').order('name'));
const loadItems = () => q(sb.from('items').select('*').order('name'));
const loadTools = () => q(sb.from('tools').select('*').order('name'));

// ---------------------------------------------------------------------------
// Auth & boot
// ---------------------------------------------------------------------------

document.getElementById('brand').innerHTML = `<a href="#/kiosk" class="brand-link"><span class="brand-mark">${MARK}</span><span class="brand-name">${esc(APP_NAME)}</span></a>`;
document.title = APP_NAME;

sb.auth.onAuthStateChange((event, session) => {
  // Supabase runs this callback while holding its auth lock, so calling back
  // into sb.auth here (as boot() does) would deadlock. Defer to the next tick.
  setTimeout(() => {
    if (event === 'PASSWORD_RECOVERY') return renderSetPassword();
    if (event === 'SIGNED_IN' || event === 'SIGNED_OUT') {
      const changed = (session?.user?.id || null) !== (state.session?.user?.id || null);
      state.session = session;
      if (changed) boot();
    }
  }, 0);
});

async function signOut(expired = false) {
  if (expired !== true && isKiosk() && !(await askConfirm('Sign the kiosk out?', { message: 'Someone will need its password to sign back in.', ok: 'Sign out', danger: true }))) return;
  const btn = document.getElementById('signout');
  if (btn) { btn.disabled = true; btn.textContent = 'Signing out…'; }
  try {
    // 'local' clears this device even if the server can't be reached.
    await sb.auth.signOut({ scope: 'local' });
  } catch { /* fall through: we still reset the screen below */ }
  // If the server already ended this session (e.g. signed out elsewhere), the
  // library keeps the dead token saved. Remove it so a reload stays signed out.
  try {
    Object.keys(localStorage).filter((k) => /^sb-.*-auth-token/.test(k)).forEach((k) => localStorage.removeItem(k));
  } catch { /* storage unavailable */ }
  clearTimeout(state.kiosk.idle);
  state.kiosk = { person: null, event: null, dest: null, mode: 'out', qty: 1, log: [], idle: null, pendingTool: null };
  state.stockLog = [];
  state.session = null;
  state.me = null;
  history.replaceState(null, '', location.pathname);
  renderTopbar();
  renderLogin('signin', expired === true ? 'Your session ended. Please sign in again.' : '');
}

// Keep the splash up briefly so it reads as intentional rather than a flicker.
const bootStarted = Date.now();
function hideSplash() {
  const el = document.getElementById('splash');
  if (!el || el.classList.contains('gone')) return;
  setTimeout(() => {
    el.classList.add('gone');
    setTimeout(() => el.remove(), 500);
  }, Math.max(0, 700 - (Date.now() - bootStarted)));
}

async function boot() {
  try {
    await bootInner();
  } finally {
    hideSplash();
  }
}

async function bootInner() {
  const { data } = await sb.auth.getSession();
  state.session = data.session;
  state.me = null;
  renderTopbar();
  if (!state.session) return renderLogin();

  try {
    const email = state.session.user.email.toLowerCase();
    const rows = await q(sb.from('team_members').select('*').eq('email', email).eq('active', true));
    state.me = rows[0] || null;
    if (!state.me) {
      return (await rpc('needs_first_admin')) ? renderClaimAdmin() : renderNotOnList();
    }
  } catch (e) {
    app.innerHTML = `<div class="card"><b>Couldn't load your account.</b><p class="muted">${esc(errMsg(e))}</p></div>`;
    return;
  }
  renderTopbar();
  await route();
}

function renderTopbar() {
  const nav = document.getElementById('nav');
  const who = document.getElementById('who');
  if (!state.me) {
    nav.innerHTML = '';
    who.innerHTML = state.session ? `<button id="signout">Sign out</button>` : '';
  } else {
    const links = ALL_PAGES.filter(([k]) => myRole().pages.includes(k));
    const [h0, h1] = location.hash.slice(2).split('/');
    const cur = h0 ? pageKey(h0, h1) : myRole().home;
    nav.innerHTML = links.map(([k, t]) => `<a href="#/${k}" class="${cur === k ? 'active' : ''}">${t}</a>`).join('');
    who.innerHTML = `<span>${esc(state.me.name)} · ${esc(myRole().label)}</span><button id="signout">Sign out</button>`;
  }
  document.getElementById('signout')?.addEventListener('click', signOut);
}

function renderLogin(mode = 'signin', note = '') {
  const titles = { signin: 'Sign in', signup: 'Create your account', forgot: 'Reset password' };
  app.innerHTML = `
    <div class="auth">
      <div class="auth-mark">${MARK}</div>
      <div class="eyebrow">${esc(APP_NAME)}</div>
      <h1>${{ signin: 'Welcome <span class="accent">back</span>.', signup: 'Create your <span class="accent">account</span>.', forgot: 'Reset your <span class="accent">password</span>.' }[mode]}</h1>
      ${note ? `<p class="big-status info" style="font-size:15px">${esc(note)}</p>` : ''}
      <form id="auth-form">
        <label>Work email <input type="email" name="email" required autocomplete="email"></label>
        ${mode !== 'forgot' ? `<label>Password <input type="password" name="password" required minlength="8" autocomplete="${mode === 'signup' ? 'new-password' : 'current-password'}"></label>` : ''}
        <button class="btn primary block" type="submit">${titles[mode]}</button>
      </form>
      <p class="muted" style="margin-top:14px">
        ${mode === 'signin' ? `New here? <a href="#" data-mode="signup">Create an account</a> · <a href="#" data-mode="forgot">Forgot password?</a>` : `<a href="#" data-mode="signin">Back to sign in</a>`}
      </p>
      <p class="muted" style="font-size:13px">Only people your admin has added to the team can see anything.</p>
    </div>`;
  app.querySelectorAll('[data-mode]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); renderLogin(a.dataset.mode); }));
  app.querySelector('#auth-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const email = f.get('email').trim();
    const password = f.get('password');
    const btn = e.target.querySelector('button');
    btn.disabled = true;
    try {
      if (mode === 'signin') {
        const { error } = await sb.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else if (mode === 'signup') {
        const { data, error } = await sb.auth.signUp({ email, password, options: { emailRedirectTo: location.origin } });
        if (error) throw error;
        if (!data.session) return renderLogin('signin', 'Check your email for a confirmation link, then sign in.');
      } else {
        const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin });
        if (error) throw error;
        return renderLogin('signin', 'If that email has an account, a reset link is on its way.');
      }
    } catch (err) {
      toast(errMsg(err), true);
      btn.disabled = false;
    }
  });
}

function renderSetPassword() {
  app.innerHTML = `
    <div class="auth"><div class="auth-mark">${MARK}</div><h1>Choose a new <span class="accent">password</span>.</h1>
      <form id="pw-form"><label>New password <input type="password" name="password" required minlength="8" autocomplete="new-password"></label>
      <button class="btn primary">Save password</button></form></div>`;
  app.querySelector('#pw-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const { error } = await sb.auth.updateUser({ password: new FormData(e.target).get('password') });
    if (error) return toast(errMsg(error), true);
    toast('Password updated');
    location.hash = '#/kiosk';
    boot();
  });
}

function renderClaimAdmin() {
  app.innerHTML = `
    <div class="auth"><div class="auth-mark">${MARK}</div><div class="eyebrow">First-time setup</div><h1>Set up the <span class="accent">shop</span>.</h1>
      <p>Nobody has set this app up yet. You'll become the admin and can add the rest of your team.</p>
      <form id="claim"><label>Your name <input name="name" required></label><button class="btn primary">Make me the admin</button></form></div>`;
  app.querySelector('#claim').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await rpc('claim_first_admin', { p_name: new FormData(e.target).get('name') });
      boot();
    } catch (err) { toast(errMsg(err), true); }
  });
}

function renderNotOnList() {
  app.innerHTML = `
    <div class="auth"><div class="auth-mark">${MARK}</div><h1>Almost <span class="accent">there</span>.</h1>
      <p>You're signed in as <b>${esc(state.session.user.email)}</b>, but you're not on the team list yet.</p>
      <p class="muted">Ask an admin to add this email on the People page, then reload.</p>
      <button class="btn" onclick="location.reload()">Reload</button></div>`;
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const routes = {
  kiosk: renderKiosk, events: renderEvents, event: renderEvent,
  stock: renderStock, out: renderOut, items: renderItems, item: renderItem,
  toollist: renderToolList, tool: renderTool, history: renderHistory, labels: renderLabels, people: renderPeople,
  locations: renderLocations,
};

window.addEventListener('hashchange', () => state.me && route());

async function route() {
  const [name, ...args] = location.hash.slice(2).split('/');
  // Anything a role can't open goes to that role's home page.
  if (!name || !routes[name] || !myRole().pages.includes(pageKey(name, args[0]))) {
    const home = `#/${myRole().home}`;
    if (location.hash !== home) { location.hash = home; return; }
  }
  const fn = routes[name] || renderKiosk;
  if (name !== 'kiosk') clearTimeout(state.kiosk.idle);
  renderTopbar();
  app.innerHTML = LOADER;
  try {
    await fn(...args);
  } catch (e) {
    if (/JWT|session/i.test(errMsg(e))) return signOut(true);
    app.innerHTML = `<div class="big-status err">${esc(errMsg(e))}</div>`;
  }
}

// ---------------------------------------------------------------------------
// Scan Stock
// ---------------------------------------------------------------------------

async function renderStock() {
  const items = await loadItems();
  const active = items.filter((i) => i.active);
  const modes = [['in', 'Scan IN', 'in'], ['out', 'Scan OUT', 'out']];
  if (isAdmin()) modes.push(['adjust', 'Set COUNT', 'primary']);
  if (state.stockMode === 'adjust' && !isAdmin()) state.stockMode = 'out';

  app.innerHTML = `
    ${pageHead('Stock room', 'Scan <span class="accent">stock</span>', 'Counts, restocks and quick pulls from your own device.')}
    <div class="card">
      <div class="modes" id="modes">${modes.map(([k, t, c]) => `<button class="btn ${c} ${state.stockMode === k ? 'on' : ''}" data-mode="${k}">${t}</button>`).join('')}</div>
      <div class="row" style="margin-top:14px">
        <label style="width:110px">Quantity <input id="qty" type="number" min="0" value="1"></label>
        <label style="flex:1;min-width:200px">Note (optional) <input id="note" placeholder="job #, reason, vendor…"></label>
      </div>
      <div style="margin-top:14px">
        <input id="scan" class="scanbox" placeholder="Scan an item barcode…" autocomplete="off">
        <div class="scan-hint" id="mode-hint"></div>
      </div>
      <div id="status"></div>
      <details style="margin-top:8px"><summary class="muted">No label? Pick the item instead</summary>
        <div class="row" style="margin-top:8px">
          <select id="pick" style="flex:1;min-width:200px"><option value="">Choose an item…</option>${Object.entries(STOCK).map(([k, m]) => `<optgroup label="${m.plain}">${active.filter((i) => i.category === k).map((i) => `<option value="${esc(i.code)}">${esc(i.name)} (${i.quantity} on hand)</option>`).join('')}</optgroup>`).join('')}</select>
          <button class="btn primary" id="pick-go">Apply</button>
        </div>
      </details>
    </div>
    <h2>This session</h2>
    <div class="card"><ul class="log" id="log"></ul></div>`;

  const scan = app.querySelector('#scan');
  const qty = app.querySelector('#qty');
  const note = app.querySelector('#note');
  const status = app.querySelector('#status');

  const paintMode = () => {
    app.querySelectorAll('#modes .btn').forEach((b) => b.classList.toggle('on', b.dataset.mode === state.stockMode));
    app.querySelector('#mode-hint').textContent = {
      in: 'Adding stock. Each scan adds the quantity above, then quantity resets to 1.',
      out: 'Taking stock. Each scan removes the quantity above, then quantity resets to 1.',
      adjust: 'Counting. Each scan SETS the on-hand count to the quantity above.',
    }[state.stockMode];
  };
  const paintLog = () => {
    app.querySelector('#log').innerHTML = state.stockLog.length
      ? state.stockLog.map((l) => `<li><span><span class="pill ${l.type}">${l.type.toUpperCase()}</span> ${esc(l.text)}</span><span class="muted">${l.time}</span></li>`).join('')
      : '<li class="muted">Nothing scanned yet.</li>';
  };
  const show = (cls, html) => (status.innerHTML = `<div class="big-status ${cls}">${html}</div>`);

  app.querySelector('#modes').addEventListener('click', (e) => {
    const b = e.target.closest('[data-mode]');
    if (!b) return;
    state.stockMode = b.dataset.mode;
    paintMode();
    scan.focus();
  });

  async function apply(code) {
    const upper = code.toUpperCase();
    if (upper === CMD.IN || upper === CMD.OUT || upper === CMD.COUNT) {
      const m = { [CMD.IN]: 'in', [CMD.OUT]: 'out', [CMD.COUNT]: 'adjust' }[upper];
      if (m === 'adjust' && !isAdmin()) return show('err', 'Only admins can set counts.');
      state.stockMode = m;
      paintMode();
      return show('info', `Mode: ${m === 'adjust' ? 'SET COUNT' : `SCAN ${m.toUpperCase()}`}`);
    }
    if (upper === CMD.DONE) { qty.value = 1; note.value = ''; return show('info', 'Cleared.'); }

    const n = parseInt(qty.value, 10);
    try {
      const res = await rpc('scan_item', { p_code: code, p_type: state.stockMode, p_qty: Number.isNaN(n) ? 1 : n, p_note: note.value });
      const it = res.item;
      const verb = state.stockMode === 'adjust' ? `Count set (${res.change >= 0 ? '+' : ''}${res.change})` : `${Math.abs(res.change)} ${state.stockMode === 'in' ? 'in' : 'out'}`;
      const low = it.reorder_level > 0 && it.quantity <= it.reorder_level;
      show('ok', `${esc(verb)} — <b>${esc(it.name)}</b>. Now ${it.quantity} on hand${esc(packNote(it))}.${low ? ` <span class="pill low">LOW — reorder</span>` : ''}`);
      state.stockLog.unshift({ type: state.stockMode, text: `${verb} · ${it.name} → ${it.quantity} left`, time: new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) });
      state.stockLog = state.stockLog.slice(0, 50);
      paintLog();
      qty.value = 1;
      note.value = '';
      beep(true);
    } catch (e) {
      beep(false);
      let msg = errMsg(e);
      if (/No item with code/.test(msg)) {
        const hit = await rpc('lookup_code', { p_code: code }).catch(() => null);
        if (hit?.kind === 'tool') msg = `${hit.record.name} is a tool — use the Check In / Out page.`;
      }
      show('err', esc(msg));
    }
    scan.focus();
  }

  bindScanner(scan, apply);
  app.querySelector('#pick-go').addEventListener('click', () => {
    const v = app.querySelector('#pick').value;
    if (v) apply(v);
  });
  paintMode();
  paintLog();
}

// ---------------------------------------------------------------------------
// Check In / Out — the shared warehouse kiosk (works on any device too)
// ---------------------------------------------------------------------------

const KIOSK_IDLE_MS = 90000;
const people = (members) => members.filter((m) => m.active && m.role !== 'kiosk');
const openEvents = async () => q(sb.from('events').select('*').neq('status', 'closed').order('starts_on', { ascending: true, nullsFirst: false }));

async function renderKiosk() {
  const [members, events, locations] = await Promise.all([loadMembers(), openEvents(), loadLocations()]);
  const crew = people(members);
  const k = state.kiosk;
  if (k.event && !events.some((e) => e.id === k.event.id)) k.event = null;
  if (k.dest && !locations.some((l) => l.name === k.dest)) k.dest = null;
  // Where things are going: a location or an offsite event. Tools can't go out without one.
  const whereText = () => (k.event ? k.event.name : k.dest || '');
  // On someone's own login it's them doing the scanning; only the shared
  // kiosk login has to ask who's there.
  const self = isKiosk() ? null : crew.find((m) => m.id === state.me.id) || null;
  if (!k.person && self) k.person = self;

  app.innerHTML = `
    <div class="kiosk">
      <div id="k-who"></div>
      <div class="scanrow">
        <input id="scan" class="scanbox" placeholder="${isKiosk() ? 'Scan a tool, item or name label…' : `Scan ${[myRole().scanTools && 'a tool', myRole().scanStock.length && 'stock'].filter(Boolean).join(' or ')}…`}" autocomplete="off" autocapitalize="characters">
        ${isKiosk() ? '' : `<button class="btn primary cam-btn" id="cam" type="button" title="Use this device's camera as the scanner">
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3v11H4z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><circle cx="12" cy="13" r="3.6" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>
          <span>Scan with camera</span></button>`}
      </div>
      <div id="status"></div>
      <h2>This session</h2>
      <div class="card"><ul class="log" id="log"></ul></div>
    </div>`;

  const scan = app.querySelector('#scan');
  const status = app.querySelector('#status');
  const show = (cls, html) => (status.innerHTML = `<div class="big-status ${cls}">${html}</div>`);
  // Put the tool's photo beside the scan result so people can see they grabbed the right one.
  const showToolPhoto = async (tool) => {
    const box = status.querySelector('.big-status');
    const url = tool.photo_path && await photoUrl(tool.photo_path);
    if (!url || !box?.isConnected) return;
    box.classList.add('with-photo');
    box.innerHTML = `<img class="status-photo" src="${esc(url)}" alt=""><div>${box.innerHTML}</div>`;
  };
  const stamp = () => new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const log = (type, text) => {
    k.log.unshift({ type, text, time: stamp() });
    k.log = k.log.slice(0, 40);
    paintLog();
  };
  const paintLog = () => {
    app.querySelector('#log').innerHTML = k.log.length
      ? k.log.map((l) => `<li><span><span class="pill ${l.type}">${l.type.toUpperCase()}</span> ${esc(l.text)}</span><span class="muted">${l.time}</span></li>`).join('')
      : '<li class="muted">Nothing yet.</li>';
  };

  const resetIdle = () => {
    clearTimeout(k.idle);
    if (k.person && isKiosk()) k.idle = setTimeout(() => { endSession(); show('info', 'Timed out — tap your name to start again.'); }, KIOSK_IDLE_MS);
  };
  const endSession = () => {
    k.person = self;
    k.event = null;
    k.dest = null;
    k.mode = 'out';
    k.qty = 1;
    k.pendingTool = null;
    k.pendingItem = null;
    closeSheet();
    clearTimeout(k.idle);
    paintWho();
    scan.focus();
  };
  const startSession = (m) => {
    k.person = m;
    paintWho();
    resetIdle();
  };

  function paintWho() {
    const el = app.querySelector('#k-who');
    if (!k.person) {
      el.innerHTML = `
        <div class="card">
          <div class="eyebrow">Check in / out</div>
          <h1 class="kiosk-title">Who are <span class="accent">you</span>?</h1>
          <p class="lede">Tap your name (or scan your name label) to start. <b>Just returning a tool?</b> Scan it — no name needed.</p>
          <div class="people-pick">${crew.map((m) => `<button class="btn" data-person="${m.id}">${esc(m.name)}</button>`).join('')}</div>
        </div>`;
      el.querySelectorAll('[data-person]').forEach((b) => b.addEventListener('click', () => {
        startSession(crew.find((m) => m.id === b.dataset.person));
        if (k.pendingTool) { const t = k.pendingTool; k.pendingTool = null; doCheckout(t); }
        scan.focus();
      }));
      return;
    }
    el.innerHTML = `
      <div class="card">
        <div class="row" style="justify-content:space-between;align-items:center">
          <div><div class="eyebrow">${isKiosk() ? 'Signed in at the kiosk' : 'Checking in / out as'}</div><h1 class="kiosk-title" style="margin:0">Hi, <span class="accent">${esc(k.person.name)}</span></h1></div>
          <button class="btn bad" id="k-done" style="font-size:18px;padding:10px 22px">Done</button>
        </div>
        <p class="scan-hint">${[myRole().scanTools && 'Tools: scan to sign out, scan again later to return.', myRole().scanStock.length && 'Stock: scan it, then choose how many and Take or Put back.'].filter(Boolean).join(' ')}</p>
      </div>`;
    el.querySelector('#k-done').addEventListener('click', () => { endSession(); show('ok', 'All set — thanks!'); });
    el.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => {
      k.mode = b.dataset.mode;
      paintWho(); resetIdle(); scan.focus();
    }));
    const qtyEl = el.querySelector('#k-qty');
    qtyEl?.addEventListener('change', () => { k.qty = Math.max(1, parseInt(qtyEl.value, 10) || 1); qtyEl.value = k.qty; });
    el.querySelectorAll('[data-step]').forEach((b) => b.addEventListener('click', () => {
      k.qty = Math.max(1, k.qty + Number(b.dataset.step));
      qtyEl.value = k.qty;
      resetIdle();
    }));
  }

  // ---- Pop-up sheets (where is it going? / how many?) ----
  // Places are "loc:<name>" or "ev:<event id>"; the last one used is remembered
  // for the session and highlighted next time.
  const placeKey = () => (k.event ? `ev:${k.event.id}` : k.dest ? `loc:${k.dest}` : '');
  const setPlace = (key) => {
    k.event = key?.startsWith('ev:') ? events.find((e) => e.id === key.slice(3)) || null : null;
    k.dest = key?.startsWith('loc:') ? key.slice(4) : null;
  };
  const placeName = (key) => (key?.startsWith('ev:') ? events.find((e) => e.id === key.slice(3))?.name : key?.slice(4)) || '';
  const placeChips = (sel, attention) => `
    <div class="place-grid ${attention ? 'needs-pick' : ''}">
      ${locations.map((l) => `<button type="button" class="btn place ${sel === `loc:${l.name}` ? 'on primary' : ''}" data-place="loc:${esc(l.name)}">${esc(l.name)}</button>`).join('')}
      ${isAdmin() ? '<button type="button" class="btn place add" data-add-place>+ Add place</button>' : ''}
    </div>
    ${events.length ? `<div class="place-sub">Offsite events</div><div class="place-grid">
      ${events.map((e) => `<button type="button" class="btn place event ${sel === `ev:${e.id}` ? 'on primary' : ''}" data-place="ev:${e.id}">${esc(e.name)}${e.starts_on ? ` <span class="when">${new Date(`${e.starts_on}T12:00`).toLocaleDateString([], { month: 'short', day: 'numeric' })}</span>` : ''}</button>`).join('')}
    </div>` : ''}`;
  const bindPlaceChips = (root, onPick) => {
    root.querySelectorAll('[data-place]').forEach((b) => b.addEventListener('click', () => onPick(b.dataset.place)));
    root.querySelector('[data-add-place]')?.addEventListener('click', async () => {
      const name = await askText('New place', { placeholder: 'e.g. Maintenance, Youth Room', ok: 'Add' });
      if (!name) return;
      try { await rpc('add_location', { p_name: name }); } catch (err) { return toast(errMsg(err), true); }
      if (!locations.some((l) => l.name === name)) locations.push({ name });
      locations.sort((a, b) => a.name.localeCompare(b.name));
      onPick(`loc:${name}`);
    });
  };

  let sheetEl = null;
  function openSheet() {
    if (!sheetEl) {
      sheetEl = document.createElement('div');
      sheetEl.className = 'modal-back kiosk-sheet';
      sheetEl.innerHTML = '<div class="modal sheet" role="dialog" aria-modal="true"></div>';
      document.body.appendChild(sheetEl);
    }
    return sheetEl.firstElementChild;
  }
  function closeSheet() {
    sheetEl?.remove();
    sheetEl = null;
    k.picker = null;
    if (document.body.contains(scan)) scan.focus();
  }

  // Tools: always ask where it's going, with the last place highlighted.
  function doCheckout(tool) {
    const sheet = openSheet();
    const sel = placeKey();
    sheet.innerHTML = `
      <div class="sheet-head">
        <div class="sheet-photo" id="pk-photo"></div>
        <div><div class="eyebrow">Signing out to ${esc(k.person.name)}</div>
          <h3>Where is <span class="accent">${esc(tool.name)}</span> going?</h3></div>
      </div>
      ${placeChips(sel)}
      <p class="scan-hint">${sel ? `Press Enter or scan it again for <b>${esc(placeName(sel))}</b>.` : 'Tap where it\'s going.'}</p>
      <div class="modal-actions"><button type="button" class="btn" data-cancel>Cancel</button></div>`;
    const choose = (key) => { closeSheet(); setPlace(key); checkoutNow(tool); };
    const cancel = () => { closeSheet(); show('info', `Nothing signed out — <b>${esc(tool.name)}</b> is still here.`); };
    k.picker = { code: tool.code.toUpperCase(), selected: sel, choose, cancel };
    bindPlaceChips(sheet, choose);
    sheet.querySelector('[data-cancel]').addEventListener('click', cancel);
    (sheet.querySelector('.place.on') || sheet.querySelector('.place'))?.focus();
    photoUrl(tool.photo_path).then((url) => { const ph = sheet.querySelector('#pk-photo'); if (url && ph) ph.innerHTML = `<img src="${esc(url)}" alt="">`; });
    resetIdle();
  }

  async function checkoutNow(tool) {
    try {      await rpc('checkout_tool', { p_code: tool.code, p_borrower: k.person.id, p_event: k.event?.id || null, p_destination: k.event ? null : k.dest });
      beep(true);
      const where = whereText() ? ` for ${whereText()}` : '';
      show('ok', `<b>${esc(tool.name)}</b> signed out to <b>${esc(k.person.name)}</b>${esc(where)}.`);
      log('out', `${tool.name} → ${k.person.name}${where}`);
    } catch (e) { beep(false); show('err', esc(errMsg(e))); }
  }

  async function doReturn(tool, checkout) {
    try {
      await rpc('return_tool', { p_code: tool.code, p_condition: 'good' });
    } catch (e) { beep(false); return show('err', esc(errMsg(e))); }
    beep(true);
    log('in', `${tool.name} returned`);
    show('ok', `<b>${esc(tool.name)}</b> returned (was out to ${esc(checkout.borrower_name)} for ${since(checkout.checked_out_at)}).`);
    // Ask about its condition in a pop-up; "No" is the default (Enter or scan it again).
    const sheet = openSheet();
    sheet.innerHTML = `
      <div class="sheet-head">
        <div class="sheet-photo" id="pk-photo"></div>
        <div><div class="eyebrow">Returned · was out to ${esc(checkout.borrower_name)}</div>
          <h3>Is anything wrong with <span class="accent">${esc(tool.name)}</span>?</h3></div>
      </div>
      <div class="cond-grid">
        <button type="button" class="btn in big" data-cond="good">No, it's fine</button>
        <button type="button" class="btn out big" data-cond="damaged">Damaged</button>
        <button type="button" class="btn bad big" data-cond="needs_repair">Needs repair</button>
      </div>
      <p class="scan-hint">Press Enter or scan it again for <b>No</b>.</p>`;
    const fine = () => closeSheet();
    const flag = async (cond) => {
      closeSheet();
      const note = (await askText("What's wrong with it?", { placeholder: 'Optional', required: false, ok: 'Save' })) || '';
      try {
        await rpc('report_tool_problem', { p_tool: tool.id, p_condition: cond, p_note: note });
        show('info', `<b>${esc(tool.name)}</b> flagged ${cond.replace('_', ' ')} — it won't go out again until it's fixed.`);
        log('repair', `${tool.name} flagged ${cond.replace('_', ' ')}`);
      } catch (e) { show('err', esc(errMsg(e))); }
      showToolPhoto(tool);
      scan.focus();
    };
    k.picker = { code: tool.code.toUpperCase(), selected: 'good', choose: fine, cancel: fine };
    sheet.querySelectorAll('[data-cond]').forEach((b) => b.addEventListener('click', () => (b.dataset.cond === 'good' ? fine() : flag(b.dataset.cond))));
    sheet.querySelector('[data-cond="good"]').focus();
    photoUrl(tool.photo_path).then((url) => { const ph = sheet.querySelector('#pk-photo'); if (url && ph) ph.innerHTML = `<img src="${esc(url)}" alt="">`; });
  }

  // Stock: scan first, then a pop-up for how many, where, and which way.
  function paintItem(msg = '') {
    const p = k.pendingItem;
    if (!p) return closeSheet();
    const it = p.item;
    const sheet = openSheet();
    sheet.innerHTML = `
      <div class="sheet-head">
        <div><div class="eyebrow">Scanned</div>
          <h3>${esc(it.name)}</h3>
          <div class="muted" style="font-size:14px"><span class="code">${esc(it.code)}</span> · ${it.quantity} on hand${esc(packNote(it))}${it.location ? ` · ${esc(it.location)}` : ''}</div></div>
        <button type="button" class="btn small" id="i-cancel">Cancel</button>
      </div>
      <div class="qty-group"><div class="qty-label">How many?</div><div class="stepper">
        <button type="button" class="btn" data-istep="-1" aria-label="One less">−</button>
        <input id="i-qty" type="number" min="1" value="${p.qty}" inputmode="numeric" aria-label="Quantity">
        <button type="button" class="btn" data-istep="1" aria-label="One more">+</button>
      </div></div>
      <div class="qty-label" style="margin-top:16px">Where is it going?</div>
      ${placeChips(p.place, p.needPlace)}
      ${msg ? `<div class="sheet-msg">${msg}</div>` : ''}
      <div class="row item-actions">
        <button type="button" class="btn in big" id="i-back"><span>Put back <b class="n">${p.qty}</b></span></button>
        <button type="button" class="btn out big" id="i-take"><span>Take <b class="n">${p.qty}</b></span>${p.place ? `<span class="sub">to ${esc(placeName(p.place))}</span>` : ''}</button>
      </div>
      <p class="scan-hint">Scan it again to add one more.</p>`;
    const qtyEl = sheet.querySelector('#i-qty');
    // Keep the number on the buttons in step with the box.
    const showQty = () => sheet.querySelectorAll('.n').forEach((n) => (n.textContent = p.qty));
    qtyEl.addEventListener('focus', () => qtyEl.select());
    qtyEl.addEventListener('input', () => { const v = parseInt(qtyEl.value, 10); if (v >= 1) { p.qty = v; showQty(); } resetIdle(); });
    qtyEl.addEventListener('change', () => { p.qty = Math.max(1, parseInt(qtyEl.value, 10) || 1); qtyEl.value = p.qty; showQty(); });
    sheet.querySelectorAll('[data-istep]').forEach((b) => b.addEventListener('click', () => {
      p.qty = Math.max(1, p.qty + Number(b.dataset.istep));
      qtyEl.value = p.qty;
      showQty();
      resetIdle();
    }));
    bindPlaceChips(sheet, (key) => { p.place = key; p.needPlace = false; paintItem(); });
    sheet.querySelector('#i-take').addEventListener('click', () => doStock('out'));
    sheet.querySelector('#i-back').addEventListener('click', () => doStock('in'));
    sheet.querySelector('#i-cancel').addEventListener('click', () => { cancelItem(); show('info', 'Cancelled.'); });
    sheet.querySelector(p.place ? '#i-take' : '.place')?.focus();
    resetIdle();
  }

  function cancelItem() {
    k.pendingItem = null;
    closeSheet();
  }

  async function doStock(type) {
    const p = k.pendingItem;
    if (!p) return;
    if (type === 'out' && !p.place) { p.needPlace = true; beep(false); return paintItem('Pick where it\'s going first.'); }
    const qtyEl = document.querySelector('#i-qty');
    if (qtyEl) p.qty = Math.max(1, parseInt(qtyEl.value, 10) || p.qty);
    // Taking: remember the place for next time. Putting back: only an event matters (event returns).
    if (type === 'out') setPlace(p.place);
    const ev = p.place?.startsWith('ev:') ? events.find((e) => e.id === p.place.slice(3)) : null;
    try {
      const res = await rpc('scan_item', { p_code: p.item.code, p_type: type, p_qty: p.qty, p_member: k.person.id,
        p_event: ev?.id || null, p_destination: type === 'out' && !ev ? k.dest : null });
      const it = res.item;
      const low = it.reorder_level > 0 && it.quantity <= it.reorder_level;
      const where = type === 'out' ? ` (${placeName(p.place)})` : ev ? ` (from ${ev.name})` : '';
      beep(true);
      k.pendingItem = null;
      closeSheet();
      show('ok', `${type === 'in' ? 'Put back' : 'Took'} ${p.qty} × <b>${esc(it.name)}</b>${esc(where)}. ${it.quantity} left${esc(packNote(it))}.${low ? ' <span class="pill low">LOW — tell the office</span>' : ''}`);
      log(type, `${p.qty} × ${it.name}${where} · ${k.person.name}`);
    } catch (e) { beep(false); paintItem(esc(errMsg(e))); }
    resetIdle();
  }

  // While a pop-up is open the scanner still works: keystrokes are collected
  // here and handed to onScan when Enter arrives.
  let sheetBuf = '';
  const sheetKeys = (e) => {
    if (!document.body.contains(scan)) return document.removeEventListener('keydown', sheetKeys, true);
    if (!sheetEl || document.querySelector('.modal-back:not(.kiosk-sheet)')) return;
    if (e.key === 'Escape') { e.preventDefault(); sheetBuf = ''; if (k.picker) k.picker.cancel(); else { cancelItem(); show('info', 'Cancelled.'); } return; }
    if (e.target.matches?.('input[type=number]') && /[0-9]/.test(e.key) && !sheetBuf) return; // typing a quantity
    if (e.key === 'Enter') {
      if (!sheetBuf) return; // Enter on the highlighted button
      e.preventDefault();
      const code = sheetBuf;
      sheetBuf = '';
      onScan(code);
      return;
    }
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); sheetBuf += e.key; }
  };
  document.addEventListener('keydown', sheetKeys, true);

  async function onScan(code) {
    const upper = code.toUpperCase();
    resetIdle();
    if (k.picker) {
      // Scanning the same tool again confirms the highlighted place; anything else cancels.
      const pk = k.picker;
      if (upper === pk.code) return pk.selected ? pk.choose(pk.selected) : undefined;
      pk.cancel();
    }
    if (upper === CMD.DONE) {
      if (k.pendingItem) { cancelItem(); return show('info', 'Cancelled.'); }
      endSession();
      return show('ok', 'All set — thanks!');
    }
    if (upper === CMD.IN || upper === CMD.OUT) {
      if (!k.pendingItem) return show('info', 'Scan a stock item first, then Take or Put back.');
      return doStock(upper === CMD.IN ? 'in' : 'out');
    }

    let hit;
    try { hit = await rpc('lookup_code', { p_code: code }); } catch (e) { return show('err', esc(errMsg(e))); }

    if (hit.kind === 'person') {
      const m = crew.find((x) => x.id === hit.record.id);
      if (!m) { beep(false); return show('err', 'That person is inactive.'); }
      startSession(m);
      beep(true);
      if (k.pendingTool) { const t = k.pendingTool; k.pendingTool = null; return doCheckout(t); }
      return show('info', `Hi ${esc(m.name)} — scan what you're taking or returning.`);
    }

    if (hit.kind === 'tool' && k.pendingItem) {
      beep(false);
      return paintItem(`Finish <b>${esc(k.pendingItem.item.name)}</b> first: tap Take or Put back, or Cancel.`);
    }

    if (hit.kind === 'tool') {
      const tool = hit.record;
      const result = await (async () => {
        if (hit.checkout) return doReturn(tool, hit.checkout);
        if (!tool.active || tool.status !== 'available') { beep(false); return show('err', `${esc(tool.name)} is marked <b>${esc(tool.status)}</b> and can't go out.`); }
        if (!k.person) {
          k.pendingTool = tool;
          beep(false);
          return show('info', `Who's taking <b>${esc(tool.name)}</b>? Tap your name above.`);
        }
        return doCheckout(tool);
      })();
      showToolPhoto(tool);
      return result;
    }

    if (hit.kind === 'item') {
      if (!k.person) { beep(false); return show('err', 'Tap your name first.'); }
      const it = hit.record;
      if (!myRole().scanStock.includes(it.category)) { beep(false); return show('err', "That isn't in your area — you can only scan your own things."); }
      if (k.pendingItem) {
        // Same item again = one more; a different item has to wait.
        if (k.pendingItem.item.id === it.id) { k.pendingItem.qty += 1; beep(true); return paintItem(); }
        beep(false);
        return paintItem(`Finish <b>${esc(k.pendingItem.item.name)}</b> first: tap Take or Put back, or Cancel.`);
      }
      beep(true);
      status.innerHTML = '';
      k.pendingItem = { item: it, qty: 1, place: placeKey() };
      return paintItem();
    }

    beep(false);
    if (hit.kind === 'hidden') return show('err', "That isn't in your area — you can only scan your own things.");
    show('err', `Unknown barcode: ${esc(code)}`);
  }

  bindScanner(scan, onScan);
  app.querySelector('#cam')?.addEventListener('click', () => openCamera(async (code) => {
    await onScan(code);
    // A pop-up now needs an answer (where / how many): close the camera so it's visible.
    if (k.pendingItem || k.picker) return { close: true };
    const box = status.querySelector('.big-status');
    return { ok: !box?.classList.contains('err'), text: box?.textContent.replace(/\s+/g, ' ').trim() };
  }));
  paintWho();
  paintLog();
  resetIdle();
}

// ---------------------------------------------------------------------------
// Events (offsite jobs)
// ---------------------------------------------------------------------------

const fmtDay = (d) => (d ? new Date(`${d}T12:00`).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) : '');

function eventForm(ev = {}) {
  return `
    <div class="row">
      <label style="flex:2;min-width:200px">Event name <input name="name" required value="${esc(ev.name)}" placeholder="County fair booth"></label>
      <label style="flex:1;min-width:160px">Location <input name="location" value="${esc(ev.location)}"></label>
      <label>Starts <input name="starts_on" type="date" value="${esc(ev.starts_on)}"></label>
      <label>Ends <input name="ends_on" type="date" value="${esc(ev.ends_on)}"></label>
    </div>
    <label style="margin-top:10px">Notes <input name="notes" value="${esc(ev.notes)}"></label>`;
}

const eventFields = (f) => ({
  name: f.get('name').trim(), location: f.get('location').trim() || null,
  starts_on: f.get('starts_on') || null, ends_on: f.get('ends_on') || null, notes: f.get('notes').trim() || null,
});

async function renderEvents() {
  const [events, members, open] = await Promise.all([
    q(sb.from('events').select('*').order('starts_on', { ascending: false, nullsFirst: true })),
    loadMembers(),
    q(sb.from('tool_checkouts').select('event_id').is('returned_at', null).not('event_id', 'is', null)),
  ]);
  const crew = people(members);
  const outBy = {};
  open.forEach((c) => (outBy[c.event_id] = (outBy[c.event_id] || 0) + 1));
  const live = events.filter((e) => e.status !== 'closed');
  const closed = events.filter((e) => e.status === 'closed');
  const rows = (list) => list.map((e) => `<tr><td class="code">${esc(e.code)}</td><td><a href="#/event/${e.id}">${esc(e.name)}</a></td><td>${esc(e.location)}</td>
    <td>${fmtDay(e.starts_on)}${e.ends_on && e.ends_on !== e.starts_on ? ` – ${fmtDay(e.ends_on)}` : ''}</td><td><span class="pill ${e.status}">${e.status}</span></td>
    <td class="num">${outBy[e.id] ? `<b>${outBy[e.id]}</b> out` : ''}</td></tr>`).join('');

  app.innerHTML = `
    ${pageHead('Offsite', 'Events', 'Plan an offsite job, then pick it on the Check In / Out screen when loading the truck. Everything scanned goes on the event’s list.')}
    <details class="card" ${live.length ? '' : 'open'} ${canAct() ? '' : 'hidden'}><summary><b>New event</b></summary>
      <form id="add" style="margin-top:12px">${eventForm()}
        <h2>Crew</h2><div class="people-pick">${crew.map((m) => `<label class="chip"><input type="checkbox" name="crew" value="${m.id}"> ${esc(m.name)}</label>`).join('')}</div>
        <div style="margin-top:12px"><button class="btn primary">Create event</button></div></form></details>
    <h2>Upcoming &amp; active</h2>
    <div class="table-wrap"><table><tr><th>Code</th><th>Event</th><th>Where</th><th>When</th><th>Status</th><th class="num">Tools</th></tr>
      ${rows(live) || '<tr><td colspan="6" class="muted">No open events.</td></tr>'}</table></div>
    ${closed.length ? `<h2>Closed</h2><div class="table-wrap"><table><tr><th>Code</th><th>Event</th><th>Where</th><th>When</th><th>Status</th><th class="num">Tools</th></tr>${rows(closed)}</table></div>` : ''}`;

  app.querySelector('#add').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    try {
      const [ev] = await q(sb.from('events').insert(eventFields(f)).select());
      const ids = f.getAll('crew');
      if (ids.length) await q(sb.from('event_crew').insert(ids.map((member_id) => ({ event_id: ev.id, member_id }))).select());
      toast(`Created ${ev.name}`);
      location.hash = `#/event/${ev.id}`;
    } catch (err) { toast(errMsg(err), true); }
  });
}

async function renderEvent(id) {
  const [[ev], members, crewRows, checkouts, tx, tools, items] = await Promise.all([
    q(sb.from('events').select('*').eq('id', id)),
    loadMembers(),
    q(sb.from('event_crew').select('member_id').eq('event_id', id)),
    q(sb.from('tool_checkouts').select('*').eq('event_id', id).order('checked_out_at')),
    q(sb.from('item_transactions').select('*').eq('event_id', id).order('created_at')),
    loadTools(),
    loadItems(),
  ]);
  if (!ev) throw new Error('Event not found');
  const who = Object.fromEntries(members.map((m) => [m.id, m.name]));
  const toolBy = Object.fromEntries(tools.map((t) => [t.id, t]));
  const itemBy = Object.fromEntries(items.map((i) => [i.id, i]));
  const crewIds = new Set(crewRows.map((c) => c.member_id));
  const notCrew = people(members).filter((m) => !crewIds.has(m.id));
  const stillOut = checkouts.filter((c) => !c.returned_at);

  // Net stock per item: taken (out) vs brought back (in).
  const stock = {};
  tx.forEach((t) => {
    const s = (stock[t.item_id] ||= { taken: 0, back: 0 });
    if (t.type === 'out') s.taken += -t.qty;
    if (t.type === 'in') s.back += t.qty;
  });

  app.innerHTML = `
    <p><a href="#/events">← Events</a></p>
    <h1>${esc(ev.name)} <span class="code muted">${esc(ev.code)}</span> <span class="pill ${ev.status}">${ev.status}</span></h1>
    <p class="muted" style="margin-top:-6px">${esc(ev.location || '')}${ev.location && ev.starts_on ? ' · ' : ''}${fmtDay(ev.starts_on)}${ev.ends_on && ev.ends_on !== ev.starts_on ? ` – ${fmtDay(ev.ends_on)}` : ''}${ev.notes ? ` · ${esc(ev.notes)}` : ''}</p>
    <div class="stats">
      <div class="stat"><b>${crewIds.size}</b><span>crew</span></div>
      <div class="stat"><b>${checkouts.length}</b><span>tools sent</span></div>
      <div class="stat"><b style="color:${stillOut.length ? 'var(--out)' : 'var(--in)'}">${stillOut.length}</b><span>tools not back yet</span></div>
      <div class="stat"><b>${Object.keys(stock).length}</b><span>stock items used</span></div>
    </div>

    <h2>Crew</h2>
    <div class="card"><div class="people-pick">
      ${[...crewIds].map((mid) => `<span class="chip">${esc(who[mid])} ${ev.status !== 'closed' && canAct() ? `<button class="x" data-remove="${mid}" title="Remove">×</button>` : ''}</span>`).join('') || '<span class="muted">No crew yet.</span>'}
      ${ev.status !== 'closed' && notCrew.length && canAct() ? `<select id="add-crew"><option value="">+ Add person…</option>${notCrew.map((m) => `<option value="${m.id}">${esc(m.name)}</option>`).join('')}</select>` : ''}
    </div></div>

    <h2>Tools</h2>
    <div class="table-wrap"><table><tr><th>Tool</th><th>Signed out by</th><th>Out</th><th>Back</th><th></th></tr>
      ${checkouts.map((c) => { const t = toolBy[c.tool_id]; return `<tr class="${c.returned_at ? '' : 'overdue'}"><td><a href="#/tool/${t?.id}">${esc(t?.name)}</a> <span class="code muted">${esc(t?.code)}</span></td><td>${esc(who[c.borrower_id])}</td><td>${fmtDate(c.checked_out_at)}</td>
        <td>${c.returned_at ? `${fmtDate(c.returned_at)}${c.return_condition && c.return_condition !== 'good' ? ` <span class="pill ${c.return_condition}">${c.return_condition.replace('_', ' ')}</span>` : ''}` : '<span class="pill out">NOT BACK</span>'}</td>
        <td>${c.returned_at || !canAct() ? '' : `<button class="btn small bad" data-lost="${c.tool_id}">Mark lost</button>`}</td></tr>`; }).join('')
      || '<tr><td colspan="5" class="muted">No tools signed out to this event yet. Pick this event on the Check In/Out screen and scan.</td></tr>'}</table></div>

    <h2>Stock</h2>
    <div class="table-wrap"><table><tr><th>Item</th><th class="num">Taken</th><th class="num">Brought back</th><th class="num">Used</th></tr>
      ${Object.entries(stock).map(([iid, s]) => { const it = itemBy[iid]; return `<tr><td>${esc(it?.name)} <span class="code muted">${esc(it?.code)}</span></td><td class="num">${s.taken}</td><td class="num">${s.back}</td><td class="num"><b>${s.taken - s.back}</b></td></tr>`; }).join('')
      || '<tr><td colspan="4" class="muted">No stock scanned for this event.</td></tr>'}</table></div>

    <div class="row" style="margin-top:18px">
      ${!canAct() ? '' : ev.status !== 'closed' ? '<button class="btn primary" id="close">Close event</button>' : '<button class="btn" id="reopen">Reopen event</button>'}
      <button class="btn" id="csv">Export CSV</button>
    </div>
    ${ev.status !== 'closed' && canAct() ? `<details class="card" style="margin-top:16px"><summary><b>Edit event details</b></summary><form id="edit" style="margin-top:12px">${eventForm(ev)}<div style="margin-top:12px"><button class="btn primary">Save</button></div></form></details>` : ''}`;

  const reload = () => route();
  app.querySelectorAll('[data-remove]').forEach((b) => b.addEventListener('click', async () => {
    try { await q(sb.from('event_crew').delete().eq('event_id', id).eq('member_id', b.dataset.remove).select()); reload(); } catch (e) { toast(errMsg(e), true); }
  }));
  app.querySelector('#add-crew')?.addEventListener('change', async (e) => {
    if (!e.target.value) return;
    try { await q(sb.from('event_crew').insert({ event_id: id, member_id: e.target.value }).select()); reload(); } catch (err) { toast(errMsg(err), true); }
  });
  app.querySelectorAll('[data-lost]').forEach((b) => b.addEventListener('click', async () => {
    const t = toolBy[b.dataset.lost];
    if (!(await askConfirm(`Mark ${t?.name} as lost?`, { message: 'It will be taken off the available list.', ok: 'Mark lost', danger: true }))) return;
    try { await rpc('mark_tool_lost', { p_tool: b.dataset.lost, p_note: `Not returned from ${ev.name}` }); reload(); } catch (e) { toast(errMsg(e), true); }
  }));
  app.querySelector('#close')?.addEventListener('click', async () => {
    if (stillOut.length && !(await askConfirm('Close the event anyway?', { message: `${stillOut.length} tool(s) still aren't back. They'll stay signed out to the person who took them.`, ok: 'Close event' }))) return;
    try { await q(sb.from('events').update({ status: 'closed' }).eq('id', id).select()); toast('Event closed'); reload(); } catch (e) { toast(errMsg(e), true); }
  });
  app.querySelector('#reopen')?.addEventListener('click', async () => {
    try { await q(sb.from('events').update({ status: 'active' }).eq('id', id).select()); reload(); } catch (e) { toast(errMsg(e), true); }
  });
  app.querySelector('#edit')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await q(sb.from('events').update(eventFields(new FormData(e.target))).eq('id', id).select()); toast('Saved'); reload(); } catch (err) { toast(errMsg(err), true); }
  });
  app.querySelector('#csv').addEventListener('click', () => downloadCsv(`${ev.code}-${ev.name}.csv`, [
    ...checkouts.map((c) => ({ kind: 'tool', code: toolBy[c.tool_id]?.code, name: toolBy[c.tool_id]?.name, who: who[c.borrower_id], out: fmtDate(c.checked_out_at), back: c.returned_at ? fmtDate(c.returned_at) : 'NOT BACK', qty: '', condition: c.return_condition || '' })),
    ...Object.entries(stock).map(([iid, s]) => ({ kind: 'stock', code: itemBy[iid]?.code, name: itemBy[iid]?.name, who: '', out: s.taken, back: s.back, qty: s.taken - s.back, condition: '' })),
  ]));
}

// ---------------------------------------------------------------------------
// Who has what
// ---------------------------------------------------------------------------

async function renderOut() {
  const [tools, members, open, events] = await Promise.all([
    loadTools(), loadMembers(), q(sb.from('tool_checkouts').select('*').is('returned_at', null).order('checked_out_at')),
    q(sb.from('events').select('id, name')),
  ]);
  const evName = Object.fromEntries(events.map((e) => [e.id, e.name]));
  const byId = Object.fromEntries(tools.map((t) => [t.id, t]));
  const who = Object.fromEntries(members.map((m) => [m.id, m.name]));
  const active = tools.filter((t) => t.active);
  const overdue = open.filter((c) => c.due_at && new Date(c.due_at) < new Date());
  const flagged = active.filter((t) => ['repair', 'lost'].includes(t.status));

  const groups = {};
  open.forEach((c) => (groups[who[c.borrower_id] || '?'] ||= []).push(c));

  app.innerHTML = `
    ${pageHead('Right now', 'Who has <span class="accent">what</span>')}
    <div class="stats">
      <div class="stat"><b>${active.length}</b><span>tools total</span></div>
      <div class="stat"><b>${active.filter((t) => t.status === 'available').length}</b><span>in the crib</span></div>
      <div class="stat"><b>${open.length}</b><span>signed out</span></div>
      <div class="stat"><b style="color:${overdue.length ? 'var(--bad)' : 'inherit'}">${overdue.length}</b><span>overdue</span></div>
      <div class="stat"><b>${flagged.length}</b><span>repair / lost</span></div>
    </div>
    ${Object.keys(groups).sort().map((name) => `
      <h2>${esc(name)} <span class="muted">(${groups[name].length})</span></h2>
      <div class="table-wrap"><table><tr><th>Tool</th><th>Code</th><th>For</th><th>Out since</th><th>Due</th><th>Note</th></tr>
      ${groups[name].map((c) => {
        const t = byId[c.tool_id];
        const late = c.due_at && new Date(c.due_at) < new Date();
        return `<tr class="${late ? 'overdue' : ''}"><td><a href="#/tool/${t?.id}">${esc(t?.name)}</a></td><td class="code">${esc(t?.code)}</td><td>${c.event_id ? `<a href="#/event/${c.event_id}">${esc(evName[c.event_id])}</a>` : c.destination ? esc(c.destination) : '<span class="muted">shop</span>'}</td><td>${fmtDate(c.checked_out_at)} <span class="muted">(${since(c.checked_out_at)})</span></td><td>${c.due_at ? new Date(c.due_at).toLocaleDateString() : ''}${late ? ' <span class="pill overdue">OVERDUE</span>' : ''}</td><td>${esc(c.out_note)}</td></tr>`;
      }).join('')}</table></div>`).join('') || '<div class="card muted">Every tool is in.</div>'}
    ${flagged.length ? `<h2>Needs attention</h2><div class="table-wrap"><table><tr><th>Tool</th><th>Code</th><th>Status</th></tr>
      ${flagged.map((t) => `<tr><td><a href="#/tool/${t.id}">${esc(t.name)}</a></td><td class="code">${esc(t.code)}</td><td><span class="pill ${t.status}">${t.status}</span></td></tr>`).join('')}</table></div>` : ''}`;
}

// ---------------------------------------------------------------------------
// Stock (Facilities / Event) lists & item detail
// ---------------------------------------------------------------------------

const STOCK = {
  facilities: { title: 'Facilities <span class="accent">stock</span>', plain: 'Facilities stock', eyebrow: 'Stock room', hash: '#/items/facilities' },
  maintenance: { title: 'Maintenance <span class="accent">stock</span>', plain: 'Maintenance stock', eyebrow: 'Stock room', hash: '#/items/maintenance' },
  events: { title: 'Event <span class="accent">stock</span>', plain: 'Event stock', eyebrow: 'Stock room', hash: '#/items/events' },
};
const stockKind = (c) => (STOCK[c] ? c : 'facilities');
// Total pieces: e.g. 3 boxes × 6 rolls = 18.
const pieces = (i) => i.quantity * (i.pack_size || 1);
const packNote = (i) => ((i.pack_size || 1) > 1 ? ` (${i.pack_size} each = ${pieces(i).toLocaleString()} total)` : '');
const loadLocations = () => q(sb.from('locations').select('name').eq('active', true).order('name'));

// Location dropdown shared by item and tool forms. Admins can add new ones inline.
function locationSelect(locations, current, label = 'Location') {
  const names = locations.map((l) => l.name);
  if (current && !names.includes(current)) names.push(current);
  return `<label style="flex:1;min-width:170px">${label}
    <select name="location" data-location>
      <option value="">— None —</option>
      ${names.map((n) => `<option ${n === current ? 'selected' : ''}>${esc(n)}</option>`).join('')}
      ${isAdmin() ? '<option value="__new">+ Add new location…</option><option value="__manage">Manage locations…</option>' : ''}
    </select></label>`;
}

function bindLocationSelects(root) {
  root.querySelectorAll('select[data-location]').forEach((sel) => {
    let last = sel.value;
    sel.addEventListener('change', async () => {
      if (sel.value === '__manage') { sel.value = last; location.hash = '#/locations'; return; }
      if (sel.value !== '__new') { last = sel.value; return; }
      const name = (await askText('New location', { placeholder: 'e.g. Shelf A3, Trailer 2', ok: 'Add' })) || '';
      if (!name) { sel.value = last; return; }
      try {
        await rpc('add_location', { p_name: name });
      } catch (err) { toast(errMsg(err), true); sel.value = last; return; }
      // Add it to every location dropdown on the page and pick it here.
      root.querySelectorAll('select[data-location]').forEach((s) => {
        if (![...s.options].some((o) => o.value === name)) {
          s.querySelector('option[value="__new"]').insertAdjacentHTML('beforebegin', `<option>${esc(name)}</option>`);
        }
      });
      sel.value = name;
      last = name;
      toast(`Added location ${name}`);
    });
  });
}

function itemForm(it = {}, locations = []) {
  const cat = it.category || 'facilities';
  return `
    <div class="row">
      <label style="flex:2;min-width:200px">Name <input name="name" required value="${esc(it.name)}"></label>
      ${locationSelect(locations, it.location)}
      <label style="width:150px">Stock type <select name="category">
        <option value="facilities" ${cat === 'facilities' ? 'selected' : ''}>Facilities</option>
        <option value="maintenance" ${cat === 'maintenance' ? 'selected' : ''}>Maintenance</option>
        <option value="events" ${cat === 'events' ? 'selected' : ''}>Event</option></select></label>
      <label style="width:130px" title="How many pieces one box/pack holds, e.g. 6 rolls in a box of paper towels. Leave 1 for single items.">Per box/pack <input name="pack_size" type="number" min="1" value="${it.pack_size ?? 1}"></label>
      <label style="width:120px">Reorder at <input name="reorder_level" type="number" min="0" value="${it.reorder_level ?? 0}"></label>
      ${it.id ? '' : '<label style="width:120px">Starting qty <input name="start" type="number" min="0" value="0"></label>'}
    </div>
    <label style="margin-top:12px">Description <input name="description" value="${esc(it.description)}"></label>`;
}

const itemFields = (f) => ({
  name: f.get('name').trim(), location: f.get('location') || null, category: f.get('category'),
  reorder_level: parseInt(f.get('reorder_level'), 10) || 0, description: f.get('description').trim() || null,
  pack_size: Math.max(1, parseInt(f.get('pack_size'), 10) || 1),
});

async function renderItems(category) {
  const kind = stockKind(category);
  const meta = STOCK[kind];
  const [all, locations] = await Promise.all([loadItems(), loadLocations()]);
  const items = all.filter((i) => i.category === kind);
  const show = items.filter((i) => i.active);
  const low = show.filter((i) => i.reorder_level > 0 && i.quantity <= i.reorder_level);
  const total = show.reduce((s, i) => s + pieces(i), 0);
  const hasPacks = show.some((i) => (i.pack_size || 1) > 1);

  app.innerHTML = `
    ${pageHead(meta.eyebrow, meta.title)}
    <div class="stats">
      <div class="stat"><b>${show.length}</b><span>items</span></div>
      <div class="stat"><b>${total.toLocaleString()}</b><span>${hasPacks ? 'pieces on hand in total' : 'on hand in total'}</span></div>
      <div class="stat"><b style="color:${low.length ? 'var(--warn)' : 'inherit'}">${low.length}</b><span>at or below reorder level</span></div>
    </div>
    ${isAdmin() ? `<details class="card"><summary><b>Add ${meta.plain.toLowerCase()}</b></summary><form id="add" style="margin-top:14px">${itemForm({ category: kind }, locations)}<div style="margin-top:14px"><button class="btn primary">Add item</button></div></form></details>` : ''}
    <div class="row" style="margin-bottom:12px">
      <input id="filter" placeholder="Search name, code or location…" style="flex:1;min-width:200px">
      <select id="locfilter"><option value="">All locations</option>${locations.map((l) => `<option>${esc(l.name)}</option>`).join('')}</select>
      <label class="row" style="flex-direction:row;align-items:center"><input type="checkbox" id="lowonly"> Low only</label>
      <button class="btn" id="csv">Export CSV</button>
      <button class="btn" id="sheet" title="Every ${meta.plain.toLowerCase()} label on letter paper, sorted by location">Print sheet</button>
    </div>
    <div class="table-wrap"><table id="tbl"></table></div>
    ${items.length > show.length ? `<p class="muted">${items.length - show.length} archived item(s) hidden.</p>` : ''}`;

  const paint = () => {
    const f = app.querySelector('#filter').value.toLowerCase();
    const loc = app.querySelector('#locfilter').value;
    const lowOnly = app.querySelector('#lowonly').checked;
    const rows = show.filter((i) => (!f || `${i.name} ${i.code} ${i.location} ${i.description}`.toLowerCase().includes(f))
      && (!loc || i.location === loc) && (!lowOnly || low.includes(i)));
    app.querySelector('#tbl').innerHTML = `<tr><th>Code</th><th>Item</th><th>Location</th><th class="num">On hand</th>${hasPacks ? '<th class="num">Per pack</th><th class="num">Total</th>' : ''}<th class="num">Reorder at</th></tr>
      ${rows.map((i) => `<tr class="${low.includes(i) ? 'low' : ''}"><td class="code">${esc(i.code)}</td><td><a href="#/item/${i.id}">${esc(i.name)}</a>${low.includes(i) ? ' <span class="pill low">LOW</span>' : ''}${i.label_printed_at ? '' : ' <span class="pill closed">No label</span>'}</td><td>${esc(i.location)}</td><td class="num"><b>${i.quantity}</b></td>${hasPacks ? `<td class="num">${(i.pack_size || 1) > 1 ? `× ${i.pack_size}` : ''}</td><td class="num"><b>${pieces(i).toLocaleString()}</b></td>` : ''}<td class="num">${i.reorder_level || ''}</td></tr>`).join('')
      || `<tr><td colspan="${hasPacks ? 7 : 5}" class="muted">No ${meta.plain.toLowerCase()} yet.</td></tr>`}`;
  };
  app.querySelector('#filter').addEventListener('input', paint);
  app.querySelector('#locfilter').addEventListener('change', paint);
  app.querySelector('#lowonly').addEventListener('change', paint);
  app.querySelector('#sheet').addEventListener('click', () => {
    if (!show.length) return toast('Nothing to print yet');
    if (!window.jspdf || !window.JsBarcode) return toast('Still loading — try again in a second', true);
    openPdf(buildSheetPdf(stockSheetRows(all, kind), meta.plain.charAt(0).toUpperCase() + meta.plain.slice(1)));
  });
  app.querySelector('#csv').addEventListener('click', () => downloadCsv(`${kind}-stock.csv`, show.map((i) => ({
    code: i.code, name: i.name, location: i.location, on_hand: i.quantity, per_pack: i.pack_size || 1, total_pieces: pieces(i), reorder_at: i.reorder_level, description: i.description,
  }))));
  const add = app.querySelector('#add');
  if (add) {
    bindLocationSelects(add);
    add.addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      try {
        const [row] = await q(sb.from('items').insert(itemFields(f)).select());
        const start = parseInt(f.get('start'), 10) || 0;
        if (start > 0) await rpc('scan_item', { p_code: row.code, p_type: 'adjust', p_qty: start, p_note: 'Starting count' });
        toast(`Added ${row.name} as ${row.code}`);
        if (row.category !== kind) location.hash = STOCK[row.category].hash; else route();
      } catch (err) { toast(errMsg(err), true); }
    });
  }
  paint();
}

async function renderItem(id) {
  const [[it], tx, members, locations] = await Promise.all([
    q(sb.from('items').select('*').eq('id', id)),
    q(sb.from('item_transactions').select('*').eq('item_id', id).order('created_at', { ascending: false }).limit(300)),
    loadMembers(),
    loadLocations(),
  ]);
  if (!it) throw new Error('Item not found');
  const who = Object.fromEntries(members.map((m) => [m.id, m.name]));
  const meta = STOCK[stockKind(it.category)];

  app.innerHTML = `
    <p><a href="${meta.hash}">← ${meta.plain}</a></p>
    <h1>${esc(it.name)} <span class="code muted">${esc(it.code)}</span></h1>
    <div class="stats">
      <div class="stat"><b>${it.quantity}</b><span>on hand${(it.pack_size || 1) > 1 ? ` (${it.pack_size} per pack)` : ''}</span></div>
      ${(it.pack_size || 1) > 1 ? `<div class="stat"><b>${pieces(it).toLocaleString()}</b><span>pieces in total</span></div>` : ''}
      <div class="stat"><b>${it.reorder_level || '—'}</b><span>reorder at</span></div>
      <div class="stat"><b>${esc(it.location || '—')}</b><span>location</span></div>
    </div>
    <div class="row" style="margin-bottom:16px">${canAct() ? `<a class="btn" href="#/labels/${stockKind(it.category)}/${it.id}">Print label</a>` : ''}
      <span class="muted" style="align-self:center;font-size:14px">${it.label_printed_at ? `Label printed ${fmtDate(it.label_printed_at)}` : 'Label not printed yet'}</span></div>
    ${isAdmin() ? `<details class="card"><summary><b>Edit item</b></summary><form id="edit" style="margin-top:14px">${itemForm(it, locations)}
      <div class="row" style="margin-top:14px"><button class="btn primary">Save</button>
      <button type="button" class="btn ${it.active ? 'bad' : ''}" id="archive">${it.active ? 'Archive item' : 'Restore item'}</button></div></form></details>` : ''}
    <h2>History</h2>
    <div class="table-wrap"><table><tr><th>When</th><th>Type</th><th class="num">Change</th><th class="num">After</th><th>Who</th><th>Note</th></tr>
      ${tx.map((t) => `<tr><td>${fmtDate(t.created_at)}</td><td><span class="pill ${t.type}">${t.type}</span></td><td class="num">${t.qty > 0 ? '+' : ''}${t.qty}</td><td class="num">${t.qty_after}</td><td>${esc(who[t.member_id])}</td><td>${esc(t.note)}</td></tr>`).join('')
      || '<tr><td colspan="6" class="muted">No activity yet.</td></tr>'}</table></div>`;

  const edit = app.querySelector('#edit');
  if (edit) {
    bindLocationSelects(edit);
    edit.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await q(sb.from('items').update(itemFields(new FormData(e.target))).eq('id', it.id).select());
        toast('Saved');
        route();
      } catch (err) { toast(errMsg(err), true); }
    });
  }
  app.querySelector('#archive')?.addEventListener('click', async () => {
    if (it.active && !(await askConfirm(`Archive ${it.name}?`, { message: 'It will stop scanning but keep its history.', ok: 'Archive', danger: true }))) return;
    try { await q(sb.from('items').update({ active: !it.active }).eq('id', it.id).select()); route(); } catch (err) { toast(errMsg(err), true); }
  });
}

// ---------------------------------------------------------------------------
// Tool list & tool detail
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Tool photos (private Storage bucket, viewed through short-lived signed URLs)
// ---------------------------------------------------------------------------

const PHOTO_BUCKET = 'tool-photos';
const photoUrls = new Map(); // path -> { url, until }

async function photoUrlsFor(paths) {
  const now = Date.now();
  const need = [...new Set(paths.filter((p) => p && !(photoUrls.get(p)?.until > now)))];
  if (need.length) {
    const { data, error } = await sb.storage.from(PHOTO_BUCKET).createSignedUrls(need, 3600);
    if (!error) data.forEach((d) => d.signedUrl && photoUrls.set(d.path, { url: d.signedUrl, until: now + 50 * 60e3 }));
  }
  return Object.fromEntries(paths.filter(Boolean).map((p) => [p, photoUrls.get(p)?.url]));
}
const photoUrl = async (path) => (path ? (await photoUrlsFor([path]))[path] : null);

// Phone and iPad photos are several MB; shrink to a sharp ~1280px JPEG first.
async function shrinkImage(file, max = 1280) {
  const src = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = src;
    await img.decode().catch(() => { throw new Error("That file isn't a photo this browser can read. Try a JPEG or PNG."); });
    const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * scale);
    c.height = Math.round(img.naturalHeight * scale);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return await new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('Could not process the photo'))), 'image/jpeg', 0.85));
  } finally {
    URL.revokeObjectURL(src);
  }
}

async function setToolPhoto(tool, file) {
  const old = tool.photo_path;
  const path = `${tool.id}/${Date.now()}.jpg`;
  const blob = await shrinkImage(file);
  const { error } = await sb.storage.from(PHOTO_BUCKET).upload(path, blob, { contentType: 'image/jpeg' });
  if (error) throw new Error(error.message);
  await q(sb.from('tools').update({ photo_path: path }).eq('id', tool.id).select());
  if (old) await sb.storage.from(PHOTO_BUCKET).remove([old]);
}

async function clearToolPhoto(tool) {
  const old = tool.photo_path;
  await q(sb.from('tools').update({ photo_path: null }).eq('id', tool.id).select());
  if (old) await sb.storage.from(PHOTO_BUCKET).remove([old]);
}

const PHOTO_ICON = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3v11H4z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><circle cx="12" cy="13" r="3.6" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>';

function toolForm(t = {}, locations = []) {
  return `
    <div class="row">
      <label style="flex:2;min-width:200px">Name <input name="name" required value="${esc(t.name)}" placeholder="Hilti TE 30 hammer drill"></label>
      ${locationSelect(locations, t.location, 'Home location')}
      <label style="width:120px">Value ($) <input name="value" type="number" min="0" step="0.01" value="${t.value ?? ''}"></label>
    </div>
    <label style="margin-top:12px">Description <input name="description" value="${esc(t.description)}"></label>`;
}

const toolFields = (f) => ({
  name: f.get('name').trim(), location: f.get('location') || null,
  value: f.get('value') ? Number(f.get('value')) : null, description: f.get('description').trim() || null,
});

async function renderToolList() {
  const [tools, members, open, locations] = await Promise.all([loadTools(), loadMembers(), q(sb.from('tool_checkouts').select('tool_id, borrower_id, checked_out_at').is('returned_at', null)), loadLocations()]);
  const who = Object.fromEntries(members.map((m) => [m.id, m.name]));
  const openBy = Object.fromEntries(open.map((c) => [c.tool_id, c]));
  const show = tools.filter((t) => t.active);
  const total = show.reduce((s, t) => s + Number(t.value || 0), 0);

  app.innerHTML = `
    ${pageHead('Equipment', 'Tools')}
    <div class="stats">
      <div class="stat"><b>${show.length}</b><span>tools</span></div>
      <div class="stat"><b>${total ? `$${total.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : '—'}</b><span>total value</span></div>
    </div>
    ${isAdmin() ? `<details class="card"><summary><b>Add a tool</b></summary><form id="add" style="margin-top:14px">${toolForm({}, locations)}
      <label style="margin-top:12px">Photo (optional) <input name="photo" type="file" accept="image/*"></label>
      <div style="margin-top:12px"><button class="btn primary">Add tool</button></div></form></details>` : ''}
    <div class="row" style="margin-bottom:10px"><input id="filter" placeholder="Search…" style="flex:1;min-width:200px"><button class="btn" id="csv">Export CSV</button></div>
    <div class="table-wrap"><table id="tbl"></table></div>`;

  let photos = {};
  const paint = () => {
    const f = app.querySelector('#filter').value.toLowerCase();
    const rows = show.filter((t) => !f || `${t.name} ${t.code} ${t.location}`.toLowerCase().includes(f));
    app.querySelector('#tbl').innerHTML = `<tr><th>Code</th><th>Tool</th><th>Status</th><th>With</th></tr>
      ${rows.map((t) => `<tr><td class="code">${esc(t.code)}</td><td><a class="tool-name" href="#/tool/${t.id}">${photos[t.photo_path] ? `<img class="thumb" src="${esc(photos[t.photo_path])}" alt="">` : '<span class="thumb empty"></span>'}${esc(t.name)}</a>${t.label_printed_at ? '' : ' <span class="pill closed">No label</span>'}</td><td><span class="pill ${t.status}">${t.status}</span></td><td>${openBy[t.id] ? `${esc(who[openBy[t.id].borrower_id])} <span class="muted">(${since(openBy[t.id].checked_out_at)})</span>` : ''}</td></tr>`).join('')
      || '<tr><td colspan="4" class="muted">No tools yet.</td></tr>'}`;
  };
  photoUrlsFor(show.map((t) => t.photo_path)).then((p) => { photos = p; if (app.querySelector('#tbl')) paint(); });
  app.querySelector('#filter').addEventListener('input', paint);
  app.querySelector('#csv').addEventListener('click', () => downloadCsv('tools.csv', show.map((t) => ({
    code: t.code, name: t.name, status: t.status, with: openBy[t.id] ? who[openBy[t.id].borrower_id] : '', location: t.location, value: t.value,
  }))));
  if (app.querySelector('#add')) bindLocationSelects(app.querySelector('#add'));
  app.querySelector('#add')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const f = new FormData(e.target);
      const [row] = await q(sb.from('tools').insert(toolFields(f)).select());
      const photo = f.get('photo');
      if (photo?.size) {
        try { await setToolPhoto(row, photo); } catch (err) { toast(`Added ${row.name}, but the photo didn't upload: ${errMsg(err)}`, true); return route(); }
      }
      toast(`Added ${row.name} as ${row.code}`);
      route();
    } catch (err) { toast(errMsg(err), true); }
  });
  paint();
}

async function renderTool(id) {
  const [[t], hist, members, locations] = await Promise.all([
    q(sb.from('tools').select('*').eq('id', id)),
    q(sb.from('tool_checkouts').select('*').eq('tool_id', id).order('checked_out_at', { ascending: false }).limit(300)),
    loadMembers(),
    loadLocations(),
  ]);
  if (!t) throw new Error('Tool not found');
  const who = Object.fromEntries(members.map((m) => [m.id, m.name]));
  const photo = await photoUrl(t.photo_path);

  app.innerHTML = `
    <p><a href="#/toollist">← Tools</a></p>
    <h1>${esc(t.name)} <span class="code muted">${esc(t.code)}</span></h1>
    <div class="tool-photo-block">
      ${photo ? `<a href="${esc(photo)}" target="_blank" rel="noopener"><img class="tool-photo" src="${esc(photo)}" alt="Photo of ${esc(t.name)}"></a>`
        : `<div class="tool-photo empty">${PHOTO_ICON}<span>No photo yet</span></div>`}
      ${isAdmin() ? `<div class="row">
        <label class="btn small file-btn">${PHOTO_ICON}<span>${photo ? 'Change photo' : 'Add photo'}</span><input type="file" id="photo" accept="image/*" hidden></label>
        ${t.photo_path ? '<button class="btn small" id="photo-remove">Remove photo</button>' : ''}</div>` : ''}
    </div>
    <div class="stats">
      <div class="stat"><b><span class="pill ${t.status}">${t.status}</span></b><span>status</span></div>
      <div class="stat"><b>${t.value ? `$${Number(t.value).toLocaleString()}` : '—'}</b><span>value</span></div>
      <div class="stat"><b>${hist.length}</b><span>times signed out</span></div>
    </div>
    <div class="row" style="margin-bottom:16px">${canAct() ? `<a class="btn" href="#/labels/tool/${t.id}">Print label</a>` : ''}
      <span class="muted" style="align-self:center;font-size:14px">${t.label_printed_at ? `Label printed ${fmtDate(t.label_printed_at)}` : 'Label not printed yet'}</span>
      ${isAdmin() && t.status !== 'out' ? `<select id="status">${['available', 'repair', 'lost', 'retired'].map((s) => `<option ${s === t.status ? 'selected' : ''}>${s}</option>`).join('')}</select><button class="btn" id="set-status">Set status</button>` : ''}
    </div>
    ${isAdmin() ? `<details class="card"><summary><b>Edit tool</b></summary><form id="edit" style="margin-top:14px">${toolForm(t, locations)}
      <div class="row" style="margin-top:12px"><button class="btn primary">Save</button>
      <button type="button" class="btn ${t.active ? 'bad' : ''}" id="archive">${t.active ? 'Archive tool' : 'Restore tool'}</button></div></form></details>` : ''}
    <h2>Sign-out history</h2>
    <div class="table-wrap"><table><tr><th>Who</th><th>Out</th><th>Returned</th><th>Condition</th><th>Notes</th></tr>
      ${hist.map((c) => `<tr><td>${esc(who[c.borrower_id])}</td><td>${fmtDate(c.checked_out_at)}</td><td>${c.returned_at ? fmtDate(c.returned_at) : '<span class="pill out">still out</span>'}</td><td>${c.return_condition ? `<span class="pill ${c.return_condition}">${c.return_condition.replace('_', ' ')}</span>` : ''}</td><td>${esc([c.out_note, c.return_note].filter(Boolean).join(' / '))}</td></tr>`).join('')
      || '<tr><td colspan="5" class="muted">Never signed out.</td></tr>'}</table></div>`;

  app.querySelector('#photo')?.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const label = e.target.closest('label');
    label.classList.add('busy');
    label.querySelector('span').textContent = 'Uploading…';
    try { await setToolPhoto(t, file); toast('Photo saved'); route(); } catch (err) { toast(errMsg(err), true); route(); }
  });
  app.querySelector('#photo-remove')?.addEventListener('click', async () => {
    if (!(await askConfirm(`Remove the photo of ${t.name}?`, { ok: 'Remove', danger: true }))) return;
    try { await clearToolPhoto(t); toast('Photo removed'); route(); } catch (err) { toast(errMsg(err), true); }
  });
  app.querySelector('#set-status')?.addEventListener('click', async () => {
    try { await rpc('set_tool_status', { p_tool: t.id, p_status: app.querySelector('#status').value }); toast('Status updated'); route(); } catch (err) { toast(errMsg(err), true); }
  });
  if (app.querySelector('#edit')) bindLocationSelects(app.querySelector('#edit'));
  app.querySelector('#edit')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await q(sb.from('tools').update(toolFields(new FormData(e.target))).eq('id', t.id).select()); toast('Saved'); route(); } catch (err) { toast(errMsg(err), true); }
  });
  app.querySelector('#archive')?.addEventListener('click', async () => {
    if (t.active && !(await askConfirm(`Archive ${t.name}?`, { message: 'It will stop scanning but keep its history.', ok: 'Archive', danger: true }))) return;
    try { await q(sb.from('tools').update({ active: !t.active }).eq('id', t.id).select()); route(); } catch (err) { toast(errMsg(err), true); }
  });
}

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

async function renderHistory() {
  const from = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
  app.innerHTML = `
    ${pageHead('Records', 'History')}
    <div class="row" style="margin-bottom:12px">
      <label>From <input type="date" id="from" value="${from}"></label>
      <label>To <input type="date" id="to" value="${new Date().toISOString().slice(0, 10)}"></label>
      <label>Show <select id="kind">${myRole().stock.length ? '<option value="stock">Stock scans</option>' : ''}${myRole().tools ? '<option value="tools">Tool sign-outs</option>' : ''}</select></label>
      <button class="btn" id="csv">Export CSV</button>
    </div>
    <div id="out">${LOADER}</div>`;

  const [items, tools, members, events] = await Promise.all([loadItems(), loadTools(), loadMembers(), q(sb.from('events').select('id, name'))]);
  const evName = Object.fromEntries(events.map((e) => [e.id, e.name]));
  const itemBy = Object.fromEntries(items.map((i) => [i.id, i]));
  const toolBy = Object.fromEntries(tools.map((t) => [t.id, t]));
  const who = Object.fromEntries(members.map((m) => [m.id, m.name]));
  let rows = [];

  const load = async () => {
    const start = new Date(`${app.querySelector('#from').value}T00:00:00`).toISOString();
    const end = new Date(`${app.querySelector('#to').value}T23:59:59`).toISOString();
    const out = app.querySelector('#out');
    if (app.querySelector('#kind').value === 'stock') {
      const tx = await q(sb.from('item_transactions').select('*').gte('created_at', start).lte('created_at', end).order('created_at', { ascending: false }).limit(2000));
      rows = tx.map((t) => ({ when: fmtDate(t.created_at), type: t.type, code: itemBy[t.item_id]?.code, item: itemBy[t.item_id]?.name, change: t.qty, after: t.qty_after, stock: STOCK[itemBy[t.item_id]?.category]?.plain || '', who: who[t.member_id], event: evName[t.event_id] || t.destination || '', recorded_by: t.recorded_by && t.recorded_by !== t.member_id ? who[t.recorded_by] : '', note: t.note }));
      out.innerHTML = `<div class="table-wrap"><table><tr><th>When</th><th>Type</th><th>Item</th><th class="num">Change</th><th class="num">After</th><th>Who</th><th>Where</th><th>Note</th></tr>
        ${rows.map((r) => `<tr><td>${r.when}</td><td><span class="pill ${r.type}">${r.type}</span></td><td>${esc(r.item)} <span class="code muted">${esc(r.code)}</span><div class="muted" style="font-size:13px">${esc(r.stock)}</div></td><td class="num">${r.change > 0 ? '+' : ''}${r.change}</td><td class="num">${r.after}</td><td>${esc(r.who)}${r.recorded_by ? ` <span class="muted">(at ${esc(r.recorded_by)})</span>` : ''}</td><td>${esc(r.event)}</td><td>${esc(r.note)}</td></tr>`).join('')
        || '<tr><td colspan="8" class="muted">Nothing in this range.</td></tr>'}</table></div>`;
    } else {
      const co = await q(sb.from('tool_checkouts').select('*').gte('checked_out_at', start).lte('checked_out_at', end).order('checked_out_at', { ascending: false }).limit(2000));
      rows = co.map((c) => ({ out: fmtDate(c.checked_out_at), code: toolBy[c.tool_id]?.code, tool: toolBy[c.tool_id]?.name, who: who[c.borrower_id], event: evName[c.event_id] || c.destination || '', returned: c.returned_at ? fmtDate(c.returned_at) : 'still out', condition: c.return_condition, notes: [c.out_note, c.return_note].filter(Boolean).join(' / ') }));
      out.innerHTML = `<div class="table-wrap"><table><tr><th>Out</th><th>Tool</th><th>Who</th><th>Where</th><th>Returned</th><th>Condition</th><th>Notes</th></tr>
        ${rows.map((r) => `<tr><td>${r.out}</td><td>${esc(r.tool)} <span class="code muted">${esc(r.code)}</span></td><td>${esc(r.who)}</td><td>${esc(r.event)}</td><td>${r.returned}</td><td>${r.condition ? `<span class="pill ${r.condition}">${r.condition.replace('_', ' ')}</span>` : ''}</td><td>${esc(r.notes)}</td></tr>`).join('')
        || '<tr><td colspan="7" class="muted">Nothing in this range.</td></tr>'}</table></div>`;
    }
  };
  ['from', 'to', 'kind'].forEach((id) => app.querySelector(`#${id}`).addEventListener('change', () => load().catch((e) => toast(errMsg(e), true))));
  app.querySelector('#csv').addEventListener('click', () => downloadCsv(`${app.querySelector('#kind').value}-history.csv`, rows));
  await load();
}

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------

function personForm(m) {
  const self = m.id === state.me.id;
  return `<form class="person-form" data-person-form="${m.id}">
    <div class="row">
      <label style="flex:1;min-width:160px">Name <input name="name" required value="${esc(m.name)}"></label>
      <label style="flex:1;min-width:200px">Email (for sign-in) <input name="email" type="email" value="${esc(m.email)}"></label>
      <label style="width:130px" title="The code on their printed name label">Label code <input name="code" required value="${esc(m.code)}" autocapitalize="characters"></label>
      <label>Role <select name="role" ${self ? 'disabled' : ''}>${ROLE_ORDER.map((r) => `<option value="${r}" ${r === m.role ? 'selected' : ''}>${ROLES[r].label}</option>`).join('')}</select></label>
      <label>Status <select name="active" ${self ? 'disabled' : ''}>
        <option value="true" ${m.active ? 'selected' : ''}>Active</option>
        <option value="false" ${m.active ? '' : 'selected'}>Deactivated</option></select></label>
    </div>
    <p class="muted" style="margin:10px 0 0">${self
      ? "This is you. You can't change your own role or deactivate yourself; ask another admin."
      : 'Changing the email means they sign in with the new address (they create a password for it the first time). Changing the label code means their name label needs reprinting.'}</p>
    <div class="row" style="margin-top:12px"><button class="btn primary">Save</button><button type="button" class="btn" data-cancel>Cancel</button></div>
  </form>`;
}

async function renderPeople() {
  const members = await loadMembers();
  app.innerHTML = `
    ${pageHead('Team', 'People')}
    <p class="muted">Anyone with an email here can sign in (they create their own password with that email). People without an email can still use the warehouse iPad by tapping their name.
      <b>Admins</b> can edit everything. The <b>Kiosk</b> (the shared iPad) checks anything in and out. <b>Facilities &amp; Maintenance</b> scans tools, facilities and maintenance stock;
      <b>Maintenance manager</b> scans tools and maintenance stock; <b>Custodian manager</b> scans facilities stock; <b>Oversight</b> sees everything but changes nothing. Anyone can still check things out at the iPad by tapping their name.</p>
    ${isAdmin() ? `<div class="card"><form id="add" class="row">
      <label style="flex:1;min-width:160px">Name <input name="name" required></label>
      <label style="flex:1;min-width:200px">Email (for sign-in) <input name="email" type="email"></label>
      <label>Role <select name="role">${ROLE_ORDER.map((r) => `<option value="${r}">${ROLES[r].label}</option>`).join('')}</select></label>
      <button class="btn primary">Add person</button></form></div>` : ''}
    <div class="table-wrap"><table><tr><th>Name</th><th>Label code</th><th>Email</th><th>Role</th><th></th></tr>
      ${members.map((m) => `<tr style="${m.active ? '' : 'opacity:.5'}"><td>${esc(m.name)}${m.active ? '' : ' <span class="muted">(deactivated)</span>'}</td><td class="code">${esc(m.code)}</td><td>${esc(m.email)}</td><td>${esc(ROLES[m.role]?.label || m.role)}</td>
        <td>${isAdmin() ? `<button class="btn small" data-edit="${m.id}">Edit</button>` : ''}</td></tr>
        ${isAdmin() ? `<tr class="edit-row" id="edit-${m.id}" hidden><td colspan="5">${personForm(m)}</td></tr>` : ''}`).join('')}</table></div>
    <p><a class="btn" href="#/labels/people">Print name labels</a></p>`;

  app.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => {
    const row = app.querySelector(`#edit-${b.dataset.edit}`);
    row.hidden = !row.hidden;
    if (!row.hidden) row.querySelector('input[name="name"]').focus();
  }));
  app.querySelectorAll('form[data-person-form]').forEach((form) => {
    const m = members.find((x) => x.id === form.dataset.personForm);
    form.querySelector('[data-cancel]').addEventListener('click', () => {
      form.reset();
      form.querySelectorAll('select').forEach((sel) => sel.dispatchEvent(new Event('change')));
      form.closest('tr').hidden = true;
    });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = new FormData(form);
      const patch = {
        name: f.get('name').trim(),
        email: f.get('email').trim().toLowerCase() || null,
        code: f.get('code').trim().toUpperCase(),
      };
      if (!patch.name) return toast('Name is required', true);
      if (!patch.code) return toast('Label code is required', true);
      if (/^(FAC|MNT|EVS|TL|CMD)-/.test(patch.code)) return toast('That label code looks like an item, tool or command code. Use something like P-012.', true);
      if (m.id !== state.me.id) {
        patch.role = f.get('role');
        patch.active = f.get('active') === 'true';
      } else if (patch.email !== m.email && !(await askConfirm('Change your sign-in email?', { message: `You sign in with ${m.email}. After this you'll need to sign in with ${patch.email || 'no email (you would be locked out)'}.`, ok: 'Change it' }))) return;
      // A new code means the old printed label no longer scans.
      if (patch.code !== m.code) patch.label_printed_at = null;
      try {
        await q(sb.from('team_members').update(patch).eq('id', m.id).select());
        toast('Saved');
        route();
      } catch (err) {
        const msg = errMsg(err);
        toast(/duplicate|unique/i.test(msg) ? (/email/i.test(msg) ? 'Someone else already uses that email.' : 'Someone else already has that label code.') : msg, true);
      }
    });
  });
  app.querySelector('#add')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    try {
      await q(sb.from('team_members').insert({ name: f.get('name').trim(), email: f.get('email').trim().toLowerCase() || null, role: f.get('role') }).select());
      toast('Added');
      route();
    } catch (err) { toast(errMsg(err), true); }
  });
}

// ---------------------------------------------------------------------------
// Locations (shared list for storage spots and where things go)
// ---------------------------------------------------------------------------

async function renderLocations() {
  const [locations, items, tools] = await Promise.all([
    loadLocations(),
    q(sb.from('items').select('location').eq('active', true)),
    q(sb.from('tools').select('location').eq('active', true)),
  ]);
  const count = (rows, name) => rows.filter((r) => r.location === name).length;

  app.innerHTML = `
    ${pageHead('Settings', 'Locations', 'Shelves, rooms and places used for storing stock and tools, and on Check In / Out for where things are going.')}
    ${isAdmin() ? `<div class="card"><form id="add" class="row">
      <label style="flex:1;min-width:220px">New location <input name="name" required placeholder="e.g. Janitor closet, Youth Room, Trailer 2"></label>
      <button class="btn primary">Add location</button></form></div>` : ''}
    <div class="table-wrap"><table><tr><th>Location</th><th class="num">Stock items</th><th class="num">Tools</th><th></th></tr>
      ${locations.map((l) => `<tr><td><b>${esc(l.name)}</b></td><td class="num">${count(items, l.name) || ''}</td><td class="num">${count(tools, l.name) || ''}</td>
        <td style="text-align:right;white-space:nowrap">${isAdmin() ? `<button class="btn small" data-rename="${esc(l.name)}">Rename</button>
          <button class="btn small bad" data-remove="${esc(l.name)}">Delete</button>` : ''}</td></tr>`).join('')
      || '<tr><td colspan="4" class="muted">No locations yet.</td></tr>'}</table></div>
    <p class="muted" style="font-size:14px;margin-top:12px">Renaming updates every item and tool stored there. Deleting removes it from all lists; history that mentions it keeps the name.</p>`;

  app.querySelector('#add')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await rpc('add_location', { p_name: new FormData(e.target).get('name') }); toast('Location added'); route(); } catch (err) { toast(errMsg(err), true); }
  });
  app.querySelectorAll('[data-rename]').forEach((b) => b.addEventListener('click', async () => {
    const old = b.dataset.rename;
    const name = (await askText(`Rename "${old}"`, { value: old, ok: 'Rename' })) || '';
    if (!name || name === old) return;
    if (locations.some((l) => l.name === name)) return toast(`There's already a location called ${name}`, true);
    try { await q(sb.from('locations').update({ name }).eq('name', old).select()); toast('Renamed'); route(); } catch (err) { toast(errMsg(err), true); }
  }));
  app.querySelectorAll('[data-remove]').forEach((b) => b.addEventListener('click', async () => {
    const name = b.dataset.remove;
    const n = count(items, name) + count(tools, name);
    if (!(await askConfirm(`Delete "${name}"?`, { message: n ? `${n} item${n === 1 ? '' : 's'}/tool${n === 1 ? '' : 's'} stored there will be left with no location.` : '', ok: 'Delete', danger: true }))) return;
    try { await rpc('remove_location', { p_name: name }); toast(`Deleted ${name}`); route(); } catch (err) { toast(errMsg(err), true); }
  }));
}

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

// Build a PDF whose pages are exactly the label size, with the barcode drawn
// as vector bars. Browsers (iPad Safari especially) ignore CSS page sizes and
// print on letter paper, which feeds a foot of label tape; a PDF's page size
// is always respected.
// Draw a Code 128 barcode as filled rectangles inside the given box.
function pdfBarcode(pdf, code, x, y, bw, bh) {
  const enc = {};
  window.JsBarcode(enc, code, { format: 'CODE128' });
  const bits = enc.encodings.map((e) => e.data).join('');
  const quiet = 10; // modules of blank space each side, so scanners lock on
  const module = bw / (bits.length + quiet * 2);
  const textH = Math.min(0.16, bh * 0.22);
  const barH = bh - textH - 0.02;
  let i = 0;
  while (i < bits.length) {
    if (bits[i] === '1') {
      let run = 1;
      while (bits[i + run] === '1') run++;
      pdf.rect(x + (quiet + i) * module, y, run * module, barH, 'F');
      i += run;
    } else {
      i++;
    }
  }
  pdf.setFont('courier', 'normal');
  pdf.setFontSize(Math.max(6, Math.min(bh > 1.5 ? 16 : 11, textH * 72 * 0.85)));
  pdf.text(code, x + bw / 2, y + bh - 0.01, { align: 'center', baseline: 'bottom' });
}

// Fit a name into at most two lines by shrinking the font if needed.
function pdfName(pdf, name, sub, x, y, cw, ch, align) {
  let fs = Math.min(ch > 1.5 ? 26 : 13, Math.max(7, ch * 72 * 0.34));
  let lines;
  pdf.setFont('helvetica', 'bold');
  for (; fs >= 6; fs -= 0.5) {
    pdf.setFontSize(fs);
    lines = pdf.splitTextToSize(name, cw);
    if (lines.length <= 2) break;
  }
  lines = lines.slice(0, 2);
  const lineH = (fs / 72) * 1.15;
  const subFs = Math.max(6, fs * 0.7);
  const subH = sub ? (subFs / 72) * 1.3 : 0;
  const blockH = lines.length * lineH + subH;
  let ty = y + Math.max(0, (ch - blockH) / 2) + lineH * 0.8;
  const tx = align === 'center' ? x + cw / 2 : x;
  lines.forEach((ln) => { pdf.text(ln, tx, ty, { align }); ty += lineH; });
  if (sub) {
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(subFs);
    pdf.text(pdf.splitTextToSize(sub, cw)[0], tx, ty - lineH + subH + lineH * 0.2, { align });
  }
}

// One label (barcode + name) in a w×h box at (x, y).
function pdfLabel(pdf, r, x, y, w, h) {
  const pad = 0.07;
  pdf.setFillColor(0, 0, 0);
  pdf.setTextColor(0, 0, 0);
  if (w / h >= 2.2) {
    const bw = (w - pad * 3) * 0.6;
    pdfBarcode(pdf, r.code, x + pad, y + pad, bw, h - pad * 2);
    pdfName(pdf, r.name, r.sub, x + pad * 2 + bw, y + pad, w - bw - pad * 3, h - pad * 2, 'left');
  } else {
    const bh = (h - pad * 2) * 0.62;
    pdfBarcode(pdf, r.code, x + pad, y + pad, w - pad * 2, bh);
    pdfName(pdf, r.name, r.sub, x + pad, y + pad + bh + 0.02, w - pad * 2, h - pad * 2 - bh - 0.02, 'center');
  }
}

// Build a PDF whose pages are exactly the label size, with the barcode drawn
// as vector bars. Browsers (iPad Safari especially) ignore CSS page sizes and
// print on letter paper, which feeds a foot of label tape; a PDF's page size
// is always respected.
function buildLabelPdf(rows, size) {
  const { jsPDF } = window.jspdf;
  const { w, h } = size;
  const orient = w > h ? 'landscape' : 'portrait';
  const pdf = new jsPDF({ orientation: orient, unit: 'in', format: [w, h] });
  rows.forEach((r, n) => {
    if (n > 0) pdf.addPage([w, h], orient);
    pdfLabel(pdf, r, 0, 0, w, h);
  });
  return pdf;
}

// Letter-sheet grids, biggest labels first. 'auto' picks the biggest one that
// fits everything on one page; past that it uses the smallest (the per-page cap).
const SHEET_LAYOUTS = [
  { per: 4, cols: 1, rows: 4 },
  { per: 8, cols: 2, rows: 4 },
  { per: 12, cols: 2, rows: 6 },
  { per: 24, cols: 3, rows: 8 },
  { per: 30, cols: 3, rows: 10 },
];
function sheetLayout(count, perPage = 'auto') {
  if (perPage !== 'auto') return SHEET_LAYOUTS.find((l) => l.per === Number(perPage)) || SHEET_LAYOUTS.at(-1);
  return SHEET_LAYOUTS.find((l) => l.per >= count) || SHEET_LAYOUTS.at(-1);
}

// Letter-paper sheet of labels for any printer: a grid with light cut lines
// and a header, so it can be cut into labels or kept as a scan sheet.
function buildSheetPdf(rows, title, perPageChoice = 'auto') {
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'in', format: 'letter' });
  const layout = sheetLayout(rows.length, perPageChoice);
  const cols = layout.cols;
  const perCol = layout.rows;
  const margin = 0.5;
  const top = 0.95;
  const cw = (8.5 - margin * 2) / cols;
  const ch = (11 - top - 0.55) / perCol;
  const perPage = cols * perCol;
  const pages = Math.max(1, Math.ceil(rows.length / perPage));
  const stamp = new Date().toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
  for (let p = 0; p < pages; p++) {
    if (p > 0) pdf.addPage('letter', 'portrait');
    pdf.setTextColor(30, 42, 50);
    pdf.setFont('times', 'italic');
    pdf.setFontSize(18);
    pdf.text(title, margin, 0.62);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(9);
    pdf.setTextColor(110, 114, 117);
    pdf.text(`${rows.length} item${rows.length === 1 ? '' : 's'} · printed ${stamp} · page ${p + 1} of ${pages}`, 8.5 - margin, 0.62, { align: 'right' });
    pdf.setDrawColor(200, 196, 188);
    pdf.setLineWidth(0.005);
    pdf.setLineDashPattern([0.04, 0.04], 0);
    rows.slice(p * perPage, (p + 1) * perPage).forEach((r, i) => {
      const x = margin + (i % cols) * cw;
      const y = top + Math.floor(i / cols) * ch;
      pdf.rect(x, y, cw, ch, 'S');
      pdfLabel(pdf, r, x + 0.04, y + 0.04, cw - 0.08, ch - 0.08);
    });
    pdf.setLineDashPattern([], 0);
  }
  return pdf;
}

// Open a generated PDF from a click (pop-up blockers allow it then).
function openPdf(pdf) {
  pdf.autoPrint(); // opens the print dialog straight away in desktop PDF viewers
  const url = pdf.output('bloburl');
  const win = window.open(url, '_blank');
  if (!win) location.href = url;
}

// Rows for a stock sheet: sorted by location, then name.
function stockSheetRows(items, category) {
  return items
    .filter((i) => i.active && i.category === category)
    .sort((a, b) => (a.location || '\uffff').localeCompare(b.location || '\uffff') || a.name.localeCompare(b.name))
    .map((i) => ({ id: i.id, code: i.code, name: i.name, sub: i.location || '' }));
}

function labelHtml(code, name, sub = '') {
  return `<div class="label"><svg data-code="${esc(code)}"></svg><div class="ltext"><div class="lname">${esc(name)}</div>${sub ? `<div class="lsub">${esc(sub)}</div>` : ''}</div></div>`;
}

function drawBarcodes(root, size) {
  root.querySelectorAll('svg[data-code]').forEach((svg) => {
    window.JsBarcode(svg, svg.dataset.code, {
      format: 'CODE128', displayValue: true, margin: 0, fontSize: 14, textMargin: 1,
      height: size.w / size.h >= 2.2 ? 80 : Math.max(30, Math.round(size.h * 45)), width: 2,
    });
  });
}

function getPref(key, fallback) {
  try { return localStorage.getItem(key) || fallback; } catch { return fallback; }
}
function setPref(key, value) {
  try { localStorage.setItem(key, value); } catch { /* optional */ }
}

async function renderLabels(kind, id) {
  const [items, tools, members] = await Promise.all([loadItems(), loadTools(), loadMembers()]);
  const sources = {
    facilities: items.filter((i) => i.active && i.category === 'facilities').map((i) => ({ id: i.id, code: i.code, name: i.name, sub: i.location || '', printed: i.label_printed_at })),
    maintenance: items.filter((i) => i.active && i.category === 'maintenance').map((i) => ({ id: i.id, code: i.code, name: i.name, sub: i.location || '', printed: i.label_printed_at })),
    events: items.filter((i) => i.active && i.category === 'events').map((i) => ({ id: i.id, code: i.code, name: i.name, sub: i.location || '', printed: i.label_printed_at })),
    people: people(members).map((m) => ({ id: m.id, code: m.code, name: m.name, sub: '', printed: m.label_printed_at })),
    tool: tools.filter((t) => t.active).map((t) => ({ id: t.id, code: t.code, name: t.name, sub: t.location || '', printed: t.label_printed_at })),
    commands: [
      { id: 'in', code: CMD.IN, name: 'SCAN IN mode', sub: 'Scan Stock page' },
      { id: 'out', code: CMD.OUT, name: 'SCAN OUT mode', sub: 'Scan Stock page' },
      { id: 'count', code: CMD.COUNT, name: 'SET COUNT mode', sub: 'Admins only' },
      { id: 'done', code: CMD.DONE, name: 'DONE / CLEAR', sub: 'Finish or reset' },
    ],
  };
  const tab = sources[kind] ? kind : 'facilities';
  // Which table remembers when these labels were printed (commands aren't tracked).
  const trackKind = { facilities: 'item', maintenance: 'item', events: 'item', tool: 'tool', people: 'person' }[tab];
  const unprinted = trackKind ? sources[tab].filter((r) => !r.printed).length : 0;
  const preselect = new Set(id ? [id] : []);
  const sizeKey = getPref('labelSize2', 'brother-62c');

  app.innerHTML = `
    ${pageHead('Print', 'Labels', 'Barcode labels for your Brother label printer.')}
    <div class="card">
      <div class="row">
        <label>What <select id="kind">
          <option value="facilities" ${tab === 'facilities' ? 'selected' : ''}>Facilities stock</option>
          <option value="maintenance" ${tab === 'maintenance' ? 'selected' : ''}>Maintenance stock</option>
          <option value="events" ${tab === 'events' ? 'selected' : ''}>Event stock</option>
          <option value="tool" ${tab === 'tool' ? 'selected' : ''}>Tools</option>
          <option value="people" ${tab === 'people' ? 'selected' : ''}>People (name labels)</option>
          <option value="commands" ${tab === 'commands' ? 'selected' : ''}>Command barcodes</option></select></label>
        <label>Label size <select id="size">${Object.entries(LABEL_SIZES).map(([k, s]) => `<option value="${k}" ${k === sizeKey ? 'selected' : ''}>${s.name}</option>`).join('')}</select></label>
        <label>Copies each <input id="copies" type="number" min="1" max="20" value="1" style="width:80px"></label>
        <button class="btn primary" id="print">Print labels</button>
        <button class="btn" id="print-sheet" title="A grid on regular letter paper, for any printer">Print on letter paper</button>
        <label>Per page (letter) <select id="per-page">
          <option value="auto">Auto</option>${SHEET_LAYOUTS.map((l) => `<option value="${l.per}">${l.per} (${l.cols} × ${l.rows})</option>`).join('')}
        </select></label>
      </div>
      <p class="scan-hint">Opens a PDF sized exactly to one label per page. Print it to the Brother at <b>100% / Actual size</b> (not "Fit"). On iPad, tap the Share button on the PDF, then <b>Print</b>.</p>
      ${/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
        ? '<p class="scan-hint"><b>On iPad:</b> the Print button only finds printers over Wi-Fi (AirPrint). Bluetooth pairing isn\'t used. Put the label printer on the same Wi-Fi as this iPad, or print labels from a computer instead.</p>' : ''}
    </div>
    <div class="row" style="margin-bottom:10px;align-items:center">
      ${trackKind ? `<button class="btn small" id="unprinted" ${unprinted ? '' : 'disabled'}>Select unprinted (${unprinted})</button>` : ''}
      <button class="btn small" id="all">Select all</button><button class="btn small" id="none">Select none</button>
      <span id="print-status" class="muted" style="font-size:14px"></span>
    </div>
    <div class="table-wrap"><table id="label-table"></table></div>
    <h2>Preview</h2>
    <div class="label-preview" id="preview"></div>`;

  const paintTable = () => {
    const checked = new Set([...app.querySelectorAll('.pick:checked')].map((c) => c.value));
    const keep = (r) => checked.has(r.id) || (!app.querySelector('.pick') && preselect.has(r.id));
    app.querySelector('#label-table').innerHTML = `<tr><th></th><th>Code</th><th>Name</th>${trackKind ? '<th>Label</th>' : ''}</tr>
      ${sources[tab].map((r) => `<tr><td><input type="checkbox" class="pick" value="${r.id}" ${keep(r) ? 'checked' : ''}></td><td class="code">${esc(r.code)}</td><td>${esc(r.name)}</td>
        ${trackKind ? `<td>${r.printed ? `<span class="pill good">Printed ${new Date(r.printed).toLocaleDateString([], { month: 'short', day: 'numeric' })}</span>` : '<span class="pill low">Not printed</span>'}</td>` : ''}</tr>`).join('')
      || `<tr><td colspan="${trackKind ? 4 : 3}" class="muted">Nothing here yet.</td></tr>`}`;
    app.querySelectorAll('.pick').forEach((c) => c.addEventListener('change', paintPreview));
    const n = sources[tab].filter((r) => !r.printed).length;
    const btn = app.querySelector('#unprinted');
    if (btn) { btn.textContent = `Select unprinted (${n})`; btn.disabled = !n; }
  };

  const size = () => LABEL_SIZES[app.querySelector('#size').value];
  const picked = () => {
    const ids = new Set([...app.querySelectorAll('.pick:checked')].map((c) => c.value));
    return sources[tab].filter((r) => ids.has(r.id));
  };
  const applySize = (el) => {
    const s = size();
    el.style.setProperty('--lw', `${s.w}in`);
    el.style.setProperty('--lh', `${s.h}in`);
    el.style.setProperty('--lfont', s.h <= 1.1 ? '9pt' : s.h <= 1.3 ? '10pt' : '13pt');
    // Short, wide labels (like Brother DK-1201) put the barcode beside the text
    // so the bars can use the full label height.
    el.classList.toggle('wide', s.w / s.h >= 2.2);
  };
  const paintPreview = () => {
    const prev = app.querySelector('#preview');
    const rows = picked();
    prev.innerHTML = rows.length ? rows.map((r) => labelHtml(r.code, r.name, r.sub)).join('') : '<p class="muted">Tick what you want to print.</p>';
    applySize(prev);
    drawBarcodes(prev, size());
  };

  app.querySelector('#kind').addEventListener('change', (e) => (location.hash = `#/labels/${e.target.value}`));
  app.querySelector('#size').addEventListener('change', (e) => { setPref('labelSize2', e.target.value); paintPreview(); });
  app.querySelector('#unprinted')?.addEventListener('click', () => {
    app.querySelectorAll('.pick').forEach((c) => (c.checked = !sources[tab].find((r) => r.id === c.value)?.printed));
    paintPreview();
  });
  app.querySelector('#all').addEventListener('click', () => { app.querySelectorAll('.pick').forEach((c) => (c.checked = true)); paintPreview(); });
  app.querySelector('#none').addEventListener('click', () => { app.querySelectorAll('.pick').forEach((c) => (c.checked = false)); paintPreview(); });
  app.querySelector('#print').addEventListener('click', () => {
    const rows = picked();
    if (!rows.length) return toast('Select at least one label');
    if (!window.jspdf || !window.JsBarcode) return toast('Still loading — try again in a second', true);
    const copies = Math.min(20, Math.max(1, parseInt(app.querySelector('#copies').value, 10) || 1));
    openPdf(buildLabelPdf(rows.flatMap((r) => Array(copies).fill(r)), size()));
    if (trackKind) markPrinted(rows, true);
  });
  app.querySelector('#print-sheet').addEventListener('click', () => {
    const rows = picked();
    if (!rows.length) return toast('Select at least one label');
    if (!window.jspdf || !window.JsBarcode) return toast('Still loading — try again in a second', true);
    const copies = Math.min(20, Math.max(1, parseInt(app.querySelector('#copies').value, 10) || 1));
    const title = { facilities: 'Facilities stock', maintenance: 'Maintenance stock', events: 'Event stock', tool: 'Tools', people: 'Team', commands: 'Command barcodes' }[tab];
    openPdf(buildSheetPdf(rows.flatMap((r) => Array(copies).fill(r)), title, app.querySelector('#per-page').value));
  });

  // Remember what was printed; offer an undo in case the printer jammed.
  async function markPrinted(rows, printed) {
    const status = app.querySelector('#print-status');
    try {
      await rpc('mark_labels_printed', { p_kind: trackKind, p_ids: rows.map((r) => r.id), p_printed: printed });
      const now = new Date().toISOString();
      rows.forEach((r) => (r.printed = printed ? now : null));
      paintTable();
      if (!status) return;
      if (printed) {
        status.innerHTML = `Marked ${rows.length} label${rows.length === 1 ? '' : 's'} as printed. <a href="#" id="undo-print">Undo</a>`;
        status.querySelector('#undo-print').addEventListener('click', (e) => { e.preventDefault(); markPrinted(rows, false); });
      } else {
        status.textContent = `Unmarked ${rows.length} label${rows.length === 1 ? '' : 's'}.`;
      }
    } catch (e) { toast(errMsg(e), true); }
  }

  paintTable();
  paintPreview();
}

boot();

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.58.0/+esm';
import { SUPABASE_URL, SUPABASE_KEY, APP_NAME } from './config.js';

const sb = createClient(SUPABASE_URL, SUPABASE_KEY);
const app = document.getElementById('app');

// Special barcodes you can print from the Labels page and scan to switch modes.
const CMD = { IN: 'CMD-IN', OUT: 'CMD-OUT', COUNT: 'CMD-COUNT', DONE: 'CMD-DONE' };

const LABEL_SIZES = {
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
  kiosk: { person: null, event: null, mode: 'out', qty: 1, log: [], idle: null, pendingTool: null },
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
    if (!e.target.closest('input, select, textarea, button, a')) input.focus();
  };
  document.addEventListener('click', refocus);
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
  if (event === 'PASSWORD_RECOVERY') return renderSetPassword();
  if (event === 'SIGNED_IN' || event === 'SIGNED_OUT') {
    const changed = (session?.user?.id || null) !== (state.session?.user?.id || null);
    state.session = session;
    if (changed) boot();
  }
});

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
    const links = isKiosk()
      ? [['kiosk', 'Check In / Out'], ['out', 'Who Has What'], ['events', 'Events']]
      : [['kiosk', 'Check In / Out'], ['out', 'Who Has What'], ['events', 'Events'], ['stock', 'Scan Stock'],
        ['items', 'Inventory'], ['toollist', 'Tools'], ['history', 'History'], ['labels', 'Labels'], ['people', 'People']];
    const cur = location.hash.slice(2).split('/')[0] || 'kiosk';
    nav.innerHTML = links.map(([k, t]) => `<a href="#/${k}" class="${cur === k ? 'active' : ''}">${t}</a>`).join('');
    who.innerHTML = `<span>${esc(state.me.name)}${isAdmin() ? ' · admin' : ''}${isKiosk() ? ' · kiosk' : ''}</span><button id="signout">Sign out</button>`;
  }
  document.getElementById('signout')?.addEventListener('click', () => sb.auth.signOut());
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
};

window.addEventListener('hashchange', () => state.me && route());

async function route() {
  const [name, ...args] = location.hash.slice(2).split('/');
  const kioskOnly = ['kiosk', 'out', 'events', 'event'];
  const fn = (isKiosk() && !kioskOnly.includes(name) ? null : routes[name]) || renderKiosk;
  if (name !== 'kiosk') clearTimeout(state.kiosk.idle);
  renderTopbar();
  app.innerHTML = LOADER;
  try {
    await fn(...args);
  } catch (e) {
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
          <select id="pick" style="flex:1;min-width:200px"><option value="">Choose an item…</option>${active.map((i) => `<option value="${esc(i.code)}">${esc(i.name)} (${i.quantity} ${esc(i.unit)})</option>`).join('')}</select>
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
      const verb = state.stockMode === 'adjust' ? `Count set (${res.change >= 0 ? '+' : ''}${res.change})` : `${Math.abs(res.change)} ${it.unit} ${state.stockMode === 'in' ? 'in' : 'out'}`;
      const low = it.reorder_level > 0 && it.quantity <= it.reorder_level;
      show('ok', `${esc(verb)} — <b>${esc(it.name)}</b>. Now ${it.quantity} ${esc(it.unit)} on hand.${low ? ` <span class="pill low">LOW — reorder</span>` : ''}`);
      state.stockLog.unshift({ type: state.stockMode, text: `${verb} · ${it.name} → ${it.quantity} ${it.unit}`, time: new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) });
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
  const [members, events] = await Promise.all([loadMembers(), openEvents()]);
  const crew = people(members);
  const k = state.kiosk;
  if (k.event && !events.some((e) => e.id === k.event.id)) k.event = null;

  app.innerHTML = `
    <div class="kiosk">
      <div id="k-who"></div>
      <input id="scan" class="scanbox" placeholder="Scan a name label, tool or item…" autocomplete="off" autocapitalize="characters">
      <div id="status"></div>
      <div id="k-panel"></div>
      <h2>This session</h2>
      <div class="card"><ul class="log" id="log"></ul></div>
    </div>`;

  const scan = app.querySelector('#scan');
  const status = app.querySelector('#status');
  const show = (cls, html) => (status.innerHTML = `<div class="big-status ${cls}">${html}</div>`);
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
    if (k.person) k.idle = setTimeout(() => { endSession(); show('info', 'Timed out — scan your name label to start again.'); }, KIOSK_IDLE_MS);
  };
  const endSession = () => {
    k.person = null;
    k.event = null;
    k.mode = 'out';
    k.qty = 1;
    k.pendingTool = null;
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
          <p class="lede">Scan your name label or tap your name. <b>Just returning something?</b> Scan it — no name needed.</p>
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
          <div><div class="eyebrow">Signed in at the kiosk</div><h1 class="kiosk-title" style="margin:0">Hi, <span class="accent">${esc(k.person.name)}</span></h1></div>
          <button class="btn bad" id="k-done" style="font-size:18px;padding:10px 22px">Done</button>
        </div>
        <h2 style="margin-top:22px">Where is it going?</h2>
        <div class="modes" id="k-event">
          <button class="btn ${k.event ? '' : 'on primary'}" data-event="">Shop use</button>
          ${events.map((e) => `<button class="btn ${k.event?.id === e.id ? 'on primary' : ''}" data-event="${e.id}">${esc(e.name)}${e.starts_on ? ` <span style="font-weight:400">· ${new Date(`${e.starts_on}T12:00`).toLocaleDateString([], { month: 'short', day: 'numeric' })}</span>` : ''}</button>`).join('')}
        </div>
        <h2>Stock items</h2>
        <div class="row" style="align-items:center">
          <div class="modes" id="k-mode">
            <button class="btn out ${k.mode === 'out' ? 'on' : ''}" data-mode="out">Taking</button>
            <button class="btn in ${k.mode === 'in' ? 'on' : ''}" data-mode="in">Putting back</button>
          </div>
          <div class="stepper">
            <button class="btn" data-step="-1">−</button>
            <input id="k-qty" type="number" min="1" value="${k.qty}" inputmode="numeric">
            <button class="btn" data-step="1">+</button>
          </div>
        </div>
        <p class="scan-hint">Tools: scan to sign out, scan again later to return. Items: set the quantity, then scan.</p>
      </div>`;
    el.querySelector('#k-done').addEventListener('click', () => { endSession(); show('ok', 'All set — thanks!'); });
    el.querySelectorAll('[data-event]').forEach((b) => b.addEventListener('click', () => {
      k.event = events.find((e) => e.id === b.dataset.event) || null;
      paintWho(); resetIdle(); scan.focus();
    }));
    el.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => {
      k.mode = b.dataset.mode;
      paintWho(); resetIdle(); scan.focus();
    }));
    const qtyEl = el.querySelector('#k-qty');
    qtyEl.addEventListener('change', () => { k.qty = Math.max(1, parseInt(qtyEl.value, 10) || 1); qtyEl.value = k.qty; });
    el.querySelectorAll('[data-step]').forEach((b) => b.addEventListener('click', () => {
      k.qty = Math.max(1, k.qty + Number(b.dataset.step));
      qtyEl.value = k.qty;
      resetIdle();
    }));
  }

  async function doCheckout(tool) {
    try {
      await rpc('checkout_tool', { p_code: tool.code, p_borrower: k.person.id, p_event: k.event?.id || null });
      beep(true);
      const where = k.event ? ` for ${k.event.name}` : '';
      show('ok', `<b>${esc(tool.name)}</b> signed out to <b>${esc(k.person.name)}</b>${esc(where)}.`);
      log('out', `${tool.name} → ${k.person.name}${where}`);
    } catch (e) { beep(false); show('err', esc(errMsg(e))); }
  }

  async function doReturn(tool, checkout) {
    try {
      await rpc('return_tool', { p_code: tool.code, p_condition: 'good' });
      beep(true);
      status.innerHTML = `
        <div class="big-status ok"><b>${esc(tool.name)}</b> returned (was out to ${esc(checkout.borrower_name)} for ${since(checkout.checked_out_at)}).
          <div class="row" style="margin-top:10px"><span style="font-size:15px;font-weight:400">Something wrong with it?</span>
            <button class="btn out small" data-c="damaged">Damaged</button>
            <button class="btn bad small" data-c="needs_repair">Needs repair</button></div></div>`;
      status.querySelectorAll('[data-c]').forEach((b) => b.addEventListener('click', async () => {
        const note = prompt('What\'s wrong with it? (optional)') || '';
        try {
          await rpc('report_tool_problem', { p_tool: tool.id, p_condition: b.dataset.c, p_note: note });
          show('info', `<b>${esc(tool.name)}</b> flagged ${b.dataset.c.replace('_', ' ')} — it won't go out again until it's fixed.`);
          log('repair', `${tool.name} flagged ${b.dataset.c.replace('_', ' ')}`);
        } catch (e) { show('err', esc(errMsg(e))); }
        scan.focus();
      }));
      log('in', `${tool.name} returned`);
    } catch (e) { beep(false); show('err', esc(errMsg(e))); }
  }

  async function onScan(code) {
    const upper = code.toUpperCase();
    resetIdle();
    if (upper === CMD.DONE) { endSession(); return show('ok', 'All set — thanks!'); }
    if (upper === CMD.IN || upper === CMD.OUT) {
      if (!k.person) return show('err', 'Scan your name label first.');
      k.mode = upper === CMD.IN ? 'in' : 'out';
      paintWho();
      return show('info', k.mode === 'in' ? 'Putting stock back.' : 'Taking stock.');
    }

    let hit;
    try { hit = await rpc('lookup_code', { p_code: code }); } catch (e) { return show('err', esc(errMsg(e))); }

    if (hit.kind === 'person') {
      const m = crew.find((x) => x.id === hit.record.id);
      if (!m) { beep(false); return show('err', 'That name label is inactive.'); }
      startSession(m);
      beep(true);
      if (k.pendingTool) { const t = k.pendingTool; k.pendingTool = null; return doCheckout(t); }
      return show('info', `Hi ${esc(m.name)} — scan what you're taking or returning.`);
    }

    if (hit.kind === 'tool') {
      const tool = hit.record;
      if (hit.checkout) return doReturn(tool, hit.checkout);
      if (!tool.active || tool.status !== 'available') { beep(false); return show('err', `${esc(tool.name)} is marked <b>${esc(tool.status)}</b> and can't go out.`); }
      if (!k.person) {
        k.pendingTool = tool;
        beep(false);
        return show('info', `Who's taking <b>${esc(tool.name)}</b>? Scan your name label or tap your name above.`);
      }
      return doCheckout(tool);
    }

    if (hit.kind === 'item') {
      if (!k.person) { beep(false); return show('err', 'Scan your name label first.'); }
      const qty = k.qty;
      try {
        const res = await rpc('scan_item', { p_code: code, p_type: k.mode, p_qty: qty, p_member: k.person.id, p_event: k.event?.id || null });
        const it = res.item;
        const low = it.reorder_level > 0 && it.quantity <= it.reorder_level;
        const where = k.event ? ` (${k.event.name})` : '';
        beep(true);
        show('ok', `${k.mode === 'in' ? 'Put back' : 'Took'} ${qty} ${esc(it.unit)} <b>${esc(it.name)}</b>${esc(where)}. ${it.quantity} left.${low ? ' <span class="pill low">LOW — tell the office</span>' : ''}`);
        log(k.mode, `${qty} ${it.unit} ${it.name}${where} · ${k.person.name}`);
        k.qty = 1;
        paintWho();
      } catch (e) { beep(false); show('err', esc(errMsg(e))); }
      return;
    }

    beep(false);
    show('err', `Unknown barcode: ${esc(code)}`);
  }

  bindScanner(scan, onScan);
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
    <details class="card" ${live.length ? '' : 'open'}><summary><b>New event</b></summary>
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
      ${[...crewIds].map((mid) => `<span class="chip">${esc(who[mid])} ${ev.status !== 'closed' ? `<button class="x" data-remove="${mid}" title="Remove">×</button>` : ''}</span>`).join('') || '<span class="muted">No crew yet.</span>'}
      ${ev.status !== 'closed' && notCrew.length ? `<select id="add-crew"><option value="">+ Add person…</option>${notCrew.map((m) => `<option value="${m.id}">${esc(m.name)}</option>`).join('')}</select>` : ''}
    </div></div>

    <h2>Tools</h2>
    <div class="table-wrap"><table><tr><th>Tool</th><th>Signed out by</th><th>Out</th><th>Back</th><th></th></tr>
      ${checkouts.map((c) => { const t = toolBy[c.tool_id]; return `<tr class="${c.returned_at ? '' : 'overdue'}"><td><a href="#/tool/${t?.id}">${esc(t?.name)}</a> <span class="code muted">${esc(t?.code)}</span></td><td>${esc(who[c.borrower_id])}</td><td>${fmtDate(c.checked_out_at)}</td>
        <td>${c.returned_at ? `${fmtDate(c.returned_at)}${c.return_condition && c.return_condition !== 'good' ? ` <span class="pill ${c.return_condition}">${c.return_condition.replace('_', ' ')}</span>` : ''}` : '<span class="pill out">NOT BACK</span>'}</td>
        <td>${c.returned_at ? '' : `<button class="btn small bad" data-lost="${c.tool_id}">Mark lost</button>`}</td></tr>`; }).join('')
      || '<tr><td colspan="5" class="muted">No tools signed out to this event yet. Pick this event on the Check In/Out screen and scan.</td></tr>'}</table></div>

    <h2>Stock</h2>
    <div class="table-wrap"><table><tr><th>Item</th><th class="num">Taken</th><th class="num">Brought back</th><th class="num">Used</th></tr>
      ${Object.entries(stock).map(([iid, s]) => { const it = itemBy[iid]; return `<tr><td>${esc(it?.name)} <span class="code muted">${esc(it?.code)}</span></td><td class="num">${s.taken}</td><td class="num">${s.back}</td><td class="num"><b>${s.taken - s.back}</b> ${esc(it?.unit)}</td></tr>`; }).join('')
      || '<tr><td colspan="4" class="muted">No stock scanned for this event.</td></tr>'}</table></div>

    <div class="row" style="margin-top:18px">
      ${ev.status !== 'closed' ? '<button class="btn primary" id="close">Close event</button>' : '<button class="btn" id="reopen">Reopen event</button>'}
      <button class="btn" id="csv">Export CSV</button>
    </div>
    ${ev.status !== 'closed' ? `<details class="card" style="margin-top:16px"><summary><b>Edit event details</b></summary><form id="edit" style="margin-top:12px">${eventForm(ev)}<div style="margin-top:12px"><button class="btn primary">Save</button></div></form></details>` : ''}`;

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
    if (!confirm(`Mark ${t?.name} as LOST? It will be taken off the available list.`)) return;
    try { await rpc('mark_tool_lost', { p_tool: b.dataset.lost, p_note: `Not returned from ${ev.name}` }); reload(); } catch (e) { toast(errMsg(e), true); }
  }));
  app.querySelector('#close')?.addEventListener('click', async () => {
    if (stillOut.length && !confirm(`${stillOut.length} tool(s) still aren't back. Close the event anyway? They'll stay signed out to the person who took them.`)) return;
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
        return `<tr class="${late ? 'overdue' : ''}"><td><a href="#/tool/${t?.id}">${esc(t?.name)}</a></td><td class="code">${esc(t?.code)}</td><td>${c.event_id ? `<a href="#/event/${c.event_id}">${esc(evName[c.event_id])}</a>` : '<span class="muted">shop</span>'}</td><td>${fmtDate(c.checked_out_at)} <span class="muted">(${since(c.checked_out_at)})</span></td><td>${c.due_at ? new Date(c.due_at).toLocaleDateString() : ''}${late ? ' <span class="pill overdue">OVERDUE</span>' : ''}</td><td>${esc(c.out_note)}</td></tr>`;
      }).join('')}</table></div>`).join('') || '<div class="card muted">Every tool is in.</div>'}
    ${flagged.length ? `<h2>Needs attention</h2><div class="table-wrap"><table><tr><th>Tool</th><th>Code</th><th>Status</th></tr>
      ${flagged.map((t) => `<tr><td><a href="#/tool/${t.id}">${esc(t.name)}</a></td><td class="code">${esc(t.code)}</td><td><span class="pill ${t.status}">${t.status}</span></td></tr>`).join('')}</table></div>` : ''}`;
}

// ---------------------------------------------------------------------------
// Inventory list & item detail
// ---------------------------------------------------------------------------

function itemForm(it = {}) {
  return `
    <div class="row">
      <label style="flex:2;min-width:200px">Name <input name="name" required value="${esc(it.name)}"></label>
      <label style="flex:1;min-width:140px">Location <input name="location" value="${esc(it.location)}" placeholder="Shelf A3"></label>
      <label style="width:100px">Unit <input name="unit" value="${esc(it.unit || 'ea')}" placeholder="ea, box, ft"></label>
      <label style="width:120px">Reorder at <input name="reorder_level" type="number" min="0" value="${it.reorder_level ?? 0}"></label>
      ${it.id ? '' : '<label style="width:120px">Starting qty <input name="start" type="number" min="0" value="0"></label>'}
    </div>
    <label style="margin-top:10px">Description <input name="description" value="${esc(it.description)}"></label>`;
}

async function renderItems() {
  const items = await loadItems();
  const show = items.filter((i) => i.active);
  const low = show.filter((i) => i.reorder_level > 0 && i.quantity <= i.reorder_level);

  app.innerHTML = `
    ${pageHead('Stock room', 'Inventory')}
    <div class="stats">
      <div class="stat"><b>${show.length}</b><span>items</span></div>
      <div class="stat"><b style="color:${low.length ? 'var(--warn)' : 'inherit'}">${low.length}</b><span>at or below reorder level</span></div>
    </div>
    ${isAdmin() ? `<details class="card"><summary><b>Add an item</b></summary><form id="add" style="margin-top:12px">${itemForm()}<div style="margin-top:12px"><button class="btn primary">Add item</button></div></form></details>` : ''}
    <div class="row" style="margin-bottom:10px">
      <input id="filter" placeholder="Search…" style="flex:1;min-width:200px">
      <label class="row" style="flex-direction:row;align-items:center"><input type="checkbox" id="lowonly"> Low only</label>
      <button class="btn" id="csv">Export CSV</button>
    </div>
    <div class="table-wrap"><table id="tbl"></table></div>
    ${items.length > show.length ? `<p class="muted">${items.length - show.length} archived item(s) hidden.</p>` : ''}`;

  const paint = () => {
    const f = app.querySelector('#filter').value.toLowerCase();
    const lowOnly = app.querySelector('#lowonly').checked;
    const rows = show.filter((i) => (!f || `${i.name} ${i.code} ${i.location} ${i.description}`.toLowerCase().includes(f)) && (!lowOnly || low.includes(i)));
    app.querySelector('#tbl').innerHTML = `<tr><th>Code</th><th>Item</th><th>Location</th><th class="num">On hand</th><th class="num">Reorder at</th></tr>
      ${rows.map((i) => `<tr class="${low.includes(i) ? 'low' : ''}"><td class="code">${esc(i.code)}</td><td><a href="#/item/${i.id}">${esc(i.name)}</a>${low.includes(i) ? ' <span class="pill low">LOW</span>' : ''}</td><td>${esc(i.location)}</td><td class="num"><b>${i.quantity}</b> ${esc(i.unit)}</td><td class="num">${i.reorder_level || ''}</td></tr>`).join('')
      || '<tr><td colspan="5" class="muted">No items yet.</td></tr>'}`;
  };
  app.querySelector('#filter').addEventListener('input', paint);
  app.querySelector('#lowonly').addEventListener('change', paint);
  app.querySelector('#csv').addEventListener('click', () => downloadCsv('inventory.csv', show.map((i) => ({
    code: i.code, name: i.name, location: i.location, on_hand: i.quantity, unit: i.unit, reorder_at: i.reorder_level, description: i.description,
  }))));
  app.querySelector('#add')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    try {
      const [row] = await q(sb.from('items').insert({
        name: f.get('name').trim(), location: f.get('location').trim() || null, unit: f.get('unit').trim() || 'ea',
        reorder_level: parseInt(f.get('reorder_level'), 10) || 0, description: f.get('description').trim() || null,
      }).select());
      const start = parseInt(f.get('start'), 10) || 0;
      if (start > 0) await rpc('scan_item', { p_code: row.code, p_type: 'adjust', p_qty: start, p_note: 'Starting count' });
      toast(`Added ${row.name} as ${row.code}`);
      route();
    } catch (err) { toast(errMsg(err), true); }
  });
  paint();
}

async function renderItem(id) {
  const [[it], tx, members] = await Promise.all([
    q(sb.from('items').select('*').eq('id', id)),
    q(sb.from('item_transactions').select('*').eq('item_id', id).order('created_at', { ascending: false }).limit(300)),
    loadMembers(),
  ]);
  if (!it) throw new Error('Item not found');
  const who = Object.fromEntries(members.map((m) => [m.id, m.name]));

  app.innerHTML = `
    <p><a href="#/items">← Inventory</a></p>
    <h1>${esc(it.name)} <span class="code muted">${esc(it.code)}</span></h1>
    <div class="stats">
      <div class="stat"><b>${it.quantity}</b><span>${esc(it.unit)} on hand</span></div>
      <div class="stat"><b>${it.reorder_level || '—'}</b><span>reorder at</span></div>
      <div class="stat"><b>${esc(it.location || '—')}</b><span>location</span></div>
    </div>
    <div class="row" style="margin-bottom:16px"><a class="btn" href="#/labels/item/${it.id}">Print label</a></div>
    ${isAdmin() ? `<details class="card"><summary><b>Edit item</b></summary><form id="edit" style="margin-top:12px">${itemForm(it)}
      <div class="row" style="margin-top:12px"><button class="btn primary">Save</button>
      <button type="button" class="btn ${it.active ? 'bad' : ''}" id="archive">${it.active ? 'Archive item' : 'Restore item'}</button></div></form></details>` : ''}
    <h2>History</h2>
    <div class="table-wrap"><table><tr><th>When</th><th>Type</th><th class="num">Change</th><th class="num">After</th><th>Who</th><th>Note</th></tr>
      ${tx.map((t) => `<tr><td>${fmtDate(t.created_at)}</td><td><span class="pill ${t.type}">${t.type}</span></td><td class="num">${t.qty > 0 ? '+' : ''}${t.qty}</td><td class="num">${t.qty_after}</td><td>${esc(who[t.member_id])}</td><td>${esc(t.note)}</td></tr>`).join('')
      || '<tr><td colspan="6" class="muted">No activity yet.</td></tr>'}</table></div>`;

  app.querySelector('#edit')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    try {
      await q(sb.from('items').update({
        name: f.get('name').trim(), location: f.get('location').trim() || null, unit: f.get('unit').trim() || 'ea',
        reorder_level: parseInt(f.get('reorder_level'), 10) || 0, description: f.get('description').trim() || null,
      }).eq('id', it.id).select());
      toast('Saved');
      route();
    } catch (err) { toast(errMsg(err), true); }
  });
  app.querySelector('#archive')?.addEventListener('click', async () => {
    if (it.active && !confirm(`Archive ${it.name}? It will stop scanning but keep its history.`)) return;
    try { await q(sb.from('items').update({ active: !it.active }).eq('id', it.id).select()); route(); } catch (err) { toast(errMsg(err), true); }
  });
}

// ---------------------------------------------------------------------------
// Tool list & tool detail
// ---------------------------------------------------------------------------

function toolForm(t = {}) {
  return `
    <div class="row">
      <label style="flex:2;min-width:200px">Name <input name="name" required value="${esc(t.name)}" placeholder="Hilti TE 30 hammer drill"></label>
      <label style="flex:1;min-width:140px">Serial # <input name="serial_number" value="${esc(t.serial_number)}"></label>
      <label style="flex:1;min-width:120px">Home location <input name="location" value="${esc(t.location)}"></label>
      <label style="width:120px">Value ($) <input name="value" type="number" min="0" step="0.01" value="${t.value ?? ''}"></label>
    </div>
    <label style="margin-top:10px">Description <input name="description" value="${esc(t.description)}"></label>`;
}

const toolFields = (f) => ({
  name: f.get('name').trim(), serial_number: f.get('serial_number').trim() || null, location: f.get('location').trim() || null,
  value: f.get('value') ? Number(f.get('value')) : null, description: f.get('description').trim() || null,
});

async function renderToolList() {
  const [tools, members, open] = await Promise.all([loadTools(), loadMembers(), q(sb.from('tool_checkouts').select('tool_id, borrower_id, checked_out_at').is('returned_at', null))]);
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
    ${isAdmin() ? `<details class="card"><summary><b>Add a tool</b></summary><form id="add" style="margin-top:12px">${toolForm()}<div style="margin-top:12px"><button class="btn primary">Add tool</button></div></form></details>` : ''}
    <div class="row" style="margin-bottom:10px"><input id="filter" placeholder="Search…" style="flex:1;min-width:200px"><button class="btn" id="csv">Export CSV</button></div>
    <div class="table-wrap"><table id="tbl"></table></div>`;

  const paint = () => {
    const f = app.querySelector('#filter').value.toLowerCase();
    const rows = show.filter((t) => !f || `${t.name} ${t.code} ${t.serial_number} ${t.location}`.toLowerCase().includes(f));
    app.querySelector('#tbl').innerHTML = `<tr><th>Code</th><th>Tool</th><th>Serial</th><th>Status</th><th>With</th></tr>
      ${rows.map((t) => `<tr><td class="code">${esc(t.code)}</td><td><a href="#/tool/${t.id}">${esc(t.name)}</a></td><td class="code">${esc(t.serial_number)}</td><td><span class="pill ${t.status}">${t.status}</span></td><td>${openBy[t.id] ? `${esc(who[openBy[t.id].borrower_id])} <span class="muted">(${since(openBy[t.id].checked_out_at)})</span>` : ''}</td></tr>`).join('')
      || '<tr><td colspan="5" class="muted">No tools yet.</td></tr>'}`;
  };
  app.querySelector('#filter').addEventListener('input', paint);
  app.querySelector('#csv').addEventListener('click', () => downloadCsv('tools.csv', show.map((t) => ({
    code: t.code, name: t.name, serial: t.serial_number, status: t.status, with: openBy[t.id] ? who[openBy[t.id].borrower_id] : '', location: t.location, value: t.value,
  }))));
  app.querySelector('#add')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const [row] = await q(sb.from('tools').insert(toolFields(new FormData(e.target))).select());
      toast(`Added ${row.name} as ${row.code}`);
      route();
    } catch (err) { toast(errMsg(err), true); }
  });
  paint();
}

async function renderTool(id) {
  const [[t], hist, members] = await Promise.all([
    q(sb.from('tools').select('*').eq('id', id)),
    q(sb.from('tool_checkouts').select('*').eq('tool_id', id).order('checked_out_at', { ascending: false }).limit(300)),
    loadMembers(),
  ]);
  if (!t) throw new Error('Tool not found');
  const who = Object.fromEntries(members.map((m) => [m.id, m.name]));

  app.innerHTML = `
    <p><a href="#/toollist">← Tools</a></p>
    <h1>${esc(t.name)} <span class="code muted">${esc(t.code)}</span></h1>
    <div class="stats">
      <div class="stat"><b><span class="pill ${t.status}">${t.status}</span></b><span>status</span></div>
      <div class="stat"><b>${esc(t.serial_number || '—')}</b><span>serial #</span></div>
      <div class="stat"><b>${t.value ? `$${Number(t.value).toLocaleString()}` : '—'}</b><span>value</span></div>
      <div class="stat"><b>${hist.length}</b><span>times signed out</span></div>
    </div>
    <div class="row" style="margin-bottom:16px"><a class="btn" href="#/labels/tool/${t.id}">Print label</a>
      ${isAdmin() && t.status !== 'out' ? `<select id="status">${['available', 'repair', 'lost', 'retired'].map((s) => `<option ${s === t.status ? 'selected' : ''}>${s}</option>`).join('')}</select><button class="btn" id="set-status">Set status</button>` : ''}
    </div>
    ${isAdmin() ? `<details class="card"><summary><b>Edit tool</b></summary><form id="edit" style="margin-top:12px">${toolForm(t)}
      <div class="row" style="margin-top:12px"><button class="btn primary">Save</button>
      <button type="button" class="btn ${t.active ? 'bad' : ''}" id="archive">${t.active ? 'Archive tool' : 'Restore tool'}</button></div></form></details>` : ''}
    <h2>Sign-out history</h2>
    <div class="table-wrap"><table><tr><th>Who</th><th>Out</th><th>Returned</th><th>Condition</th><th>Notes</th></tr>
      ${hist.map((c) => `<tr><td>${esc(who[c.borrower_id])}</td><td>${fmtDate(c.checked_out_at)}</td><td>${c.returned_at ? fmtDate(c.returned_at) : '<span class="pill out">still out</span>'}</td><td>${c.return_condition ? `<span class="pill ${c.return_condition}">${c.return_condition.replace('_', ' ')}</span>` : ''}</td><td>${esc([c.out_note, c.return_note].filter(Boolean).join(' / '))}</td></tr>`).join('')
      || '<tr><td colspan="5" class="muted">Never signed out.</td></tr>'}</table></div>`;

  app.querySelector('#set-status')?.addEventListener('click', async () => {
    try { await rpc('set_tool_status', { p_tool: t.id, p_status: app.querySelector('#status').value }); toast('Status updated'); route(); } catch (err) { toast(errMsg(err), true); }
  });
  app.querySelector('#edit')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await q(sb.from('tools').update(toolFields(new FormData(e.target))).eq('id', t.id).select()); toast('Saved'); route(); } catch (err) { toast(errMsg(err), true); }
  });
  app.querySelector('#archive')?.addEventListener('click', async () => {
    if (t.active && !confirm(`Archive ${t.name}? It will stop scanning but keep its history.`)) return;
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
      <label>Show <select id="kind"><option value="stock">Stock scans</option><option value="tools">Tool sign-outs</option></select></label>
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
      rows = tx.map((t) => ({ when: fmtDate(t.created_at), type: t.type, code: itemBy[t.item_id]?.code, item: itemBy[t.item_id]?.name, change: t.qty, after: t.qty_after, unit: itemBy[t.item_id]?.unit, who: who[t.member_id], event: evName[t.event_id] || '', recorded_by: t.recorded_by && t.recorded_by !== t.member_id ? who[t.recorded_by] : '', note: t.note }));
      out.innerHTML = `<div class="table-wrap"><table><tr><th>When</th><th>Type</th><th>Item</th><th class="num">Change</th><th class="num">After</th><th>Who</th><th>Event</th><th>Note</th></tr>
        ${rows.map((r) => `<tr><td>${r.when}</td><td><span class="pill ${r.type}">${r.type}</span></td><td>${esc(r.item)} <span class="code muted">${esc(r.code)}</span></td><td class="num">${r.change > 0 ? '+' : ''}${r.change}</td><td class="num">${r.after} ${esc(r.unit)}</td><td>${esc(r.who)}${r.recorded_by ? ` <span class="muted">(at ${esc(r.recorded_by)})</span>` : ''}</td><td>${esc(r.event)}</td><td>${esc(r.note)}</td></tr>`).join('')
        || '<tr><td colspan="8" class="muted">Nothing in this range.</td></tr>'}</table></div>`;
    } else {
      const co = await q(sb.from('tool_checkouts').select('*').gte('checked_out_at', start).lte('checked_out_at', end).order('checked_out_at', { ascending: false }).limit(2000));
      rows = co.map((c) => ({ out: fmtDate(c.checked_out_at), code: toolBy[c.tool_id]?.code, tool: toolBy[c.tool_id]?.name, who: who[c.borrower_id], event: evName[c.event_id] || '', returned: c.returned_at ? fmtDate(c.returned_at) : 'still out', condition: c.return_condition, notes: [c.out_note, c.return_note].filter(Boolean).join(' / ') }));
      out.innerHTML = `<div class="table-wrap"><table><tr><th>Out</th><th>Tool</th><th>Who</th><th>Event</th><th>Returned</th><th>Condition</th><th>Notes</th></tr>
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

async function renderPeople() {
  const members = await loadMembers();
  app.innerHTML = `
    ${pageHead('Team', 'People')}
    <p class="muted">Anyone with an email here can sign in (they create their own password with that email). People without an email can still use the warehouse iPad with their name label.
      <b>Kiosk</b> is for the shared iPad's login: it can check things in and out for whoever scans their name, but can't change settings.</p>
    ${isAdmin() ? `<div class="card"><form id="add" class="row">
      <label style="flex:1;min-width:160px">Name <input name="name" required></label>
      <label style="flex:1;min-width:200px">Email (for sign-in) <input name="email" type="email"></label>
      <label>Role <select name="role"><option value="member">Member</option><option value="admin">Admin</option><option value="kiosk">Kiosk (shared iPad)</option></select></label>
      <button class="btn primary">Add person</button></form></div>` : ''}
    <div class="table-wrap"><table><tr><th>Name</th><th>Label code</th><th>Email</th><th>Role</th><th></th></tr>
      ${members.map((m) => `<tr style="${m.active ? '' : 'opacity:.5'}"><td>${esc(m.name)}</td><td class="code">${esc(m.code)}</td><td>${esc(m.email)}</td><td>${isAdmin() && m.id !== state.me.id ? `<select data-role="${m.id}">${['member', 'admin', 'kiosk'].map((r) => `<option ${r === m.role ? 'selected' : ''}>${r}</option>`).join('')}</select>` : m.role}</td>
        <td>${isAdmin() && m.id !== state.me.id ? `
          <button class="btn small" data-active="${m.id}">${m.active ? 'Deactivate' : 'Reactivate'}</button>
          <button class="btn small" data-email="${m.id}">Edit email</button>` : ''}</td></tr>`).join('')}</table></div>
    <p><a class="btn" href="#/labels/people">Print name labels</a></p>`;

  const update = async (id, patch) => {
    try { await q(sb.from('team_members').update(patch).eq('id', id).select()); route(); } catch (err) { toast(errMsg(err), true); }
  };
  app.querySelectorAll('[data-role]').forEach((sel) => sel.addEventListener('change', () => update(sel.dataset.role, { role: sel.value })));
  app.querySelectorAll('[data-active]').forEach((b) => b.addEventListener('click', () => {
    const m = members.find((x) => x.id === b.dataset.active);
    update(m.id, { active: !m.active });
  }));
  app.querySelectorAll('[data-email]').forEach((b) => b.addEventListener('click', () => {
    const m = members.find((x) => x.id === b.dataset.email);
    const email = prompt(`Sign-in email for ${m.name} (leave blank for none):`, m.email || '');
    if (email !== null) update(m.id, { email: email.trim().toLowerCase() || null });
  }));
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
// Labels
// ---------------------------------------------------------------------------

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
    item: items.filter((i) => i.active).map((i) => ({ id: i.id, code: i.code, name: i.name, sub: i.location || '' })),
    tool: tools.filter((t) => t.active).map((t) => ({ id: t.id, code: t.code, name: t.name, sub: t.serial_number ? `S/N ${t.serial_number}` : '' })),
    people: people(members).map((m) => ({ id: m.id, code: m.code, name: m.name, sub: '' })),
    commands: [
      { id: 'in', code: CMD.IN, name: 'SCAN IN mode', sub: 'Scan Stock page' },
      { id: 'out', code: CMD.OUT, name: 'SCAN OUT mode', sub: 'Scan Stock page' },
      { id: 'count', code: CMD.COUNT, name: 'SET COUNT mode', sub: 'Admins only' },
      { id: 'done', code: CMD.DONE, name: 'DONE / CLEAR', sub: 'Finish a person or reset' },
    ],
  };
  const tab = sources[kind] ? kind : 'item';
  const preselect = new Set(id ? [id] : []);
  const sizeKey = getPref('labelSize', 'brother-dk1201');

  app.innerHTML = `
    ${pageHead('Print', 'Labels', 'Barcode labels for your Brother label printer.')}
    <div class="card">
      <div class="row">
        <label>What <select id="kind">
          <option value="item" ${tab === 'item' ? 'selected' : ''}>Inventory items</option>
          <option value="tool" ${tab === 'tool' ? 'selected' : ''}>Tools</option>
          <option value="people" ${tab === 'people' ? 'selected' : ''}>People (name labels)</option>
          <option value="commands" ${tab === 'commands' ? 'selected' : ''}>Command barcodes</option></select></label>
        <label>Label size <select id="size">${Object.entries(LABEL_SIZES).map(([k, s]) => `<option value="${k}" ${k === sizeKey ? 'selected' : ''}>${s.name}</option>`).join('')}</select></label>
        <label>Copies each <input id="copies" type="number" min="1" max="20" value="1" style="width:80px"></label>
        <button class="btn primary" id="print">Print selected</button>
      </div>
      <p class="scan-hint">In the print dialog, choose your label printer, set the paper to the same label size, margins to "None", and scale to 100%.</p>
    </div>
    <div class="row" style="margin-bottom:8px"><button class="btn small" id="all">Select all</button><button class="btn small" id="none">Select none</button></div>
    <div class="table-wrap"><table><tr><th></th><th>Code</th><th>Name</th></tr>
      ${sources[tab].map((r) => `<tr><td><input type="checkbox" class="pick" value="${r.id}" ${preselect.has(r.id) ? 'checked' : ''}></td><td class="code">${esc(r.code)}</td><td>${esc(r.name)}</td></tr>`).join('')
      || '<tr><td colspan="3" class="muted">Nothing here yet.</td></tr>'}</table></div>
    <h2>Preview</h2>
    <div class="label-preview" id="preview"></div>`;

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
  app.querySelector('#size').addEventListener('change', (e) => { setPref('labelSize', e.target.value); paintPreview(); });
  app.querySelectorAll('.pick').forEach((c) => c.addEventListener('change', paintPreview));
  app.querySelector('#all').addEventListener('click', () => { app.querySelectorAll('.pick').forEach((c) => (c.checked = true)); paintPreview(); });
  app.querySelector('#none').addEventListener('click', () => { app.querySelectorAll('.pick').forEach((c) => (c.checked = false)); paintPreview(); });
  app.querySelector('#print').addEventListener('click', () => {
    const rows = picked();
    if (!rows.length) return toast('Select at least one label');
    const copies = Math.min(20, Math.max(1, parseInt(app.querySelector('#copies').value, 10) || 1));
    const area = document.getElementById('print-area');
    area.innerHTML = rows.flatMap((r) => Array(copies).fill(labelHtml(r.code, r.name, r.sub))).join('');
    applySize(area);
    drawBarcodes(area, size());
    let pageStyle = document.getElementById('page-size');
    if (!pageStyle) {
      pageStyle = document.createElement('style');
      pageStyle.id = 'page-size';
      document.head.appendChild(pageStyle);
    }
    pageStyle.textContent = `@page { size: ${size().w}in ${size().h}in; margin: 0; }`;
    window.print();
  });
  paintPreview();
}

boot();

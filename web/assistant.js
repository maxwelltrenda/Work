// "Ask" helper: a chat box on every Facilities page. People type short plain
// commands ("Ready room done", "start windows and stock", "pulled to prep event
// in the family center", "what's left inside") and the app makes the change.
//
// No AI and no outside service: the words are matched by simple rules right
// here in the browser, and changes go through the person's own login, so the
// same rules apply as when they tap the buttons.

const KEY = 'mc-ask-chat';
const load = () => { try { return JSON.parse(sessionStorage.getItem(KEY) || '[]'); } catch { return []; } };
const save = (msgs) => { try { sessionStorage.setItem(KEY, JSON.stringify(msgs.slice(-30))); } catch { /* private mode */ } };

const CAN_PM = ['admin', 'fac_admin', 'maintenance'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const OUTSIDE = /outside|trash|lawn|parking|exterior|sidewalk|grounds|dumpster|landscap/i;
const STOP = new Set(['the', 'a', 'an', 'my', 'to', 'of', 'and', 'in', 'at', 'on', 'with', 'for', 'is', 'are', 'all', 'room', 'check', 'task', 'please']);

const HELP = `I understand short sentences like:
• "Chapel done" or "done with north wing"
• "Start windows and stock"
• "Pause windows" · "Skip floors"
• "Add me to laundry" · "Add Cass to windows"
• "Pulled to prep event in the family center" · "Back"
• "What's left" · "What's left inside" · "What's left today"
• "Remind me to create stock carts"
• "Request: lobby sink is leaking"`;

// ---------------------------------------------------------------- matching
const words = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
const keyWords = (s) => { const w = words(s).filter((x) => !STOP.has(x)); return w.length ? w : words(s); };
// Exact word = 1, same start ("bathroom"/"bathrooms", "exec"/"executive") = 0.8.
const same = (a, b) => (a === b ? 1 : a.length >= 4 && b.length >= 4 && (a.startsWith(b) || b.startsWith(a)) ? 0.8 : 0);
const cover = (from, to) => (from.length ? from.reduce((n, w) => n + Math.max(0, ...to.map((x) => same(w, x))), 0) / from.length : 0);

// How well a typed phrase fits a name, as a list compared in order: typed key
// words found, then all typed words found, then how much of the name is covered.
function fit(phrase, name) {
  const q = keyWords(phrase);
  const n = keyWords(name);
  if (!q.length || !n.length) return [0, 0, 0];
  return [cover(q, n), cover(words(phrase), words(name)), cover(n, q) * 0.5 + cover(words(name), words(phrase)) * 0.5];
}
const cmp = (a, b) => { for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > 1e-9) return b[i] - a[i]; return 0; };

// Best item for a phrase: { item } or { choices } or {}. prefer() breaks a tie
// (e.g. today's open task over last week's done one with the same name).
export function best(phrase, items, prefer = () => 0) {
  const scored = items.map((it) => { const f = fit(phrase, it.name); return { it, s: [f[0], f[1], prefer(it), f[2]] }; })
    .filter((x) => x.s[0] >= 0.5).sort((a, b) => cmp(a.s, b.s));
  if (!scored.length) return {};
  // Same words and same priority but different names: ask which one.
  const top = scored.filter((x) => cmp(x.s.slice(0, 3), scored[0].s.slice(0, 3)) === 0);
  if (top.length > 1 && new Set(top.map((x) => x.it.name)).size > 1) return { choices: top.slice(0, 5).map((x) => x.it) };
  return { item: scored[0].it };
}

// "stock and windows" -> ['stock', 'windows'], unless the whole thing is one name.
export function pieces(text, items) {
  const whole = best(text, items);
  // "...and continue timer" is not a task: drop it.
  const parts = text.split(/\s*(?:,|&|\band\b|\bplus\b)\s*/i).map((x) => x.trim()).filter((x) => x && !/^(continue|keep|start|restart|run)?\s*(the\s+)?(timer|clock)( going| running)?$/i.test(x));
  if (parts.length < 2) return parts.length ? parts : [text];
  if (whole.item && fit(text, whole.item.name)[0] >= 0.99) return [text];
  return parts;
}

// ---------------------------------------------------------------- parsing
const clean = (s) => s.trim().replace(/^(hey|ok|okay|so|also|and|then)\b[\s,]*/i, '').replace(/^(can you|could you|can|please|pls|plz)\s+/i, '').replace(/^(i am|i'm|im|i)\s+(?!back\b)/i, '').replace(/\s+(please|pls|plz)\b.*$/i, '').replace(/[.!?]+$/, '').trim();

// Turn one clause into a command, or null.
export function parseClause(raw) {
  const s = clean(raw);
  const low = s.toLowerCase();
  let m;
  if (!s) return null;
  if (/^(help|\?|what can (you|i) (do|say|type))/.test(low)) return { kind: 'help' };
  if ((m = low.match(/^(?:what'?s|what is|whats|what do (?:i|we) have)\s*(?:left|still to do|to do|remaining)?\s*(.*)$/)) || (m = low.match(/^(?:left|remaining)\s*(.*)$/))) {
    const r = m[1] || '';
    return { kind: 'left', scope: /inside|in ?door/.test(r) ? 'inside' : /outside|out ?door/.test(r) ? 'outside' : /today/.test(r) ? 'today' : 'all' };
  }
  if ((m = s.match(/^(?:i\s*)?(?:got\s+|been\s+|was\s+|am\s+|i'?m\s+)?pulled\s+(?:away\s+|off\s+)?(?:to|into|for|onto|over to)\s+(.+)$/i))) {
    let what = m[1].trim();
    let where = null;
    const at = what.match(/^(.+?)\s+(?:in|at)\s+(?:the\s+)?(.+)$/i);
    if (at) { what = at[1].trim(); where = at[2].trim(); }
    return { kind: 'pulled', what, where };
  }
  if (/^(i'?m\s+)?back\b|^done with (that|it|this)$|^(finished|done) (with )?(that|it)$/i.test(low)) return { kind: 'back' };
  if ((m = s.match(/^(?:remind me to|reminder:?|to-?do:?|add to my (?:list|tasks?):?|my tasks?:)\s+(.+)$/i))) return { kind: 'todo', title: m[1].trim().replace(/^./, (c) => c.toUpperCase()) };
  if ((m = s.match(/^(?:new\s+)?request:?\s+(.+)$/i))) return { kind: 'request', subject: m[1].trim().replace(/^./, (c) => c.toUpperCase()) };
  if ((m = s.match(/^add\s+(.+?)\s+(?:to|on|onto)\s+(.+)$/i))) return { kind: 'people', who: m[1].trim(), target: m[2].trim() };
  if ((m = s.match(/^(?:start(?:ing|ed)?|begin(?:ning)?|began|working on|work on|i'?m on|on to|onto|on|resume|continue)\s+(?:on\s+|with\s+)?(.+)$/i))) return { kind: 'start', target: m[1] };
  if ((m = s.match(/^(?:pause|paused|stop|stopping|stopped)\s+(?:on\s+)?(.+)$/i))) return { kind: 'pause', target: m[1] };
  if ((m = s.match(/^(?:skip|skipping|skipped)\s+(.+)$/i))) return { kind: 'skip', target: m[1] };
  if ((m = s.match(/^(?:done with|finished with|finished|finish|completed?|done)\s+(.+)$/i))) return { kind: 'done', target: m[1] };
  if ((m = s.match(/^(.+?)\s+(?:is\s+|are\s+|all\s+)?(?:done|finished|complete|completed|good)$/i))) return { kind: 'done', target: m[1] };
  return null;
}

// A message can hold several commands: "Chapel done. Start windows".
export function parseMessage(text) {
  return String(text).split(/\n|[.;!?](?:\s|$)|,\s*(?:then|and then|also)\s+|\s+then\s+/i).map(parseClause).filter(Boolean);
}

// ---------------------------------------------------------------- the panel
export function mountAssistant({ sb, esc, me, onChange }) {
  if (document.getElementById('ask-btn')) return;
  let msgs = load();
  let busy = false;

  const btn = document.createElement('button');
  btn.id = 'ask-btn';
  btn.type = 'button';
  btn.className = 'ask-btn';
  btn.setAttribute('aria-label', 'Quick update');
  btn.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="currentColor" d="M4 4h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-5 4v-4H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Zm3 6.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Zm5 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Zm5 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Z"/></svg><span>Quick update</span>';
  document.body.appendChild(btn);

  const panel = document.createElement('div');
  panel.className = 'ask-panel';
  panel.hidden = true;
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Quick update');
  panel.innerHTML = `
    <div class="ask-head"><b>Quick update</b><span class="muted">Type what you did or need.</span>
      <button type="button" class="ask-clear" title="Start over">Clear</button>
      <button type="button" class="ask-x" aria-label="Close">×</button></div>
    <div class="ask-log" aria-live="polite"></div>
    <form class="ask-form">
      <textarea rows="1" placeholder="e.g. Ready room done" aria-label="Message" enterkeyhint="send"></textarea>
      <button class="btn primary" type="submit">Send</button>
    </form>`;
  document.body.appendChild(panel);
  const log = panel.querySelector('.ask-log');
  const box = panel.querySelector('textarea');
  const form = panel.querySelector('form');

  const draw = () => {
    log.innerHTML = msgs.length ? msgs.map((m) => `<div class="ask-msg ${m.role === 'user' ? 'me' : m.err ? 'bot err' : 'bot'}">
        ${esc(m.text).replace(/\n/g, '<br>')}
        ${m.actions?.length ? `<ul class="ask-done${m.text ? '' : ' only'}">${m.actions.map((a) => `<li>✓ ${esc(a)}</li>`).join('')}</ul>` : ''}
        ${m.choices?.length ? `<div class="ask-choices">${m.choices.map((c) => `<button type="button" class="chip-btn" data-say="${esc(c.say)}">${esc(c.label)}</button>`).join('')}</div>` : ''}</div>`).join('')
      : `<p class="muted ask-empty">${esc(HELP).replace(/\n/g, '<br>')}</p>`;
    log.scrollTop = log.scrollHeight;
  };
  const open = (on) => { panel.hidden = !on; btn.classList.toggle('on', on); if (on) { draw(); setTimeout(() => box.focus(), 50); } };
  btn.addEventListener('click', () => open(panel.hidden));
  panel.querySelector('.ask-x').addEventListener('click', () => open(false));
  panel.querySelector('.ask-clear').addEventListener('click', () => { msgs = []; save(msgs); draw(); box.focus(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !panel.hidden) open(false); });
  box.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); } });
  box.addEventListener('input', () => { box.style.height = 'auto'; box.style.height = `${Math.min(box.scrollHeight, 120)}px`; });
  log.addEventListener('click', (e) => { const b = e.target.closest('[data-say]'); if (b) send(b.dataset.say); });

  // ------------------------------------------------------------ data
  const must = async (p) => { const { data, error } = await p; if (error) throw new Error(error.message); return data ?? []; };
  const todayName = () => DAYS[new Date().getDay()];

  async function loadWork() {
    const person = me();
    const week = await must(sb.rpc('start_checklist_week'));
    const [tasks, team, pulled] = await Promise.all([
      must(sb.from('checklist_tasks').select('*').eq('week_of', week).eq('archived', false).order('sort')),
      must(sb.from('team_members').select('id, name, role, active')),
      must(sb.from('pulled_work').select('*').eq('member_id', person.id).is('ended_at', null)),
    ]);
    let runs = [];
    if (CAN_PM.includes(person.role)) {
      await sb.rpc('pm_refresh');
      const [r, t] = await Promise.all([
        must(sb.from('pm_runs').select('*').eq('status', 'open')),
        must(sb.from('pm_tasks').select('id, name')),
      ]);
      const today = new Date().toISOString().slice(0, 10);
      runs = r.filter((x) => !x.period_start || x.period_start <= today).map((x) => ({ ...x, name: (t.find((k) => k.id === x.task_id) || {}).name || 'Maintenance task', pm: true }));
    }
    return { week, tasks, runs, pulled, team: team.filter((m) => m.active && !['kiosk', 'none'].includes(m.role)) };
  }

  const whoList = (t) => String(t.who || '').split(',').map((x) => x.trim()).filter(Boolean);
  const findPerson = (team, said) => {
    const s = said.toLowerCase().trim();
    if (['me', 'myself', 'i'].includes(s)) return me();
    return team.find((m) => m.name.toLowerCase() === s) || team.find((m) => m.name.toLowerCase().split(' ')[0] === s) || team.find((m) => m.name.toLowerCase().startsWith(s));
  };
  // Tie-breaker: today's open tasks first, then anything today, then other open ones.
  const openFirst = (t) => { const open = !['Done', 'Skipped', 'Missed'].includes(t.status); return t.day === todayName() ? (open ? 3 : 2) : open ? 1 : 0; };

  // Run one command. Returns { lines, actions, choices }.
  async function run(cmd, work) {
    const out = { lines: [], actions: [], choices: [] };
    const person = me();
    const verb = { start: 'Start', pause: 'Pause', skip: 'Skip', done: 'Done with' };

    if (cmd.kind === 'help') { out.lines.push(HELP); return out; }

    if (cmd.kind === 'left') {
      let left = work.tasks.filter((t) => !['Done', 'Skipped', 'Missed'].includes(t.status));
      if (cmd.scope === 'inside') left = left.filter((t) => !OUTSIDE.test(t.name));
      if (cmd.scope === 'outside') left = left.filter((t) => OUTSIDE.test(t.name));
      if (cmd.scope === 'today') left = left.filter((t) => t.day === todayName());
      const label = { inside: 'inside', outside: 'outside', today: 'today', all: 'this week' }[cmd.scope];
      if (!left.length) out.lines.push(`Nothing left ${label}. Nice work.`);
      else {
        const byDay = {};
        left.forEach((t) => { (byDay[t.day || 'Any day'] ||= []).push(t); });
        out.lines.push(`Left ${label} (${left.length}):`);
        Object.entries(byDay).forEach(([d, ts]) => out.lines.push(`${d}: ${ts.map((t) => t.name + (t.status === 'Working on it' ? ' (in progress)' : '')).join(', ')}`));
      }
      if (cmd.scope === 'all' || cmd.scope === 'today') {
        const due = work.runs.filter((r) => !r.parent_id);
        if (due.length) out.lines.push(`Maintenance open: ${due.map((r) => r.name).join(', ')}`);
      }
      return out;
    }

    if (cmd.kind === 'pulled') {
      await must(sb.rpc('pulled_start', { p_dept: person.role === 'maintenance' ? 'maintenance' : 'custodial', p_what: cmd.what, p_location: cmd.where }));
      out.actions.push(`Pulled to ${cmd.what}${cmd.where ? ` · ${cmd.where}` : ''}`);
      return out;
    }

    if (cmd.kind === 'back') {
      if (!work.pulled.length) { out.lines.push("You weren't pulled to anything."); return out; }
      for (const p of work.pulled) await must(sb.rpc('pulled_end', { p_id: p.id, p_note: null }));
      out.actions.push(`Back from ${work.pulled.map((p) => p.what).join(', ')}`);
      return out;
    }

    if (cmd.kind === 'todo') {
      await must(sb.from('personal_tasks').insert({ member_id: person.id, title: cmd.title }).select('id'));
      out.actions.push(`Added to My tasks: ${cmd.title}`);
      return out;
    }

    if (cmd.kind === 'request') {
      await must(sb.from('maint_requests').insert({ subject: cmd.subject, requester_name: person.name, experts: ['Maxwell Trenda'] }).select('id'));
      out.actions.push(`New request: ${cmd.subject}`);
      return out;
    }

    if (cmd.kind === 'people') {
      const names = cmd.who.split(/\s*(?:,|&|\band\b)\s*/i).filter(Boolean);
      const people = names.map((n) => findPerson(work.team, n));
      const missing = names.filter((n, i) => !people[i]);
      if (missing.length) { out.lines.push(`I don't know who "${missing.join(', ')}" is.`); return out; }
      for (const part of pieces(cmd.target, work.tasks)) {
        const hit = best(part, work.tasks, openFirst);
        if (hit.choices) { out.lines.push(`Which "${part}"?`); out.choices.push(...hit.choices.map((t) => ({ label: t.name, say: `add ${cmd.who} to ${t.name}` }))); continue; }
        if (!hit.item) { out.lines.push(`I couldn't find "${part}" on this week's list.`); continue; }
        const t = hit.item;
        const now = [...new Set([...whoList(t), ...people.map((p) => p.name)])];
        await must(sb.from('checklist_tasks').update({ who: now.join(', ') }).eq('id', t.id).select('id'));
        t.who = now.join(', ');
        out.actions.push(`On ${t.name}: ${now.join(', ')}`);
      }
      return out;
    }

    // start / pause / skip / done: custodial tasks, or maintenance for done/skip.
    const pool = ['done', 'skip'].includes(cmd.kind) ? [...work.tasks, ...work.runs] : work.tasks;
    for (const part of pieces(cmd.target, pool)) {
      const hit = best(part, pool, openFirst);
      if (hit.choices) { out.lines.push(`Which "${part}"?`); out.choices.push(...hit.choices.map((t) => ({ label: t.name, say: `${verb[cmd.kind]} ${t.name}` }))); continue; }
      if (!hit.item) { out.lines.push(`I couldn't find "${part}" on this week's list.`); continue; }
      const t = hit.item;
      if (t.pm) {
        await must(sb.rpc('pm_mark', { p_run: t.id, p_status: cmd.kind === 'done' ? 'done' : 'skipped', p_note: null }));
        out.actions.push(`${cmd.kind === 'done' ? 'Done' : 'Skipped'}: ${t.name}`);
        continue;
      }
      if (cmd.kind === 'pause') {
        if (!t.timer_started_at) { out.lines.push(`${t.name} isn't running.`); continue; }
        await must(sb.rpc('checklist_timer', { p_id: t.id, p_run: false }));
        out.actions.push(`Paused ${t.name}`);
        continue;
      }
      const status = { start: 'Working on it', done: 'Done', skip: 'Skipped' }[cmd.kind];
      if (cmd.kind === 'start' && t.status === 'Working on it') {
        if (!t.timer_started_at) await must(sb.rpc('checklist_timer', { p_id: t.id, p_run: true }));
        out.actions.push(t.timer_started_at ? `${t.name} is already running` : `Timer back on: ${t.name}`);
        continue;
      }
      if (t.status === status) { out.lines.push(`${t.name} is already ${status === 'Done' ? 'done' : status.toLowerCase()}.`); continue; }
      const patch = { status };
      // Starting or finishing a task puts you on it, next to anyone already on it.
      if (cmd.kind !== 'skip' && !whoList(t).includes(person.name)) patch.who = [...whoList(t), person.name].join(', ');
      await must(sb.from('checklist_tasks').update(patch).eq('id', t.id).select('id'));
      Object.assign(t, patch);
      out.actions.push(`${{ start: 'Started', done: 'Done', skip: 'Skipped' }[cmd.kind]}: ${t.name}${patch.who ? ` (${patch.who})` : ''}`);
    }
    return out;
  }

  async function reply(text) {
    const cmds = parseMessage(text);
    if (!cmds.length) return { text: `Sorry, I didn't get that.\n${HELP}`, err: true };
    const work = await loadWork();
    const all = { lines: [], actions: [], choices: [] };
    for (const c of cmds) {
      try {
        const r = await run(c, work);
        all.lines.push(...r.lines); all.actions.push(...r.actions); all.choices.push(...r.choices);
      } catch (e) { all.lines.push(e.message || 'That did not work.'); }
    }
    return { text: all.lines.join('\n') || (all.actions.length ? '' : 'OK.'), actions: all.actions, choices: all.choices };
  }

  async function send(text) {
    if (!text || busy) return;
    msgs.push({ role: 'user', text });
    busy = true;
    draw();
    try {
      const r = await reply(text);
      msgs.push({ role: 'bot', text: r.text, actions: r.actions || [], choices: r.choices || [], err: !!r.err });
      if (r.actions?.length) onChange?.();
    } catch (err) {
      msgs.push({ role: 'bot', text: err.message || 'Something went wrong. Try again.', err: true });
    }
    busy = false;
    save(msgs);
    draw();
    box.focus();
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = box.value.trim();
    box.value = '';
    box.style.height = '';
    send(text);
  });
}

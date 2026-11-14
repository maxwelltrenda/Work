// "Ask" helper: a chat button on every Facilities page. People type what they
// did or need ("Ready room done", "got pulled to the Family Center", "what's
// left inside") and the helper (supabase/functions/assistant) makes the change.
// The chat is kept for this browser tab only.

const KEY = 'mc-ask-chat';
const load = () => { try { return JSON.parse(sessionStorage.getItem(KEY) || '[]'); } catch { return []; } };
const save = (msgs) => { try { sessionStorage.setItem(KEY, JSON.stringify(msgs.slice(-30))); } catch { /* private mode */ } };

export function mountAssistant({ sb, esc, demo, onChange }) {
  if (document.getElementById('ask-btn')) return;
  let msgs = load();
  let busy = false;

  const btn = document.createElement('button');
  btn.id = 'ask-btn';
  btn.type = 'button';
  btn.className = 'ask-btn';
  btn.setAttribute('aria-label', 'Ask the helper');
  btn.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="currentColor" d="M4 4h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-5 4v-4H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Zm3 6.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Zm5 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Zm5 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Z"/></svg><span>Ask</span>';
  document.body.appendChild(btn);

  const panel = document.createElement('div');
  panel.className = 'ask-panel';
  panel.hidden = true;
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Helper');
  panel.innerHTML = `
    <div class="ask-head"><b>Helper</b><span class="muted">Tell it what you did or need.</span>
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
        ${m.actions?.length ? `<ul class="ask-done">${m.actions.map((a) => `<li>✓ ${esc(a)}</li>`).join('')}</ul>` : ''}</div>`).join('')
      : `<p class="muted ask-empty">Type what you did, what you're starting, or what you need. Like:<br>“Chapel is done”<br>“Start windows and stock”<br>“Got pulled to set up the Family Center”<br>“What's left inside?”</p>`;
    if (busy) log.insertAdjacentHTML('beforeend', '<div class="ask-msg bot typing"><span></span><span></span><span></span></div>');
    log.scrollTop = log.scrollHeight;
  };
  const open = (on) => { panel.hidden = !on; btn.classList.toggle('on', on); if (on) { draw(); setTimeout(() => box.focus(), 50); } };
  btn.addEventListener('click', () => open(panel.hidden));
  panel.querySelector('.ask-x').addEventListener('click', () => open(false));
  panel.querySelector('.ask-clear').addEventListener('click', () => { msgs = []; save(msgs); draw(); box.focus(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !panel.hidden) open(false); });
  box.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); } });
  box.addEventListener('input', () => { box.style.height = 'auto'; box.style.height = `${Math.min(box.scrollHeight, 120)}px`; });

  async function ask() {
    if (demo) return { reply: "The helper can't make changes in the demo. In the real app it updates the checklist, maintenance, and your to-do list for you." };
    const { data, error } = await sb.functions.invoke('assistant', { body: { messages: msgs.filter((m) => !m.err).map((m) => ({ role: m.role, text: m.text })) } });
    if (error) {
      let msg = error.message;
      try { const j = await error.context.json(); msg = j.error || msg; if (j.actions?.length) return { reply: msg, actions: j.actions, err: true }; } catch { /* not JSON */ }
      throw new Error(msg);
    }
    return data;
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = box.value.trim();
    if (!text || busy) return;
    msgs.push({ role: 'user', text });
    box.value = '';
    box.style.height = '';
    busy = true;
    draw();
    try {
      const r = await ask();
      msgs.push({ role: 'assistant', text: r.reply || 'OK.', actions: r.actions || [], err: !!r.err });
      if (r.actions?.length) onChange?.();
    } catch (err) {
      msgs.push({ role: 'assistant', text: err.message || 'Something went wrong. Try again.', err: true });
    }
    busy = false;
    save(msgs);
    draw();
    box.focus();
  });
}

// The in-app helper ("Ask"): people type what they did or need in plain words
// ("Ready room done", "got pulled to the Family Center", "what's left inside")
// and Claude makes the changes for them.
//
// It runs as the signed-in person: every change goes through the database with
// their login, so the same rules apply as in the app (who can change what, who
// gets credit, done alerts). The Claude key is the ANTHROPIC_API_KEY secret.
import Anthropic from 'npm:@anthropic-ai/sdk@1.6.0';
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.58.0';

const MODEL = 'claude-opus-5-5';
const TZ = 'America/Chicago';
const CAN_USE = ['admin', 'fac_admin', 'member', 'maintenance', 'custodian'];
const CAN_PM = ['admin', 'fac_admin', 'maintenance'];
const ADMINS = ['admin', 'fac_admin'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

const anthropic = new Anthropic();

type Me = { id: string; name: string; role: string };
type Ctx = { sb: SupabaseClient; me: Me; today: string; weekday: string; week: string; actions: string[] };

// Today's date in Central time, and the Sunday the checklist week starts on.
function clock() {
  const now = new Date();
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'long' })
    .formatToParts(now).map((p) => [p.type, p.value]));
  const today = `${parts.year}-${parts.month}-${parts.day}`;
  const dow = DAYS.indexOf(parts.weekday);
  const d = new Date(`${today}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - dow);
  const time = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' }).format(now);
  return { today, weekday: parts.weekday, week: d.toISOString().slice(0, 10), time };
}

async function must<T>(p: PromiseLike<{ data: T; error: { message: string } | null }>): Promise<NonNullable<T>> {
  const { data, error } = await p;
  if (error) throw new Error(error.message);
  return (data ?? []) as NonNullable<T>;
}

const TOOLS: Anthropic.Beta.BetaTool[] = [
  {
    name: 'look_up_work',
    description: "Get this week's custodial checklist, open maintenance rounds, the person's own to-do list, whether they are pulled to something, and the team's names. Call this before changing anything so you use real ids and names.",
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'update_custodial_task',
    description: "Change one task on this week's custodial checklist. start = they are working on it now (runs its timer). pause = stop the timer but leave it in progress. done = finished. skip = not doing it this week. reset = back to not started. Optionally set who is on it.",
    input_schema: {
      type: 'object',
      properties: {
        task_id: { type: 'integer', description: 'Task id from look_up_work.' },
        action: { type: 'string', enum: ['start', 'pause', 'done', 'skip', 'reset', 'people_only'] },
        people: { type: 'array', items: { type: 'string' }, description: 'Full list of full names on this task after the change. To add someone, include the people already on it. Leave out to keep it as is.' },
      },
      required: ['task_id', 'action'],
      additionalProperties: false,
    },
  },
  {
    name: 'add_custodial_task',
    description: "Add a one-off task to this week's custodial checklist (this week only).",
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        day: { type: 'string', enum: [...DAYS, 'Detail Work'], description: 'Day it shows on. Default: today.' },
        people: { type: 'array', items: { type: 'string' }, description: 'Full names on it.' },
        steps: { type: 'array', items: { type: 'string' } },
      },
      required: ['name'],
      additionalProperties: false,
    },
  },
  {
    name: 'pulled_to',
    description: "Log that the person got pulled off the plan to something else (unplanned work). Ends any earlier one. Use back_from_pulled when they're done with it.",
    input_schema: {
      type: 'object',
      properties: {
        what: { type: 'string', description: 'What they got pulled to, short.' },
        location: { type: 'string' },
        dept: { type: 'string', enum: ['custodial', 'maintenance'] },
      },
      required: ['what', 'dept'],
      additionalProperties: false,
    },
  },
  {
    name: 'back_from_pulled',
    description: 'End what the person was pulled to (they are back on their plan).',
    input_schema: { type: 'object', properties: { note: { type: 'string' } }, additionalProperties: false },
  },
  {
    name: 'mark_maintenance',
    description: 'Check off a maintenance schedule round: done, skipped, or back to open.',
    input_schema: {
      type: 'object',
      properties: {
        run_id: { type: 'integer', description: 'Round id from look_up_work.' },
        status: { type: 'string', enum: ['done', 'skipped', 'open'] },
        note: { type: 'string' },
      },
      required: ['run_id', 'status'],
      additionalProperties: false,
    },
  },
  {
    name: 'add_my_task',
    description: "Add a to-do to a personal task list. By default the person's own list. Admins can add to someone else's list by name.",
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        due_on: { type: 'string', description: 'YYYY-MM-DD, optional.' },
        notes: { type: 'string' },
        for_person: { type: 'string', description: 'Full name, only when adding to someone else (admins only).' },
      },
      required: ['title'],
      additionalProperties: false,
    },
  },
  {
    name: 'finish_my_task',
    description: 'Mark a personal to-do done.',
    input_schema: { type: 'object', properties: { task_id: { type: 'integer' } }, required: ['task_id'], additionalProperties: false },
  },
  {
    name: 'new_request',
    description: 'Put in a new maintenance/facilities request (something broken or needed).',
    input_schema: {
      type: 'object',
      properties: { subject: { type: 'string' }, location: { type: 'string' }, details: { type: 'string' } },
      required: ['subject'],
      additionalProperties: false,
    },
  },
];

// deno-lint-ignore no-explicit-any
type Input = Record<string, any>;
const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);

async function teamNames(c: Ctx) {
  const rows = await must(c.sb.from('team_members').select('id, name, role, active'));
  return (rows || []).filter((m: Input) => m.active && !['kiosk', 'none'].includes(m.role));
}

async function weekTask(c: Ctx, id: number) {
  const rows = await must(c.sb.from('checklist_tasks').select('*').eq('id', id).eq('week_of', c.week));
  if (!rows?.length) throw new Error(`No task ${id} on this week's checklist`);
  return rows[0] as Input;
}

const TOOL_FNS: Record<string, (c: Ctx, a: Input) => Promise<unknown>> = {
  async look_up_work(c) {
    await c.sb.rpc('start_checklist_week');
    const [tasks, mine, pulled, team] = await Promise.all([
      must(c.sb.from('checklist_tasks').select('id, name, area, day, status, who, timer_started_at').eq('week_of', c.week).eq('archived', false).order('sort')),
      must(c.sb.from('personal_tasks').select('id, title, due_on, notes').eq('member_id', c.me.id).is('done_at', null)).catch(() => []),
      must(c.sb.from('pulled_work').select('id, dept, what, location, started_at').eq('member_id', c.me.id).is('ended_at', null)),
      teamNames(c),
    ]);
    let maintenance: unknown = 'Not available for this person.';
    if (CAN_PM.includes(c.me.role)) {
      await c.sb.rpc('pm_refresh');
      const [runs, pm] = await Promise.all([
        must(c.sb.from('pm_runs').select('id, task_id, due_on, period_start, status').eq('status', 'open').lte('period_start', c.today)),
        must(c.sb.from('pm_tasks').select('id, name, location')),
      ]);
      const byId = new Map((pm || []).map((t: Input) => [t.id, t]));
      maintenance = (runs || []).map((r: Input) => ({ run_id: r.id, task: byId.get(r.task_id)?.name, where: byId.get(r.task_id)?.location, due: r.due_on }));
    }
    return {
      custodial_this_week: (tasks || []).map((t: Input) => ({
        id: t.id, name: t.name, area: t.area, day: t.day, status: t.status, who: t.who,
        timer: t.timer_started_at ? 'running' : undefined,
      })),
      maintenance_open: maintenance,
      my_todo: mine,
      pulled_to_now: pulled,
      team: team.map((m: Input) => m.name),
    };
  },

  async update_custodial_task(c, a) {
    const t = await weekTask(c, Number(a.task_id));
    const patch: Input = {};
    if (Array.isArray(a.people)) patch.who = a.people.map(String).filter(Boolean).join(', ') || null;
    const status = { start: 'Working on it', done: 'Done', skip: 'Skipped', reset: 'Not started' }[a.action as string];
    if (status && status !== t.status) patch.status = status;
    if (Object.keys(patch).length) await must(c.sb.from('checklist_tasks').update(patch).eq('id', t.id).select('id'));
    // Already in progress but paused: start the clock again. Pause: stop it.
    if (a.action === 'start' && t.status === 'Working on it' && !t.timer_started_at) await must(c.sb.rpc('checklist_timer', { p_id: t.id, p_run: true }));
    if (a.action === 'pause') await must(c.sb.rpc('checklist_timer', { p_id: t.id, p_run: false }));
    const said = { start: 'Started', pause: 'Paused', done: 'Done:', skip: 'Skipped', reset: 'Reset', people_only: 'People on' }[a.action as string] || 'Updated';
    c.actions.push(`${said} ${t.name}${patch.who !== undefined && a.action !== 'people_only' ? ` (${patch.who || 'nobody'})` : a.action === 'people_only' ? `: ${patch.who || 'nobody'}` : ''}`);
    return { ok: true, task: t.name };
  },

  async add_custodial_task(c, a) {
    const name = str(a.name);
    if (!name) throw new Error('Give the task a name');
    const day = DAYS.includes(a.day) || a.day === 'Detail Work' ? a.day : c.weekday;
    const rows = await must(c.sb.from('checklist_tasks').select('sort').eq('week_of', c.week));
    const sort = Math.max(0, ...(rows || []).map((r: Input) => r.sort || 0)) + 1;
    const people = Array.isArray(a.people) ? a.people.map(String).filter(Boolean) : [];
    const [row] = await must(c.sb.from('checklist_tasks').insert({
      week_of: c.week, name, day, area: 'Building', status: 'Not started', includes: 'This week only',
      who: people.length ? people.join(', ') : null, sort,
    }).select('id'));
    const steps = Array.isArray(a.steps) ? a.steps.map(String).filter(Boolean) : [];
    if (steps.length) await must(c.sb.from('checklist_subtasks').insert(steps.map((s: string, i: number) => ({ task_id: row.id, name: s, sort: i }))).select('id'));
    c.actions.push(`Added ${name} (${day})`);
    return { ok: true, task_id: row.id };
  },

  async pulled_to(c, a) {
    const what = str(a.what);
    if (!what) throw new Error('Say what they got pulled to');
    await must(c.sb.rpc('pulled_start', { p_dept: a.dept === 'maintenance' ? 'maintenance' : 'custodial', p_what: what, p_location: str(a.location) }));
    c.actions.push(`Pulled to ${what}${str(a.location) ? ` · ${str(a.location)}` : ''}`);
    return { ok: true };
  },

  async back_from_pulled(c, a) {
    const open = await must(c.sb.from('pulled_work').select('id, what').eq('member_id', c.me.id).is('ended_at', null));
    if (!open?.length) return { ok: true, note: 'They were not pulled to anything.' };
    for (const p of open) await must(c.sb.rpc('pulled_end', { p_id: p.id, p_note: str(a.note) }));
    c.actions.push(`Back from ${open.map((p: Input) => p.what).join(', ')}`);
    return { ok: true };
  },

  async mark_maintenance(c, a) {
    if (!CAN_PM.includes(c.me.role)) throw new Error('Only maintenance and admins can check off the schedule');
    const [run] = await must(c.sb.from('pm_runs').select('id, task_id').eq('id', Number(a.run_id)));
    if (!run) throw new Error(`No maintenance round ${a.run_id}`);
    const [task] = await must(c.sb.from('pm_tasks').select('name').eq('id', run.task_id));
    await must(c.sb.rpc('pm_mark', { p_run: run.id, p_status: a.status, p_note: str(a.note) }));
    c.actions.push(`${{ done: 'Done:', skipped: 'Skipped', open: 'Reopened' }[a.status as string]} ${task?.name || 'maintenance task'}`);
    return { ok: true };
  },

  async add_my_task(c, a) {
    const title = str(a.title);
    if (!title) throw new Error('Give the to-do a title');
    let member = c.me;
    const other = str(a.for_person);
    if (other && other.toLowerCase() !== c.me.name.toLowerCase()) {
      if (!ADMINS.includes(c.me.role)) throw new Error("Only admins can add to someone else's list");
      const team = await teamNames(c);
      const hit = team.filter((m: Input) => m.name.toLowerCase() === other.toLowerCase())[0]
        || team.filter((m: Input) => m.name.toLowerCase().startsWith(other.toLowerCase()))[0];
      if (!hit) throw new Error(`No one on the team named ${other}`);
      member = hit as Me;
    }
    const due = /^\d{4}-\d{2}-\d{2}$/.test(a.due_on || '') ? a.due_on : null;
    await must(c.sb.from('personal_tasks').insert({ member_id: member.id, title, due_on: due, notes: str(a.notes) }).select('id'));
    c.actions.push(`To-do${member.id === c.me.id ? '' : ` for ${member.name.split(' ')[0]}`}: ${title}`);
    return { ok: true };
  },

  async finish_my_task(c, a) {
    const rows = await must(c.sb.from('personal_tasks').update({ done_at: new Date().toISOString() }).eq('id', Number(a.task_id)).select('title'));
    if (!rows?.length) throw new Error('That to-do was not found');
    c.actions.push(`Done: ${rows[0].title}`);
    return { ok: true };
  },

  async new_request(c, a) {
    const subject = str(a.subject);
    if (!subject) throw new Error('Say what the request is');
    const [row] = await must(c.sb.from('maint_requests').insert({
      subject, location: str(a.location), details: str(a.details), requester_name: c.me.name, experts: ['Maxwell Trenda'],
    }).select('id'));
    c.actions.push(`New request: ${subject}`);
    return { ok: true, request_id: row.id };
  },
};

function systemPrompt(c: Ctx, time: string) {
  return `You are the helper inside the Mercy Culture Facilities app. The facilities team (custodial and maintenance) types what they did or need, often short and on a phone, and you make the change for them.

How to work:
- Call look_up_work first, then make the changes. Match what they say to the real task names (e.g. "central chairs" = "MC Central"; "stock and windows" = two tasks).
- Do clear requests right away; don't ask to confirm. "X done" = mark it done. "Start X" / "begin X" / "I'm on X" = start it. "Add me to X" = add their name to the people on it, keeping the others.
- Only ask a short question when you truly can't tell which task they mean.
- "Got pulled to ..." = pulled_to (custodial unless they're maintenance). "Back" / "done with that" after being pulled = back_from_pulled.
- "What's left" = list the tasks not done yet, grouped simply. "Inside" means area Building/Offices; outside tasks have names like Outside, Trash, Lawn, Parking.
- Questions only need look_up_work, no changes.

Write very simply. Short words, short sentences. One to three lines. No headings, no tables. Say what you changed, plainly.

The person: ${c.me.name} (role: ${c.me.role}). Today is ${c.weekday}, ${c.today}, ${time} Central time. This checklist week started Sunday ${c.week}.`;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  const auth = req.headers.get('Authorization') || '';
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } } });
  const { data: userData } = await sb.auth.getUser(auth.replace(/^Bearer\s+/i, ''));
  const email = userData?.user?.email?.toLowerCase();
  if (!email) return json({ error: 'Please sign in again.' }, 401);
  const { data: rows } = await sb.from('team_members').select('id, name, role').eq('email', email).eq('active', true);
  const me = rows?.[0] as Me | undefined;
  if (!me || !CAN_USE.includes(me.role)) return json({ error: 'The helper is for the Facilities team.' }, 403);
  if (!Deno.env.get('ANTHROPIC_API_KEY')) return json({ error: 'The helper is not switched on yet (no Claude key).' }, 503);

  let body: { messages?: { role: string; text: string }[] };
  try { body = await req.json(); } catch { return json({ error: 'Bad request' }, 400); }
  // The chat so far, as plain text. Keep the last few turns; it must start with the person.
  const history = (body.messages || [])
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.text === 'string' && m.text.trim())
    .slice(-12)
    .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.text.slice(0, 2000) }));
  while (history.length && history[0].role !== 'user') history.shift();
  if (!history.length || history[history.length - 1].role !== 'user') return json({ error: 'Type something first.' }, 400);

  const { today, weekday, week, time } = clock();
  const c: Ctx = { sb, me, today, weekday, week, actions: [] };
  const messages: Anthropic.Beta.BetaMessageParam[] = history;

  try {
    for (let turn = 0; turn < 10; turn++) {
      const res = await anthropic.beta.messages.create({
        model: MODEL,
        max_tokens: 16000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        output_config: { effort: 'low' },
        system: systemPrompt(c, time),
        tools: TOOLS,
        messages,
      });
      if (res.stop_reason === 'refusal') return json({ reply: "Sorry, I can't help with that one.", actions: c.actions });
      if (res.stop_reason === 'pause_turn') { messages.push({ role: 'assistant', content: res.content }); continue; }
      const uses = res.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use');
      if (res.stop_reason !== 'tool_use' || !uses.length) {
        const reply = res.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text').map((b) => b.text).join('\n').trim();
        return json({ reply: reply || (c.actions.length ? 'Done.' : 'OK.'), actions: c.actions });
      }
      messages.push({ role: 'assistant', content: res.content });
      const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
      for (const u of uses) {
        const fn = TOOL_FNS[u.name];
        try {
          if (!fn) throw new Error(`Unknown tool ${u.name}`);
          const out = await fn(c, (u.input || {}) as Input);
          results.push({ type: 'tool_result', tool_use_id: u.id, content: JSON.stringify(out) });
        } catch (e) {
          results.push({ type: 'tool_result', tool_use_id: u.id, content: (e as Error).message, is_error: true });
        }
      }
      messages.push({ role: 'user', content: results });
    }
    return json({ reply: 'That took too many steps. Try one thing at a time.', actions: c.actions });
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) return json({ error: 'The helper is busy. Try again in a minute.', actions: c.actions }, 429);
    if (e instanceof Anthropic.APIError) return json({ error: `The helper had a problem (${e.status ?? 'network'}).`, actions: c.actions }, 502);
    return json({ error: (e as Error).message, actions: c.actions }, 500);
  }
});

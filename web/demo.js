// Demo mode (?demo): the real Facilities app with sample data and no login.
// It never talks to the real database. Everything lives in this browser tab
// and resets on reload. A small stand-in for the Supabase client: tables,
// the filters the app uses, and the database functions (RPCs) it calls.

const pad = (n) => String(n).padStart(2, '0');
const isoOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (iso, n) => { const [y, m, d] = iso.split('-').map(Number); return isoOf(new Date(y, m - 1, d + n)); };
const TODAY = isoOf(new Date());
const nowIso = () => new Date().toISOString();
const ago = (min) => new Date(Date.now() - min * 60000).toISOString();
const dayIso = (n) => addDays(TODAY, n);
const SUNDAY = addDays(TODAY, -new Date().getDay());
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const TODAY_NAME = DAYS[new Date().getDay()];
let seq = 1000;
const nextId = () => ++seq;
const uuid = () => `demo-${Math.random().toString(36).slice(2, 10)}`;

// ---------------------------------------------------------------- sample data
const WK = { start: '07:00', end: '15:30' };
const hours = (days, s, e) => Object.fromEntries(days.map((d) => [d, { start: s, end: e }]));
const MF = ['mon', 'tue', 'wed', 'thu', 'fri'];
const people = [
  ['me', 'Skyler', 'fac_admin', 'Leadership', null],
  ['max', 'Max', 'fac_admin', 'Maintenance', hours(MF, '07:00', '15:30')],
  ['rick', 'Rick', 'maintenance', 'Maintenance', hours(MF, '07:00', '15:30')],
  ['kenny', 'Kenny', 'maintenance', 'Maintenance', hours(MF, '08:00', '16:30')],
  ['judah', 'Judah', 'maintenance', 'Maintenance', hours(MF, '07:30', '16:00')],
  ['aaron', 'Aaron', 'maintenance', 'Grounds', hours(MF, '06:00', '14:30')],
  ['marah', 'Marah', 'custodian', 'Custodial', hours(['tue', 'wed', 'thu', 'fri', 'sat'], '09:00', '17:30')],
  ['lexi', 'Lexi', 'custodian', 'Custodial', hours(MF, '09:00', '17:30')],
  ['ipad', 'Tool room iPad', 'kiosk', null, null],
];
const db = {
  team_members: people.map(([id, name, role, team, wh], i) => ({ id, name, email: `${id}@demo.local`, code: `P-${101 + i}`, role, team, work_hours: wh, active: true, media_role: null, events_role: null, notif_seen_at: ago(60 * 24), created_at: ago(60 * 24 * 90) })),
  locations: ['Tool room', 'Mechanical room', 'Janitor closet', 'Warehouse', 'Trailer'].map((name) => ({ name, active: true })),
  categories: [['tool', 'Power tools'], ['tool', 'Ladders & lifts'], ['tool', 'Hand tools'], ['tool', 'Cleaning equipment'], ['maintenance', 'Plumbing'], ['maintenance', 'Electrical'], ['maintenance', 'HVAC'], ['maintenance', 'Hardware']]
    .map(([kind, name]) => ({ kind, name, active: true })),
  items: [], item_transactions: [], paint_cans: [], tools: [], tool_checkouts: [], notifications: [],
  maint_requests: [], maint_subtasks: [], maint_updates: [], maint_time: [],
  checklist_tasks: [], checklist_subtasks: [], checklist_time: [],
  pm_tasks: [], pm_runs: [], pulled_work: [], time_off: [], contractors: [], weekend_gameplan: [],
  events: [], event_crew: [], gear_reservations: [], push_subscriptions: [],
};
const ME = 'me';
const nameOf = (id) => db.team_members.find((m) => m.id === id)?.name || 'Someone';

// Stock
[
  ['INV-0001', 'Trash bags 55 gal', 'facilities', 'Janitor closet', 'case', 6, 4, 1, null],
  ['INV-0002', 'Paper towels (roll)', 'facilities', 'Janitor closet', 'ea', 18, 24, 12, null],
  ['INV-0003', 'Toilet paper', 'facilities', 'Janitor closet', 'ea', 140, 96, 96, null],
  ['INV-0004', 'Hand soap refill', 'facilities', 'Janitor closet', 'ea', 9, 6, 1, null],
  ['INV-0005', 'Glass cleaner', 'facilities', 'Janitor closet', 'ea', 3, 4, 1, null],
  ['INV-0006', 'Floor cleaner (gal)', 'facilities', 'Janitor closet', 'gal', 5, 2, 1, null],
  ['INV-0007', 'AC filters 20x25x1', 'maintenance', 'Mechanical room', 'ea', 8, 24, 12, 'HVAC'],
  ['INV-0008', 'LED bulbs A19', 'maintenance', 'Warehouse', 'ea', 36, 20, 12, 'Electrical'],
  ['INV-0009', 'Toilet flapper', 'maintenance', 'Warehouse', 'ea', 4, 3, 1, 'Plumbing'],
  ['INV-0010', 'Outlet covers (black)', 'maintenance', 'Warehouse', 'ea', 2, 10, 10, 'Electrical'],
  ['INV-0011', 'Door hinges', 'maintenance', 'Warehouse', 'ea', 14, 6, 1, 'Hardware'],
  ['INV-0012', 'SW Agreeable Gray (walls)', 'paint', 'Warehouse', 'gal', 6, 2, 1, null],
  ['INV-0013', 'SW Extra White (trim)', 'paint', 'Warehouse', 'gal', 3, 2, 1, null],
].forEach(([code, name, category, location, unit, quantity, reorder_level, pack_size, subcategory]) => db.items.push({
  id: uuid(), code, name, category, location, unit, quantity, reorder_level, pack_size, subcategory, description: null, unit_cost: null, active: true, photo_path: null, created_at: ago(60 * 24 * 60),
}));
db.items.filter((i) => i.category === 'paint').forEach((i) => { db.paint_cans.push({ id: nextId(), item_id: i.id, size: 1, fill: 1, added_at: ago(9000), removed_at: null }, { id: nextId(), item_id: i.id, size: 5, fill: 0.5, added_at: ago(9000), removed_at: null }); });
[['INV-0002', 'out', -6, 'lexi', 200], ['INV-0007', 'out', -8, 'rick', 60 * 26], ['INV-0003', 'in', 96, 'max', 60 * 50], ['INV-0010', 'out', -4, 'judah', 60 * 3]].forEach(([code, type, qty, who, min]) => {
  const it = db.items.find((x) => x.code === code);
  db.item_transactions.push({ id: nextId(), item_id: it.id, type, qty, qty_after: it.quantity, note: null, member_id: who, recorded_by: who, created_at: ago(min) });
});

// Tools
[
  ['TL-0001', 'Scissor lift', 'Ladders & lifts', 'Warehouse', 1], ['TL-0002', '12 ft ladder', 'Ladders & lifts', 'Tool room', 2],
  ['TL-0003', '6 ft ladder', 'Ladders & lifts', 'Tool room', 3], ['TL-0004', 'DeWalt drill kit', 'Power tools', 'Tool room', 3],
  ['TL-0005', 'Impact driver', 'Power tools', 'Tool room', 2], ['TL-0006', 'Shop vac', 'Cleaning equipment', 'Tool room', 2],
  ['TL-0007', 'Carpet extractor', 'Cleaning equipment', 'Janitor closet', 1], ['TL-0008', 'Pressure washer', 'Cleaning equipment', 'Trailer', 1],
  ['TL-0009', 'Leaf blower', 'Power tools', 'Trailer', 2], ['TL-0010', 'Socket set', 'Hand tools', 'Tool room', 1],
  ['TL-0011', 'Multimeter', 'Hand tools', 'Tool room', 1], ['TL-0012', 'Floor buffer', 'Cleaning equipment', 'Janitor closet', 1],
].forEach(([code, name, category, location, quantity]) => db.tools.push({
  id: uuid(), code, name, category, location, quantity, repair_qty: 0, status: 'available', site: 'facilities', value: null, serial_number: null, description: null, photo_path: null, active: true, created_at: ago(60 * 24 * 60),
}));
const tool = (code) => db.tools.find((t) => t.code === code);
[['TL-0001', 'judah', 95, 'Gym'], ['TL-0004', 'rick', 40, 'Upstairs offices'], ['TL-0008', 'aaron', 60 * 3, 'North entrance']].forEach(([code, who, min, dest]) => {
  const t = tool(code);
  db.tool_checkouts.push({ id: nextId(), tool_id: t.id, borrower_id: who, checked_out_at: ago(min), due_at: null, out_note: null, out_by: who, returned_at: null, qty: 1, destination: dest, event_id: null });
  if (t.quantity === 1) t.status = 'out';
  db.notifications.push({ id: nextId(), created_at: ago(min), site: 'facilities', kind: 'out', tool_id: t.id, item_id: null, title: `${nameOf(who)} took the ${t.name}`, body: dest ? `To ${dest}` : null });
});
tool('TL-0012').repair_qty = 1; tool('TL-0012').status = 'repair';

// Maintenance requests (sample)
const GROUP = { New: 'new', 'Waiting for Approval': 'pending_reply', Executive: 'executive', Complete: 'solved', Declined: 'solved' };
const groupOf = (st) => GROUP[st] || 'in_progress';
[
  ['Signs for parking lot', 'At entry points', 'In Progress', ['Rick'], null, 'Signage', 2],
  ['Leaking gutters', 'South parking lot', 'Needs Scheduled', ['Kenny'], null, 'Exterior', 9],
  ['Paint touch up', 'Upstairs south conference room', 'Project', ['Max'], null, 'Painting', 14],
  ['Parking lot lights not all working', 'East campus lot', 'Project', ['Max', 'Rick'], dayIso(10), 'Electrical', 20],
  ['Kitchen sink leak repair', 'Kitchen', 'New', [], dayIso(2), 'Plumbing', 1],
  ['Repair stove top burners', 'Kitchen', 'New', [], null, 'Appliances', 1],
  ['Lights replaced', 'Upstairs office hallway', 'Ordered', ['Rick', 'Judah'], null, 'Electrical', 6],
  ['South men’s restroom urinal repair', 'South bathrooms', 'Needs Ordered', ['Kenny'], dayIso(-1), 'Plumbing', 12],
  ['Tear in wall', 'Family Center', 'New', [], dayIso(14), 'Drywall', 0],
  ['Exchange white outlets for black', 'South upstairs offices', 'Needs Ordered', ['Rick', 'Judah'], null, 'Electrical', 7],
  ['Ventilation', 'Grand Lobby', 'Waiting for Approval', ['Kenny'], null, 'HVAC', 18],
  ['Flooring tearing up', 'Media offices', 'Paused', ['Kenny'], null, 'Flooring', 30],
  ['Replace lobby door closer', 'Main entrance', 'Complete', ['Judah'], null, 'Doors', 25],
  ['Unclog drain', 'Kids wing restroom', 'Complete', ['Kenny'], null, 'Plumbing', 11],
  ['Hang TV in green room', 'Green room', 'Complete', ['Rick'], null, 'Install', 8],
].forEach(([subject, location, status, experts, due, cat, daysAgo], i) => {
  const id = i + 1;
  db.maint_requests.push({
    id, subject, location, status, board_group: groupOf(status), experts, due_date: due, request_category: cat,
    requester_name: ['Front desk', 'Kids ministry', 'Worship team', 'Office staff', 'Hospitality'][i % 5], requester_email: null, requester_phone: null,
    campus: 'Main campus', department: null, support_team: 'Facilities', priority: i % 4 === 0 ? 'High' : 'Normal', needs: {}, details: `${subject} at ${location}.`,
    completion_date: status === 'Complete' ? dayIso(-Math.max(1, daysAgo - 3)) : null, worked_seconds: status === 'Complete' ? 3600 + i * 600 : status === 'In Progress' ? 1800 : 0,
    timer_started_at: status === 'In Progress' ? ago(40) : null, created_by_name: 'Request form', created_at: ago(daysAgo * 24 * 60 + 60), updated_at: ago(60), extra: {},
  });
});
db.maint_updates.push({ id: nextId(), request_id: 2, parent_id: null, kind: 'update', author: 'Kenny', body: 'Gutter guard is torn on the south side. Need the 24 ft ladder; scheduling for a dry day.', created_at: ago(60 * 20) },
  { id: nextId(), request_id: 11, parent_id: null, kind: 'email', author: 'Kenny', body: 'Quote sent to Skyler for approval: new return-air grille and duct cleaning.', created_at: ago(60 * 30) });
db.maint_subtasks.push({ id: nextId(), request_id: 4, name: 'Find which fixtures are out', owner: 'Rick', status: 'Done', sort: 0 }, { id: nextId(), request_id: 4, name: 'Order ballasts and bulbs', owner: 'Max', status: 'Working on it', sort: 1 }, { id: nextId(), request_id: 4, name: 'Rent a lift and replace', owner: 'Rick', status: null, sort: 2 });

// Custodial checklist: this week's list and the weekly template
const CK = [
  ['Clean South after Students', 'Building', null, ['Bathrooms: sweep, mop, toilets, mirrors, stock', 'Family Center: trash, chairs, vacuum', 'Chapel: trash, chairs, vacuum', 'Entryways: glass, rugs, mop']],
  ['Serve Team Lounge', 'Building', null, ['Vacuum (move chairs for crumbs)', 'Wipe down white chairs']],
  ['Nursing Mothers Room', 'Building', null, ['Bathroom: toilet, mirror, sink, stock', 'Wipe down surfaces', 'Vacuum and mop']],
  ['Ready Room', 'Building', null, ['Wipe surfaces / dust', 'Adjust chairs and pillows', 'Vacuum', 'Trash']],
  ['Sanctuary reset', 'Building', null, ['Straighten all chairs', 'Spot vacuum', 'Lost and found to the cabinet']],
  ['Office: Quick exec check', 'Offices', null, ['Offices', 'Board room', 'Bathroom', 'Kitchenette', 'Trash']],
  ['Office: South upstairs check', 'Offices', null, ['Office trash', 'Hall vacuum', 'Bathroom check and stock', 'Copy room trash']],
  ['Sign off: cleaning complete', 'Sign-off', 'Mark Done when today\'s cleaning is finished.', []],
];
const dayFor = (i) => [TODAY_NAME, TODAY_NAME, TODAY_NAME, TODAY_NAME, TODAY_NAME, DAYS[(new Date().getDay() + 1) % 7], DAYS[(new Date().getDay() + 2) % 7], TODAY_NAME][i];
CK.forEach(([name, area, includes, steps], i) => {
  const tpl = nextId();
  db.checklist_tasks.push({ id: tpl, week_of: null, archived: false, name, area, status: 'Not started', who: null, day: dayFor(i), includes, worked_seconds: 0, sort: i });
  steps.forEach((s, k) => db.checklist_subtasks.push({ id: nextId(), task_id: tpl, name: s, done: false, sort: k }));
  const id = nextId();
  const done = i === 1 || i === 3 || i === 5;
  db.checklist_tasks.push({ id, week_of: SUNDAY, template_id: tpl, archived: false, name, area, status: done ? 'Done' : i === 4 ? 'Working on it' : 'Not started',
    who: done ? ['Lexi', 'Marah', 'Lexi'][[1, 3, 5].indexOf(i)] : i === 4 ? 'Lexi' : null, day: dayFor(i), includes, worked_seconds: done ? 1500 : 0,
    timer_started_at: i === 4 ? ago(25) : null, done_on: done ? ago(120) : null, sort: i });
  steps.forEach((s, k) => db.checklist_subtasks.push({ id: nextId(), task_id: id, name: s, done: done, sort: k }));
});

// Maintenance schedule
const pm = (o) => { const t = { id: nextId(), parent_id: null, lead_days: null, due_days: null, start_month: null, start_day: null, location: null, notes: null, steps: [], assignees: [], contractor_id: null, active: true, active_since: dayIso(-120), sort: db.pm_tasks.length, ...o }; db.pm_tasks.push(t); return t; };
db.contractors.push(
  { id: 1, name: 'Example Grease Trap Co.', trade: 'Grease trap', contact: 'Tony', phone: '(817) 555-0142', email: 'service@example.com', website: 'example.com', notes: '$225 per pump-out. Book 2 weeks ahead.', active: true },
  { id: 2, name: 'Example Fire Protection', trade: 'Fire & safety', contact: 'Dana', phone: '(817) 555-0178', email: null, website: null, notes: 'Yearly extinguisher and sprinkler inspection.', active: true },
  { id: 3, name: 'Example Elevator Service', trade: 'Elevator', contact: null, phone: '(817) 555-0110', email: null, website: null, notes: 'After-hours line on the sticker in the cab.', active: true });
const ac = pm({ name: 'Change AC filters', frequency: 'quarterly', start_month: 3, due_days: 14, location: 'All buildings', notes: '20x25x1 MERV 8', steps: ['North building units', 'South building units'], assignees: ['rick'] });
pm({ name: 'Order filters', frequency: 'quarterly', parent_id: ac.id, lead_days: 7 });
pm({ name: 'Pressure wash entrances', frequency: 'monthly', due_days: 14, location: 'Entrances', steps: ['Northwest entrance', 'Northeast entrance', 'South entrance'], assignees: ['aaron'] });
pm({ name: 'Lawn care', frequency: 'biweekly', start_day: 1, steps: ['Mow', 'Weed-eat', 'Edge', 'Blow parking lot'], assignees: ['aaron'] });
pm({ name: 'Test emergency and exit lights', frequency: 'monthly', due_days: 7, assignees: ['judah'] });
const gt = pm({ name: 'Grease trap cleaning', frequency: 'quarterly', start_month: 1, contractor_id: 1, assignees: ['max'] });
pm({ name: 'Book the grease trap company', frequency: 'quarterly', parent_id: gt.id, lead_days: 14 });
pm({ name: 'Replace lobby carpet tiles', frequency: 'once', once_start: dayIso(5), once_due: dayIso(21), location: 'Grand Lobby', assignees: ['kenny'], notes: 'Tiles are in the warehouse.' });
pm({ name: 'Fix the back gate latch', frequency: 'once', once_due: dayIso(2), location: 'Back gate', assignees: ['judah'] });
pm({ name: 'Fire extinguisher inspection', frequency: 'yearly', start_month: 1, due_days: 30, contractor_id: 2 });

// Team schedule extras
db.time_off.push({ id: nextId(), member_id: 'aaron', kind: 'PTO', starts_on: TODAY, ends_on: dayIso(1), part: null, note: null },
  { id: nextId(), member_id: 'marah', kind: 'Vacation', starts_on: dayIso(3), ends_on: dayIso(9), part: null, note: 'Family trip' },
  { id: nextId(), member_id: 'kenny', kind: 'Other', starts_on: TODAY, ends_on: TODAY, part: 'Afternoon', note: 'Doctor' });
db.pulled_work.push({ id: nextId(), dept: 'maintenance', member_id: 'rick', what: 'Unlock the gym for a funeral setup', location: 'Gym', request_id: null, day: TODAY, started_at: ago(35), ended_at: null });

// ------------------------------------------------------- maintenance schedule
const STEP_M = { monthly: 1, quarterly: 3, yearly: 12 };
function periodStart(freq, iso, sm, sd) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  if (freq === 'weekly') return addDays(iso, -dt.getDay());
  if (freq === 'biweekly') {
    const sun = addDays(iso, -dt.getDay());
    const weeks = Math.round((new Date(...sun.split('-').map((v, i) => (i === 1 ? v - 1 : +v))) - new Date(2026, 0, 4)) / 6048e5);
    return addDays(sun, -7 * ((((weeks - ((sd || 1) - 1)) % 2) + 2) % 2));
  }
  const day = sd || 1;
  let cand;
  if (freq === 'monthly') cand = new Date(y, m - 1, day);
  else if (freq === 'quarterly') { const k = (((m - (sm || 1)) % 3) + 3) % 3; cand = new Date(y, m - 1 - k, day); }
  else cand = new Date(y, (sm || 1) - 1, day);
  if (isoOf(cand) > iso) cand = new Date(cand.getFullYear(), cand.getMonth() - STEP_M[freq], day);
  return isoOf(cand);
}
function periodEnd(freq, start) {
  if (freq === 'weekly') return addDays(start, 6);
  if (freq === 'biweekly') return addDays(start, 13);
  const [y, m, d] = start.split('-').map(Number);
  return addDays(isoOf(new Date(y, m - 1 + STEP_M[freq], d)), -1);
}
function pmRefresh() {
  db.pm_runs.forEach((r) => { if (r.status === 'open' && r.period_end < TODAY && db.pm_tasks.find((t) => t.id === r.task_id)?.frequency !== 'once') r.status = 'missed'; });
  db.pm_tasks.filter((t) => t.active && !t.parent_id && t.frequency === 'once' && t.once_due).forEach((t) => {
    if (db.pm_runs.some((r) => r.task_id === t.id)) return;
    const st = t.once_start || TODAY;
    db.pm_runs.push({ id: nextId(), task_id: t.id, period_start: st < t.once_due ? st : t.once_due, period_end: t.once_due, due_on: t.once_due, status: 'open', steps_done: [] });
  });
  db.pm_tasks.filter((t) => t.active && !t.parent_id && t.frequency !== 'once').forEach((t) => {
    const ps = periodStart(t.frequency, TODAY, t.start_month, t.start_day);
    if (db.pm_runs.some((r) => r.task_id === t.id && r.period_start === ps)) return;
    const pe = periodEnd(t.frequency, ps);
    const win = t.due_days ? (addDays(ps, t.due_days - 1) < pe ? addDays(ps, t.due_days - 1) : pe) : pe;
    const firstSince = periodStart(t.frequency, t.active_since, t.start_month, t.start_day);
    if (ps === firstSince && win < t.active_since) return;
    if (t.frequency === 'biweekly' && ps < t.active_since) return;
    db.pm_runs.push({ id: nextId(), task_id: t.id, period_start: ps, period_end: pe, due_on: win, status: 'open', steps_done: [] });
  });
  db.pm_tasks.filter((c) => c.active && c.parent_id && c.lead_days).forEach((c) => {
    const t = db.pm_tasks.find((x) => x.id === c.parent_id);
    if (!t || !t.active) return;
    const ps = periodStart(t.frequency, addDays(TODAY, c.lead_days), t.start_month, t.start_day);
    if (ps <= TODAY) return;
    const start = addDays(ps, -c.lead_days);
    if (db.pm_runs.some((r) => r.task_id === c.id && r.period_start === start)) return;
    db.pm_runs.push({ id: nextId(), task_id: c.id, period_start: start, period_end: addDays(ps, -1), due_on: addDays(ps, -1), status: 'open', steps_done: [] });
  });
  return TODAY;
}
pmRefresh();
// Some history, and one done this period
db.pm_runs.filter((r) => db.pm_tasks.find((t) => t.id === r.task_id)?.name === 'Test emergency and exit lights').forEach((r) => { r.status = 'done'; r.done_by = 'judah'; r.done_at = ago(60 * 26); });
db.pm_tasks.filter((t) => !t.parent_id && !['yearly', 'once'].includes(t.frequency)).forEach((t, i) => {
  const prev = periodStart(t.frequency, addDays(periodStart(t.frequency, TODAY, t.start_month, t.start_day), -1), t.start_month, t.start_day);
  db.pm_runs.push({ id: nextId(), task_id: t.id, period_start: prev, period_end: periodEnd(t.frequency, prev), due_on: periodEnd(t.frequency, prev), status: i === 2 ? 'missed' : 'done', done_by: t.assignees[0] || 'max', done_at: i === 2 ? null : `${addDays(prev, 3)}T15:00:00Z`, steps_done: [] });
});

// --------------------------------------------------------------- triggers
function onUpdate(table, row, patch) {
  if (table === 'maint_requests' && patch.status && patch.status !== row.status) {
    const st = patch.status;
    row.board_group = groupOf(st);
    if (st === 'In Progress' && !row.timer_started_at) row.timer_started_at = nowIso();
    if (['Complete', 'Declined'].includes(st) && row.timer_started_at) { row.worked_seconds += Math.round((Date.now() - new Date(row.timer_started_at)) / 1000); row.timer_started_at = null; }
    if (st === 'Complete') row.completion_date = TODAY;
    if (['In Progress', 'Complete'].includes(st) && !row.experts.includes('Skyler')) row.experts = [...row.experts, 'Skyler'];
    db.maint_updates.push({ id: nextId(), request_id: row.id, parent_id: null, kind: 'system', author: 'Skyler', body: `Status: ${row.status} → ${st}`, created_at: nowIso() });
  }
  if (table === 'checklist_tasks' && patch.status && patch.status !== row.status) {
    if (patch.status === 'Done') { row.done_on = nowIso(); const who = String(row.who || '').split(',').map((x) => x.trim()).filter(Boolean); if (!who.includes('Skyler')) row.who = [...who, 'Skyler'].join(', '); }
    else if (row.status === 'Done') row.done_on = null;
    if (row.timer_started_at && ['Done', 'Skipped', 'Missed', 'Not started'].includes(patch.status)) { row.worked_seconds += Math.round((Date.now() - new Date(row.timer_started_at)) / 1000); row.timer_started_at = null; }
  }
}
const DEFAULTS = {
  items: () => ({ id: uuid(), code: `INV-${String(nextId()).padStart(4, '0')}`, quantity: 0, reorder_level: 0, pack_size: 1, unit: 'ea', category: 'facilities', active: true }),
  tools: () => ({ id: uuid(), code: `TL-${String(nextId()).padStart(4, '0')}`, status: 'available', quantity: 1, repair_qty: 0, site: 'facilities', active: true }),
  maint_requests: () => ({ id: nextId(), status: 'New', board_group: 'new', experts: [], needs: {}, worked_seconds: 0, extra: {}, created_by_name: 'Skyler' }),
  checklist_tasks: () => ({ id: nextId(), status: 'Not started', worked_seconds: 0, archived: false, sort: 99 }),
  contractors: () => ({ id: nextId(), active: true }),
};

// ------------------------------------------------------------ query builder
const loose = (a, b) => (a === b) || (a != null && b != null && String(a) === String(b));
const field = (row, key) => key.split('.').reduce((v, k) => (v == null ? v : v[k]), row);
const JOINS = { checklist_tasks: ['checklist_tasks', 'task_id'] };
class Query {
  constructor(table) { this.t = table; this.filters = []; this.orders = []; this.op = 'select'; this.max = null; this.from = 0; this.joins = []; }
  select(cols = '*') {
    String(cols).replace(/(\w+)(?:!inner)?\(/g, (_, rel) => { if (JOINS[rel]) this.joins.push(rel); return ''; });
    return this;
  }
  eq(k, v) { this.filters.push((r) => loose(field(r, k), v)); return this; }
  neq(k, v) { this.filters.push((r) => !loose(field(r, k), v)); return this; }
  is(k, v) { this.filters.push((r) => (field(r, k) ?? null) === v); return this; }
  in(k, vs) { this.filters.push((r) => vs.some((v) => loose(field(r, k), v))); return this; }
  gte(k, v) { this.filters.push((r) => field(r, k) != null && String(field(r, k)) >= String(v)); return this; }
  lte(k, v) { this.filters.push((r) => field(r, k) != null && String(field(r, k)) <= String(v)); return this; }
  gt(k, v) { this.filters.push((r) => field(r, k) != null && String(field(r, k)) > String(v)); return this; }
  lt(k, v) { this.filters.push((r) => field(r, k) != null && String(field(r, k)) < String(v)); return this; }
  not(k, op, v) { if (op === 'is') this.filters.push((r) => (field(r, k) ?? null) !== v); else this.filters.push((r) => !loose(field(r, k), v)); return this; }
  ilike(k, v) { const re = new RegExp(`^${String(v).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*')}$`, 'i'); this.filters.push((r) => re.test(String(field(r, k) ?? ''))); return this; }
  or() { return this; }
  contains(k, v) { this.filters.push((r) => [].concat(v).every((x) => (field(r, k) || []).includes(x))); return this; }
  order(k, o = {}) { this.orders.push([k, o.ascending !== false, !!o.nullsFirst]); return this; }
  limit(n) { this.max = n; return this; }
  range(a, b) { this.from = a; this.max = b - a + 1; return this; }
  single() { this.one = true; return this; }
  maybeSingle() { this.one = true; return this; }
  insert(rows) { this.op = 'insert'; this.rows = rows; return this; }
  upsert(rows) { this.op = 'insert'; this.rows = rows; return this; }
  update(patch) { this.op = 'update'; this.patch = patch; return this; }
  delete() { this.op = 'delete'; return this; }
  run() {
    const tbl = db[this.t] || (db[this.t] = []);
    const withJoins = (r) => { if (!this.joins.length) return r; const x = { ...r }; this.joins.forEach((rel) => { const [t, fk] = JOINS[rel]; x[rel] = db[t].find((y) => y.id === r[fk]) || null; }); return x; };
    if (this.op === 'insert') {
      const made = [].concat(this.rows).map((r) => ({ ...(DEFAULTS[this.t] ? DEFAULTS[this.t]() : { id: nextId() }), created_at: nowIso(), ...r }));
      tbl.push(...made);
      return made;
    }
    let rows = tbl.filter((r) => this.filters.every((f) => f(withJoins(r))));
    if (this.op === 'update') { rows.forEach((r) => { onUpdate(this.t, r, this.patch); Object.assign(r, this.patch); }); return rows; }
    if (this.op === 'delete') { db[this.t] = tbl.filter((r) => !rows.includes(r)); return rows; }
    rows = rows.map(withJoins);
    if (this.orders.length) {
      rows = [...rows].sort((a, b) => {
        for (const [k, asc] of this.orders) {
          const x = field(a, k); const y = field(b, k);
          if (x == null && y == null) continue;
          if (x == null) return 1;
          if (y == null) return -1;
          const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y));
          if (c) return asc ? c : -c;
        }
        return 0;
      });
    }
    if (this.from || this.max != null) rows = rows.slice(this.from, this.max != null ? this.from + this.max : undefined);
    return rows.map((r) => JSON.parse(JSON.stringify(r)));
  }
  then(res, rej) {
    let out;
    try { const data = this.run(); out = { data: this.one ? (data[0] ?? null) : data, error: null }; } catch (e) { out = { data: null, error: { message: e.message } }; }
    return Promise.resolve(out).then(res, rej);
  }
}

// ------------------------------------------------------------------- RPCs
const fail = (msg) => { throw new Error(msg); };
const openOuts = (toolId) => db.tool_checkouts.filter((c) => c.tool_id === toolId && !c.returned_at);
const outQty = (toolId) => openOuts(toolId).reduce((n, c) => n + (c.qty || 1), 0);
const toolStatus = (t) => { if (t.status === 'retired' || t.status === 'lost') return; const free = t.quantity - outQty(t.id) - (t.repair_qty || 0); t.status = free > 0 ? 'available' : outQty(t.id) ? 'out' : 'repair'; };
const RPC = {
  needs_first_admin: () => false,
  claim_first_admin: () => null,
  mark_notifications_seen: () => { db.team_members.find((m) => m.id === ME).notif_seen_at = nowIso(); return nowIso(); },
  save_push_subscription: () => null,
  delete_push_subscription: () => null,
  lookup_code({ p_code }) {
    const c = String(p_code || '').trim().toUpperCase();
    const it = db.items.find((x) => x.code.toUpperCase() === c);
    if (it) return { kind: 'item', record: it };
    const t = db.tools.find((x) => x.code.toUpperCase() === c);
    if (t) {
      const outs = openOuts(t.id).map((o) => ({ ...o, borrower_name: nameOf(o.borrower_id) }));
      return { kind: 'tool', record: t, out_qty: outQty(t.id), checkouts: outs, checkout: outs[0] || null };
    }
    const m = db.team_members.find((x) => x.code.toUpperCase() === c);
    if (m) return { kind: 'person', record: { id: m.id, name: m.name, code: m.code, active: m.active } };
    return { kind: 'none' };
  },
  scan_item({ p_code, p_type, p_qty, p_in_packs, p_note, p_member }) {
    const it = db.items.find((x) => x.code.toUpperCase() === String(p_code).trim().toUpperCase()) || fail(`No item with code ${p_code}`);
    const n = Math.max(0, Number(p_qty) || 0) * (p_in_packs ? it.pack_size || 1 : 1);
    const before = it.quantity;
    if (p_type === 'in') it.quantity += n; else if (p_type === 'out') it.quantity = Math.max(0, it.quantity - n); else it.quantity = n;
    db.item_transactions.push({ id: nextId(), item_id: it.id, type: p_type, qty: it.quantity - before, qty_after: it.quantity, note: p_note || null, member_id: p_member || ME, recorded_by: ME, created_at: nowIso() });
    return { item: { ...it }, change: it.quantity - before };
  },
  checkout_tool({ p_code, p_borrower, p_destination, p_qty }) {
    const t = db.tools.find((x) => x.code.toUpperCase() === String(p_code).toUpperCase()) || fail('No tool with that code');
    if (t.quantity - outQty(t.id) - (t.repair_qty || 0) < (p_qty || 1)) fail(`All of the ${t.name} are out`);
    const c = { id: nextId(), tool_id: t.id, borrower_id: p_borrower, checked_out_at: nowIso(), out_by: ME, returned_at: null, qty: p_qty || 1, destination: p_destination || null, event_id: null };
    db.tool_checkouts.push(c);
    toolStatus(t);
    db.notifications.push({ id: nextId(), created_at: nowIso(), site: 'facilities', kind: 'out', tool_id: t.id, item_id: null, title: `${nameOf(p_borrower)} took the ${t.name}`, body: p_destination ? `To ${p_destination}` : null });
    return c.id;
  },
  return_tool({ p_code }) {
    const t = db.tools.find((x) => x.code.toUpperCase() === String(p_code).toUpperCase()) || fail('No tool with that code');
    openOuts(t.id).forEach((c) => { c.returned_at = nowIso(); c.in_by = ME; });
    toolStatus(t);
    db.notifications.push({ id: nextId(), created_at: nowIso(), site: 'facilities', kind: 'in', tool_id: t.id, item_id: null, title: `The ${t.name} is back`, body: null });
  },
  return_tool_checkout({ p_checkout, p_qty }) {
    const c = db.tool_checkouts.find((x) => loose(x.id, p_checkout)) || fail('Not found');
    const n = Math.min(c.qty || 1, p_qty || c.qty || 1);
    if (n >= (c.qty || 1)) { c.returned_at = nowIso(); c.in_by = ME; } else { c.qty -= n; db.tool_checkouts.push({ ...c, id: nextId(), qty: n, returned_at: nowIso(), in_by: ME }); }
    toolStatus(db.tools.find((t) => t.id === c.tool_id));
  },
  mark_checkout_lost({ p_checkout }) { const c = db.tool_checkouts.find((x) => loose(x.id, p_checkout)); if (c) { c.returned_at = nowIso(); const t = db.tools.find((x) => x.id === c.tool_id); t.status = 'lost'; } },
  set_tool_status({ p_tool, p_status }) { const t = db.tools.find((x) => loose(x.id, p_tool)); t.status = p_status; if (p_status === 'available') { t.repair_qty = 0; toolStatus(t); } },
  report_tool_problem({ p_tool, p_qty }) { const t = db.tools.find((x) => loose(x.id, p_tool)); t.repair_qty = Math.min(t.quantity, (t.repair_qty || 0) + (p_qty || 1)); toolStatus(t); },
  add_location({ p_name }) { if (!db.locations.some((l) => l.name === p_name)) db.locations.push({ name: p_name, active: true }); },
  remove_location({ p_name }) { db.locations = db.locations.filter((l) => l.name !== p_name); },
  add_category({ p_kind, p_name }) { db.categories.push({ kind: p_kind, name: p_name, active: true }); },
  rename_category({ p_kind, p_old, p_new }) { const c = db.categories.find((x) => x.kind === p_kind && x.name === p_old); if (c) c.name = p_new; },
  remove_category({ p_kind, p_name }) { db.categories = db.categories.filter((x) => !(x.kind === p_kind && x.name === p_name)); },
  team_add_person(a) { const m = { id: uuid(), name: a.p_name, email: a.p_email || null, code: `P-${nextId()}`, role: a.p_role || 'member', active: true }; db.team_members.push(m); return m.id; },
  team_update_person(a) { const m = db.team_members.find((x) => loose(x.id, a.p_id)); if (m && a.p_role !== undefined) { if (a.p_role === null) m.active = false; else m.role = a.p_role; } },
  paint_move: () => null, mark_labels_printed: () => null, record_gear_checks: () => null, reserve_gear: () => null, cancel_reservation: () => null,
  start_checklist_week: () => SUNDAY,
  checklist_timer({ p_id, p_run }) {
    const t = db.checklist_tasks.find((x) => loose(x.id, p_id));
    if (p_run) { t.timer_started_at = t.timer_started_at || nowIso(); if (t.status === 'Not started') t.status = 'Working on it'; const who = String(t.who || '').split(',').map((x) => x.trim()).filter(Boolean); if (!who.includes('Skyler')) t.who = [...who, 'Skyler'].join(', '); }
    else if (t.timer_started_at) { t.worked_seconds += Math.round((Date.now() - new Date(t.timer_started_at)) / 1000); t.timer_started_at = null; }
  },
  maint_timer({ p_id, p_run }) {
    const r = db.maint_requests.find((x) => loose(x.id, p_id));
    if (p_run) r.timer_started_at = r.timer_started_at || nowIso();
    else if (r.timer_started_at) { db.maint_time.push({ id: nextId(), request_id: r.id, started_by: 'Skyler', ended_by: 'Skyler', started_at: r.timer_started_at, ended_at: nowIso() }); r.worked_seconds += Math.round((Date.now() - new Date(r.timer_started_at)) / 1000); r.timer_started_at = null; }
  },
  maint_send_reply({ p_id, p_message }) { db.maint_updates.push({ id: nextId(), request_id: Number(p_id), parent_id: null, kind: 'email', author: 'Skyler', body: p_message, created_at: nowIso() }); },
  time_off_add(a) { db.time_off.push({ id: nextId(), member_id: a.p_member || ME, kind: a.p_kind, starts_on: a.p_start, ends_on: a.p_end || a.p_start, part: a.p_part || null, note: a.p_note || null }); },
  time_off_remove({ p_id }) { db.time_off = db.time_off.filter((r) => !loose(r.id, p_id)); },
  set_member_schedule({ p_member, p_team, p_hours }) { const m = db.team_members.find((x) => x.id === p_member); m.team = p_team; m.work_hours = p_hours; },
  pulled_start(a) {
    db.pulled_work.filter((r) => r.member_id === ME && !r.ended_at).forEach((r) => { r.ended_at = nowIso(); });
    db.pulled_work.push({ id: nextId(), dept: a.p_dept, member_id: ME, what: a.p_what, location: a.p_location || null, request_id: a.p_request || null, day: TODAY, started_at: nowIso(), ended_at: null });
  },
  pulled_end({ p_id }) { const r = db.pulled_work.find((x) => loose(x.id, p_id)); if (r) r.ended_at = nowIso(); },
  pm_period_start: ({ p_freq, p_day, p_month, p_dom }) => periodStart(p_freq, p_day, p_month, p_dom),
  pm_refresh: () => pmRefresh(),
  pm_save_task(a) {
    let t = db.pm_tasks.find((x) => loose(x.id, a.p_id));
    if (!t) t = pm({ active_since: TODAY });
    const timing = [t.frequency, t.due_days, t.start_month, t.start_day].join();
    Object.assign(t, { name: a.p_name, frequency: a.p_frequency, due_days: a.p_due_days, location: a.p_location, notes: a.p_notes, steps: a.p_steps || [],
      start_month: ['quarterly', 'yearly'].includes(a.p_frequency) ? a.p_start_month : null, start_day: a.p_frequency === 'weekly' ? null : a.p_start_day });
    if (a.p_id && timing !== [t.frequency, t.due_days, t.start_month, t.start_day].join()) t.active_since = TODAY;
    db.pm_runs = db.pm_runs.filter((r) => !((r.task_id === t.id || db.pm_tasks.find((c) => c.id === r.task_id)?.parent_id === t.id) && r.status === 'open' && r.period_end >= TODAY));
    db.pm_tasks.filter((c) => c.parent_id === t.id).forEach((c) => { c.frequency = t.frequency; });
    pmRefresh();
    return t.id;
  },
  pm_set_preps({ p_parent, p_preps }) {
    const keep = [];
    (p_preps || []).forEach((e) => {
      let c = e.id && db.pm_tasks.find((x) => loose(x.id, e.id) && x.parent_id === p_parent);
      if (!c) c = pm({ parent_id: p_parent, active_since: TODAY });
      Object.assign(c, { name: e.name, lead_days: e.lead_days, frequency: db.pm_tasks.find((x) => x.id === p_parent).frequency, active: true });
      keep.push(c.id);
    });
    db.pm_tasks.filter((c) => c.parent_id === p_parent && !keep.includes(c.id)).forEach((c) => { c.active = false; });
    db.pm_runs = db.pm_runs.filter((r) => !(db.pm_tasks.find((c) => c.id === r.task_id)?.parent_id === p_parent && r.status === 'open'));
    pmRefresh();
  },
  pm_set_once({ p_task, p_start, p_due }) {
    const t = db.pm_tasks.find((x) => loose(x.id, p_task));
    Object.assign(t, { frequency: 'once', once_start: p_start || null, once_due: p_due, due_days: null, start_month: null, start_day: null });
    db.pm_runs = db.pm_runs.filter((r) => !(r.task_id === t.id && r.status === 'open'));
    pmRefresh();
  },
  pm_set_contractor({ p_task, p_contractor }) { db.pm_tasks.find((x) => loose(x.id, p_task)).contractor_id = p_contractor; },
  pm_set_assignees({ p_task, p_people }) { db.pm_tasks.find((x) => loose(x.id, p_task)).assignees = p_people || []; },
  pm_set_active({ p_id, p_active }) { const t = db.pm_tasks.find((x) => loose(x.id, p_id)); t.active = p_active; if (p_active) t.active_since = TODAY; else db.pm_runs = db.pm_runs.filter((r) => !(r.task_id === t.id && r.status === 'open')); pmRefresh(); },
  pm_mark({ p_run, p_status, p_note }) { const r = db.pm_runs.find((x) => loose(x.id, p_run)); r.status = p_status; r.note = p_note || null; r.done_by = p_status === 'done' ? ME : null; r.done_at = p_status === 'done' ? nowIso() : null; },
  pm_step({ p_run, p_index, p_done }) { const r = db.pm_runs.find((x) => loose(x.id, p_run)); r.steps_done = p_done ? [...new Set([...(r.steps_done || []), p_index])] : (r.steps_done || []).filter((i) => i !== p_index); },
  get_gameplan: ({ p_weekend }) => db.weekend_gameplan.filter((g) => g.weekend_of === p_weekend),
  set_gameplan_days({ p_weekend, p_days }) {
    const order = { normal: 0, watch: 1, action: 2 };
    const status = Object.values(p_days).reduce((m, d) => (order[d.status] > order[m] ? d.status : m), 'normal');
    db.weekend_gameplan = [{ weekend_of: p_weekend, status, plan: null, days: p_days, updated_at: nowIso(), updated_by: 'Skyler' }];
  },
};
{ // A sample gameplan for this weekend
  const d = new Date(); const dow = d.getDay();
  const sat = addDays(TODAY, dow === 6 ? 0 : dow === 0 ? -1 : 6 - dow);
  RPC.set_gameplan_days({ p_weekend: sat, p_days: {
    fri: { status: 'normal', plan: 'Normal Friday setup. Lawn done by noon.' },
    sat: { status: 'watch', plan: 'Wind gusts in the afternoon: weigh down the welcome tent and sign stands.' },
    sun: { status: 'normal', plan: 'Normal Sunday. Blow the parking lot at 6 AM, extra mats at the doors if it rains overnight.' },
  } });
  db.weekend_gameplan[0].updated_by = 'Max';
}

// ----------------------------------------------------------------- client
export function demoClient() {
  const session = { user: { id: 'demo-user', email: 'me@demo.local' }, access_token: 'demo' };
  return {
    from: (t) => new Query(t),
    rpc: async (name, args) => {
      try { return { data: RPC[name] ? (RPC[name](args || {}) ?? null) : null, error: null }; } catch (e) { return { data: null, error: { message: e.message } }; }
    },
    channel: () => ({ on() { return this; }, subscribe() { return this; } }),
    removeChannel() {},
    storage: { from: () => ({ createSignedUrls: async () => ({ data: [], error: null }), upload: async () => ({ error: { message: 'Photos are off in the demo.' } }), remove: async () => ({ error: null }) }) },
    auth: {
      onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; },
      getSession: async () => ({ data: { session } }),
      signOut: async () => { location.reload(); return { error: null }; },
      signInWithPassword: async () => ({ error: null }), signInWithOtp: async () => ({ error: null }),
      updateUser: async () => ({ error: null }), resetPasswordForEmail: async () => ({ error: null }),
    },
  };
}

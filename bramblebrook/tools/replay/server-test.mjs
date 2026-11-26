// Runs supabase/functions/_shared/farm.ts against an in-memory database, with the rules from public/.
// node --experimental-strip-types tools/replay/server-test.mjs   (after ./build.sh)
import fs from 'fs';
import path from 'path';
const HERE = path.dirname(new URL(import.meta.url).pathname);
const PUB = path.join(HERE, '../../public');
globalThis.fetch = async (url) => {
  const f = String(url).includes('engine.js') ? 'engine.js' : 'content.json';
  const body = fs.readFileSync(PUB + '/' + f, 'utf8');
  return { ok: true, status: 200, text: async () => body, json: async () => JSON.parse(body) };
};
const { syncFarm } = await import('../../supabase/functions/_shared/farm.ts');

const db = { farms: {}, saves: {}, grants: [], flags: [], village: null, treasury: 0, failSave: 0, hands: [], blocks: [] };
let gid = 1;
const q = (table) => {
  const f = {}; let inList = null, orStr = null, head = false, gte = null;
  const rows = () => {
    if (table === 'farm_grants') return db.grants.filter(g => (f.user_id == null || g.user_id === f.user_id) && (f.kind == null || g.kind === f.kind) && (f.ref == null || g.ref === f.ref) && (f.user_id == null || !g.applied_at || head));
    if (table === 'farms') return Object.entries(db.farms).filter(([u]) => !inList || inList.includes(u)).map(([u, r]) => ({ user_id: u, value: r.value || 0, name: r.state && r.state.name }));
    if (table === 'farmhands') return db.hands.filter(h => f.owner == null || h.owner === f.owner);
    if (table === 'blocks') return db.blocks;
    return [];
  };
  const api = {
    select(_c, o) { if (o && o.head) head = true; return api; }, eq(k, v) { f[k] = v; return api; }, is() { return api; },
    in(_k, v) { inList = v; return api; }, or(s2) { orStr = s2; return api; }, gte(_k, v) { gte = v; return api; },
    async maybeSingle() {
      if (table === 'farms') return { data: db.farms[f.user_id] ? structuredClone(db.farms[f.user_id]) : null };
      if (table === 'saves') return { data: db.saves[f.user_id] ? { data: structuredClone(db.saves[f.user_id].data) } : null };
    },
    then(res) {
      if (head) return res({ count: rows().length });
      if (table === 'farm_grants') return res({ data: db.grants.filter(g => g.user_id === f.user_id && !g.applied_at).map(g => ({ id: g.id, coins: g.coins, xp: g.xp })) });
      res({ data: rows() });
    },
    async insert(row) { if (table === 'farm_flags') db.flags.push(row); return { error: null }; },
  };
  return api;
};
const admin = {
  from: q,
  async rpc(fn, a) {
    if (fn === 'svc_farm_village') return { data: db.village };
    if (fn === 'svc_farm_save') {
      if (db.failSave > 0) { db.failSave--; return { data: 0 }; }
      const cur = db.farms[a.p_user];
      if (a.p_v === 0 ? cur : (!cur || cur.v !== a.p_v)) return { data: 0 };
      const gs = db.grants.filter(g => g.user_id === a.p_user && a.p_grants.includes(g.id) && !g.applied_at);
      if (gs.length !== a.p_grants.length) return { error: { message: 'farm_grant_taken' } };
      if (a.p_gift > 0 && !db.village) return { error: { message: 'farm_no_village' } };
      for (const h of a.p_hires || []) if (db.hands.some(x => x.owner === a.p_user && x.hand === h.u)) return { error: { message: 'duplicate' } };
      gs.forEach(g => { g.applied_at = 1; });
      db.treasury += a.p_gift;
      for (const h of a.p_hires || []) { db.hands.push({ owner: a.p_user, hand: h.u, price: h.c }); db.grants.push({ id: ++gid, user_id: h.u, kind: 'hired', ref: a.p_user, coins: Math.floor(h.c * 0.1), xp: 0 }); }
      db.farms[a.p_user] = { state: a.p_state, hash: a.p_hash, last_t: a.p_last, v: (cur ? cur.v : 0) + 1, seqs: a.p_seqs, value: a.p_value };
      db.saves[a.p_user] = { data: a.p_state };
      return { data: db.farms[a.p_user].v };
    }
  },
};

await import(PUB + '/engine.js');
const E = globalThis.__engine; E.load(JSON.parse(fs.readFileSync(PUB + '/content.json', 'utf8')));
// the phone: a farm plus moves, and the hash it would send
let T = Date.now() - 600000, Q = 0;
const mv = (n, a = {}) => ({ n, a, t: (T += 2000), q: ++Q });
const phone = (s0, moves) => E.replay(s0, moves, { at: T + 1000 });
const send = async (body) => (await syncFarm(admin, 'u1', Object.assign({ v: 2, device: 'd1', build: '' }, body))).body;
const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };

// 1. a brand-new account brings this device's farm
const s0 = E.fresh(); s0.tz = 0;
let moves = [mv('boot'), mv('tz', { m: 0 }), mv('name', { v: 'Robin' })];
let p = phone(s0, moves);
let r = await send({ start: s0, moves, hash: p.hash, at: T + 1000 });
ok(r.ok && r.match && r.origin === 'start', 'new account takes the device farm: ' + JSON.stringify({ match: r.match, origin: r.origin }));
let cur = p.state;

// 2. the same moves again (the answer was lost): nothing happens twice
r = await send({ base_hash: r.hash, moves, hash: p.hash, at: T + 1000 });
ok(r.match, 'resent moves are not applied twice');

// 3. a boss reward: the phone claims 99999 coins, the server pays its own record (120)
db.grants.push({ id: gid, user_id: 'u1', coins: 120, xp: 0 });
const before = cur.coins;
moves = [mv('grant', { g: String(gid), c: 99999, xp: 0 })];
p = phone(cur, moves);
r = await send({ base_hash: r.hash, moves, hash: p.hash, at: T + 1000 });
ok(!r.match && r.state && r.state.coins === before + 120, `reward paid from the server's record: ${r.state && r.state.coins} (phone said ${p.state.coins})`);
cur = r.state;
// the same reward again
moves = [mv('grant', { g: String(gid), c: 120 })];
p = phone(cur, moves);
r = await send({ base_hash: r.hash, moves, hash: p.hash, at: T + 1000 });
ok(r.state && r.state.coins === cur.coins, 'a reward pays once');
cur = r.state || cur;

// 4. a reward the phone never asked for is paid at the next save
db.grants.push({ id: ++gid, user_id: 'u1', coins: 30, xp: 0 });
r = await send({ base_hash: r.hash, moves: [], hash: E.hashState(cur), at: T + 2000 });
ok(r.state && r.state.coins === cur.coins + 30, 'an unclaimed reward is paid');
cur = r.state || cur;

// 5. giving coins with no village: they stay; in a village: they reach the treasury
moves = [mv('pay', { c: 50, why: 'gift' })];
p = phone(cur, moves);
r = await send({ base_hash: r.hash, moves, hash: p.hash, at: T + 1000 });
ok(r.state && r.state.coins === cur.coins && db.treasury === 0, 'no village: the coins stay');
cur = r.state || cur;
db.village = { levels: { hall: 1 }, defs: { hall: { effect: 'none', per_level: 0 } }, name: 'Test' };
moves = [mv('pay', { c: 50, why: 'gift' })];
r = await send({ base_hash: r.hash, moves, hash: '', at: T + 1000 });
ok(r.state && r.state.coins === cur.coins - 50 && db.treasury === 50, `in a village the gift arrives: treasury ${db.treasury}`);
cur = r.state || cur;
// paying more than you have
moves = [mv('pay', { c: 10 ** 9, why: 'gift' })];
r = await send({ base_hash: r.hash, moves, hash: '', at: T + 1000 });
ok(r.state && r.state.coins === cur.coins && db.treasury === 50, 'cannot give coins you do not have');
cur = r.state || cur;

// 6. another device saved in between: the save starts again from the newer farm
db.failSave = 1;
moves = [mv('tick')];
r = await send({ base_hash: r.hash, moves, hash: '', at: T + 1000 });
ok(r.ok, 'a clash with another device is retried');

// 7. a move dated in the future is refused
moves = [{ n: 'name', a: { v: 'Cheat' }, t: Date.now() + 3600e3, q: ++Q }];
r = await send({ base_hash: r.hash, moves, hash: '', at: Date.now() });
ok(r.state && r.state.name === 'Robin', 'a move from the future is refused');

// 8. an account with an old farm in saves starts from it, not from what the device sends
db.saves.u2 = { data: Object.assign(E.fresh(), { name: 'Old', coins: 777 }) };
const r2 = (await syncFarm(admin, 'u2', { v: 2, device: 'd9', start: Object.assign(E.fresh(), { name: 'Fake', coins: 5000 }), moves: [], hash: 'x', at: Date.now() })).body;
ok(r2.origin === 'saves' && r2.state.coins === 777, 'an existing account keeps its own farm');

// 9. a brought-in farm is capped
const big = Object.assign(E.fresh(), { name: 'Big', coins: 1e9, inv: { worm: 99999 } });
const r3 = (await syncFarm(admin, 'u3', { v: 2, device: 'd9', start: big, moves: [], hash: 'x', at: Date.now() })).body;
ok(r3.trimmed && r3.state.coins === 5000 && r3.state.inv.worm === 50, 'a brought-in farm is trimmed: ' + r3.state.coins);

// 10. start over: a fresh farm, whatever the device claims
const fake = Object.assign(E.fresh(), { coins: 1e6 });
const r4 = (await syncFarm(admin, 'u2', { v: 2, device: 'd9', reset: true, start: fake, moves: [], hash: 'x', at: Date.now() })).body;
ok(r4.origin === 'reset' && r4.state.coins === 80 && !r4.state.name, 'start over gives a truly fresh farm: ' + r4.state.coins);

// 11. old games are told to reload
const r5 = (await syncFarm(admin, 'u1', { moves: [] })).body;
ok(r5.reload, 'an old game is told to reload');

// 12. farmhands: the price is the server's, the hand is paid a tenth, no doubles, no blocked players, a full bunkhouse says no
const H = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333', '44444444-4444-4444-8444-444444444444', '55555555-5555-4555-8555-555555555555'];
for (const [i, u] of H.entries()) db.farms[u] = { state: Object.assign(E.fresh(), { name: 'Hand' + i }), hash: 'x', last_t: 0, v: 1, seqs: {}, value: 5000 * (i + 1) };
const rich = db.farms.u1.state; rich.coins = 1e6;
db.farms.u1.state = rich; db.farms.u1.hash = E.hashState(rich);
let st = rich, hr; T = Date.now() + 5000;   // after test 7 moved this farm's clock to now
const hireSend = async (u, c) => { const m = [mv('hire', { u, c })]; const pp = phone(st, m); hr = await send({ base_hash: db.farms.u1.hash, moves: m, hash: pp.hash, at: T + 1000 }); st = hr.state || pp.state; return hr; };
await hireSend(H[0], 1)
ok(st.coins === 1e6 - 5000 && db.hands.length === 1 && db.grants.some(g => g.user_id === H[0] && g.coins === 500), `hire charges the server's price (${1e6 - st.coins}) and pays the hand a tenth`);
await hireSend(H[0], 5000);
ok(db.hands.length === 1 && st.coins === 1e6 - 5000, 'the same farmhand cannot be hired twice');
db.blocks.push({ blocker: H[1], blocked: 'u1' });
await hireSend(H[1], 10000);
ok(db.hands.length === 1, 'a player who blocked you cannot be hired');
await hireSend(H[2], 15000); await hireSend(H[3], 20000);
ok(db.hands.length === 3, 'two more hired (bunkhouse holds 3)');
await hireSend(H[4], 25000);
ok(db.hands.length === 3, 'a full bunkhouse says no');
await hireSend('not-a-user', 1);
ok(db.hands.length === 3, 'a made-up player is ignored');
console.log('flags', db.flags.map(f => f.kind).join(' '));

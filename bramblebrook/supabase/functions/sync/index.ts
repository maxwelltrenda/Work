// Bramblebrook sync: replays a player's recorded moves through the game's own rules and checks the farm they
// lead to. The rules engine is the game's own code, loaded from the website (public/engine.js), so the server
// always runs exactly the rules the players' game runs.
// Step 1 (shadow): it only checks and records mismatches (farm_flags); the game still saves as before.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const SITE = "https://bramblebrook-farm.vercel.app";
const MAX_MOVES = 5000, MAX_BASE = 1_000_000, SKEW = 120_000;
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false, autoRefreshToken: false } });

// deno-lint-ignore no-explicit-any
let eng: any = null, engAt = 0, engBuild = "";
// the rules are cached for 15 minutes; a player on a newer build than the cached one reloads them (once a minute at most)
async function engine(want?: string) {
  const age = Date.now() - engAt;
  if (eng && age < 15 * 60_000 && (!want || want === engBuild || age < 60_000)) return eng;
  const bust = "?t=" + Date.now();
  const [code, content] = await Promise.all([
    fetch(SITE + "/engine.js" + bust).then((r) => { if (!r.ok) throw new Error("engine.js " + r.status); return r.text(); }),
    fetch(SITE + "/content.json" + bust).then((r) => { if (!r.ok) throw new Error("content.json " + r.status); return r.json(); }),
  ]);
  (0, eval)(code);
  // deno-lint-ignore no-explicit-any
  const e = (globalThis as any).__engine;
  e.load(content);
  eng = e; engAt = Date.now(); engBuild = (code.match(/const BUILD = '([^']*)'/) || [])[1] || "";
  return eng;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const { data: auth } = await admin.auth.getUser(token);
  const user = auth?.user;
  if (!user) return json({ error: "Sign in first." }, 401);

  // deno-lint-ignore no-explicit-any
  let body: any;
  try { body = await req.json(); } catch { return json({ error: "Bad request." }, 400); }
  const moves = Array.isArray(body.moves) ? body.moves : [];
  if (moves.length > MAX_MOVES) return json({ error: "Too many moves at once." }, 413);
  if (body.base && JSON.stringify(body.base).length > MAX_BASE) return json({ error: "That farm is too big." }, 413);

  let e;
  try { e = await engine(String(body.build || "")); } catch (err) { return json({ error: "The rules could not load: " + String(err) }, 503); }

  const { data: row } = await admin.from("farm_check").select("state, hash, last_t, syncs, matches, mismatches").eq("user_id", user.id).maybeSingle();
  const base = body.base || row?.state;
  if (!base) return json({ ok: true, need_base: true });
  if (!body.base && body.base_hash && row && row.hash !== body.base_hash) return json({ ok: true, need_base: true, why: "start differs" });

  const now = Date.now(), at = Math.min(Number(body.at) || now, now + SKEW);
  const r = e.replay(base, moves, { from: body.base ? 0 : Number(row?.last_t || 0), notAfter: now + SKEW, at });
  const match = r.hash === body.hash;
  const fields = match ? [] : Object.keys(body.fields || {}).filter((k) => (body.fields || {})[k] !== e.fieldHash(r.state, k));
  await admin.from("farm_check").upsert({
    user_id: user.id, state: r.state, hash: r.hash, last_t: Math.max(r.last, at), build: engBuild, updated_at: new Date().toISOString(),
    syncs: Number(row?.syncs || 0) + 1, matches: Number(row?.matches || 0) + (match ? 1 : 0), mismatches: Number(row?.mismatches || 0) + (match ? 0 : 1),
  });
  if (!match || r.notes.length) {
    await admin.from("farm_flags").insert({
      user_id: user.id, kind: match ? "notes" : body.base ? "base-mismatch" : "mismatch", build: engBuild, moves: moves.length,
      detail: { client: body.hash, server: r.hash, fields, notes: r.notes.slice(0, 20), clientBuild: body.build || "", clock: Number(body.clock || 0) - now,
        first: moves.slice(0, 3), last: moves.slice(-5) },
    });
  }
  return json({ ok: true, match, hash: r.hash, need_base: !match, now, build: engBuild });
});

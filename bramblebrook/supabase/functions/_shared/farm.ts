// The farm, kept by the server. Used by the sync function (website and app) and by farm-mcp (the Claude connector).
//
// A player's device records every input that changes the farm as a move ({n, a, t, q}); this replays the moves
// through the game's own rules (public/engine.js, loaded from the website, so the server always runs the rules the
// players run) and saves the result as the real farm. The device plays the same moves at once; when its farm differs
// from the server's, it takes the server's. Coins and items can only come from moves the server has played itself.
// deno-lint-ignore-file no-explicit-any
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.45.4";

const SITE = "https://bramblebrook-farm.vercel.app";
export const MAX_MOVES = 5000;
const MAX_START = 1_000_000, MAX_ARGS = 2_000, SKEW = 120_000;

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
  const e = (globalThis as any).__engine;
  e.load(content);
  eng = e; engAt = Date.now(); engBuild = (code.match(/const BUILD = '([^']*)'/) || [])[1] || "";
  return eng;
}

const okMove = (m: any) => m && typeof m === "object" && typeof m.n === "string" && m.n.length <= 16 &&
  Number.isFinite(m.t) && Number.isInteger(m.q) && m.q > 0 &&
  (m.a === undefined || (typeof m.a === "object" && !Array.isArray(m.a) && JSON.stringify(m.a).length <= MAX_ARGS));

function summary(s: any) {
  const levels = Object.values(s.xp || {}).length;
  return { name: s.name || "Your farmer", coins: Math.floor(+s.coins || 0), chapter: (s.story && s.story.ci) || 0, skills: levels, savedAt: Date.now() };
}

export type SyncResult = { status: number; body: Record<string, unknown> };

export async function syncFarm(admin: SupabaseClient, userId: string, body: any, deviceName = ""): Promise<SyncResult> {
  if (!body || body.v !== 2) return { status: 200, body: { reload: true, error: "Please reload the game." } };
  const device = String(body.device || "unknown").slice(0, 40);
  const moves = Array.isArray(body.moves) ? body.moves : [];
  if (moves.length > MAX_MOVES) return { status: 413, body: { error: "Too many moves at once." } };
  if (!moves.every(okMove)) return { status: 400, body: { error: "A move was not understood." } };
  if (body.start && JSON.stringify(body.start).length > MAX_START) return { status: 413, body: { error: "That farm is too big." } };

  let e: any;
  try { e = await engine(String(body.build || "")); } catch (err) { return { status: 503, body: { error: "The rules could not load: " + String(err) } }; }

  for (let attempt = 0; attempt < 4; attempt++) {
    const { data: row } = await admin.from("farms").select("state, hash, last_t, v, seqs").eq("user_id", userId).maybeSingle();
    let base: any, origin: string | null = null, trimmed = false;
    if (body.reset && body.start) { base = e.freshFrom(body.start); origin = "reset"; }
    else if (row) base = row.state;
    else {
      // the first time this account saves this way: its existing farm, else the farm the device brings, within limits
      const { data: sv } = await admin.from("saves").select("data").eq("user_id", userId).maybeSingle();
      if (sv?.data?.name) { base = sv.data; origin = "saves"; }
      else if (body.start && typeof body.start === "object") { const c = e.clampStart(body.start); base = c.state; trimmed = c.trimmed; origin = "start"; }
      else { base = e.fresh(); origin = "fresh"; }
    }
    const seqs = { ...(row?.seqs || {}) };
    const done = Number(seqs[device] || 0);
    const fresh = moves.filter((m: any) => m.q > done);
    seqs[device] = moves.reduce((a: number, m: any) => Math.max(a, m.q), done);

    // the server's own records: unpaid rewards, the village (perks, and whether there is one to give to)
    const [{ data: grantRows }, { data: vperks }] = await Promise.all([
      admin.from("farm_grants").select("id, coins, xp").eq("user_id", userId).is("applied_at", null),
      admin.rpc("svc_farm_village", { p_user: userId }),
    ]);
    const grants: Record<string, { coins: number; xp: number }> = {};
    for (const g of grantRows || []) grants[String(g.id)] = { coins: g.coins, xp: g.xp };

    const now = Date.now(), at = Math.min(Number(body.at) || now, now + SKEW), from = Number(row?.last_t || 0);
    const r = e.replay(base, fresh, { from, notAfter: now + SKEW, at, server: { grants, vperks: vperks || null, canGift: !!vperks } });
    const gift = (r.effects || []).filter((x: any) => x.kind === "gift").reduce((a: number, x: any) => a + x.c, 0);

    const { data: nv, error } = await admin.rpc("svc_farm_save", {
      p_user: userId, p_v: row ? row.v : 0, p_state: r.state, p_hash: r.hash, p_last: Math.max(r.last, at, from), p_seqs: seqs,
      p_build: engBuild, p_origin: origin, p_grants: (r.used || []).map(Number), p_gift: gift, p_summary: summary(r.state), p_device: deviceName,
    });
    if (error || !nv) continue;   // another device saved in between (or a reward was taken): start again from its farm

    const match = r.hash === body.hash;
    if (!match || r.notes.length) {
      const fields = match ? [] : Object.keys(body.fields || {}).filter((k) => body.fields[k] !== e.fieldHash(r.state, k));
      await admin.from("farm_flags").insert({
        user_id: userId, kind: match ? "notes" : origin ? "adopt-" + origin : "adopt", build: engBuild, moves: fresh.length,
        detail: { client: body.hash, server: r.hash, fields: fields.slice(0, 40), notes: r.notes.slice(0, 20), clientBuild: body.build || "",
          clock: Number(body.clock || 0) - now, skipped: moves.length - fresh.length, last: fresh.slice(-5) },
      });
    }
    return { status: 200, body: { ok: true, match, hash: r.hash, state: match ? undefined : r.state, trimmed, origin, now, build: engBuild } };
  }
  return { status: 409, body: { error: "Your farm is busy saving from another device. Try again in a moment." } };
}

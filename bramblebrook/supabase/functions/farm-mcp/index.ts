// Bramblebrook farm connector: a tiny MCP server (Streamable HTTP, JSON replies) that a player adds to
// their own Claude account as a custom connector. It answers only for the account whose private link is
// in the URL: /functions/v1/farm-mcp/<link>.
// Tools: farm_status, load_farm, save_farm (the farm save); village, village_action (villages);
// profiles, profile_update (profiles and online status). Village and profile changes run through the
// database's svc_act(), which plays the same player-facing functions the website calls, as this player.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { syncFarm } from "../_shared/farm.ts";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const MAX_CARD = 4_000;   // a public profile card
const VILLAGE_ACTIONS = ["create_village", "join_village", "leave_village", "donate_to_village", "upgrade_village_building",
  "post_village_message", "promote_village_member", "set_village_details", "start_raid", "raid_hit", "claim_raid_reward",
  // chat, follows and notifications ride on the same tool, so a player who allowed it needs to allow nothing new
  "social_ping", "notifications_list", "notifications_seen", "social_profile", "find_player", "follow_player", "unfollow_player",
  "world_chat_recent", "post_world_message", "dm_threads", "dm_thread", "send_dm",
  // feedback: players send it; the game's owner reads and answers it in the game
  "send_feedback", "feedback_inbox", "feedback_mark",
  // safety: report, block, moderation by the game's owner, and deleting the account
  "block_player", "unblock_player", "blocked_list", "report_content", "mod_action", "delete_my_account"];

const TOOLS = [
  {
    name: "farm_status",
    description: "Which Bramblebrook account this link belongs to, and when its farm was last saved online.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true },
  },
  {
    name: "load_farm",
    description: "Load this account's Bramblebrook farm save.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true },
  },
  {
    name: "save_farm",
    description: "Save this account's Bramblebrook farm. The game sends the moves played since its last save (sync); the server plays them through the game's rules and keeps the result. A whole farm (data) is no longer accepted.",
    inputSchema: {
      type: "object",
      properties: {
        sync: { type: "object", description: "The moves played since the last save, as the game sends them." },
        data: { type: "object", description: "Old games only: a whole farm. Refused now; reload the game." },
        summary: { type: "object", description: "Unused." },
        if_updated_at: { type: "string", description: "Unused." },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: true },
  },
  {
    name: "village",
    description: "This player's village: buildings, treasury, neighbours, notice board, their profiles and the village boss. If they have no village, the list of villages to join.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true },
  },
  {
    name: "village_action",
    description: "Do something in villages as this player: found, join, leave, give coins, raise a building, post on the board, promote a neighbour, set the motto, summon or attack the village boss, collect a boss reward; also world chat, follows, direct messages, notifications, sending feedback to the game's maker, reporting or blocking a player, and deleting this account.",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: VILLAGE_ACTIONS },
        args: { type: "object", description: "The action's arguments, named as the website's calls name them (p_name, p_village, p_amount, ...)." },
      },
      required: ["action"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  {
    name: "profiles",
    description: "Public profiles and online status for players (by id), and optionally this player's own profile settings.",
    inputSchema: {
      type: "object",
      properties: { ids: { type: "array", items: { type: "string" } }, me: { type: "boolean" } },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: "profile_update",
    description: "Update this player's public card or online-status privacy, or mark them online now.",
    inputSchema: {
      type: "object",
      properties: { public: { type: "object" }, show_online: { type: "boolean" }, touch: { type: "boolean" } },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
];

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const rpcError = (id: unknown, code: number, message: string) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });
const toolResult = (payload: Record<string, unknown>, text: string, isError = false) => ({
  content: [{ type: "text", text }],
  structuredContent: payload,
  ...(isError ? { isError: true } : {}),
});

async function sha256hex(s: string) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
}
// a game rule that said no (village full, not an elder...) comes back as ok:false with the reason, not as a fault
async function act(userId: string, action: string, args: Record<string, unknown> = {}) {
  const { data, error } = await admin.rpc("svc_act", { p_user: userId, p_action: action, p_args: args });
  if (error) return { ok: false, error: error.message };
  return { ok: true, result: data };
}

async function villageState(userId: string) {
  const { data: defs } = await admin.from("village_building_defs").select("*").order("sort");
  const { data: mine } = await admin.from("village_members").select("village_id, role").eq("user_id", userId).maybeSingle();
  if (!mine) {
    const r = await act(userId, "list_villages");
    return { defs: defs ?? [], mine: null, list: r.ok ? r.result : [] };
  }
  const id = mine.village_id;
  const [{ data: v }, { data: buildings }, { data: members }, { data: board }] = await Promise.all([
    admin.from("villages").select("*").eq("id", id).maybeSingle(),
    admin.from("village_buildings").select("building, level").eq("village_id", id),
    admin.from("village_members").select("user_id, role, contributed, joined_at").eq("village_id", id).order("contributed", { ascending: false }),
    admin.from("village_log").select("id, user_id, kind, body, amount, created_at").eq("village_id", id).order("created_at", { ascending: false }).limit(40),
  ]);
  const ids = [...new Set([...(members ?? []).map((m) => m.user_id), ...(board ?? []).map((b) => b.user_id)].filter(Boolean))];
  const ps = ids.length ? await act(userId, "get_profiles", { p_ids: ids }) : { ok: true, result: [] };
  const raid = await act(userId, "raid_status");
  return { defs: defs ?? [], mine, village: v, buildings: buildings ?? [], members: members ?? [], board: board ?? [], profiles: ps.ok ? ps.result : [], raid: raid.ok ? raid.result : null };
}

async function callTool(userId: string, name: string, args: Record<string, unknown>) {
  if (name === "farm_status") {
    const [{ data: p }, { data: s }] = await Promise.all([
      admin.from("profiles").select("username, farm_name").eq("id", userId).maybeSingle(),
      admin.from("saves").select("updated_at, summary").eq("user_id", userId).maybeSingle(),
    ]);
    const payload = { linked: true, user_id: userId, username: p?.username ?? null, farm_name: p?.farm_name ?? null, updated_at: s?.updated_at ?? null, summary: s?.summary ?? null };
    return toolResult(payload, `Linked to ${payload.username}. ${s ? "Last saved " + s.updated_at : "No farm saved yet."}`);
  }
  if (name === "load_farm") {
    const { data: s, error } = await admin.from("saves").select("data, summary, updated_at").eq("user_id", userId).maybeSingle();
    if (error) return toolResult({ error: "load_failed" }, "Could not load the farm.", true);
    if (!s) return toolResult({ found: false }, "No farm saved online yet.");
    return toolResult({ found: true, data: s.data, summary: s.summary, updated_at: s.updated_at }, `Loaded the farm saved ${s.updated_at}.`);
  }
  if (name === "save_farm") {
    // the farm is kept by the server now: only moves come in, never a whole farm
    if (!args.sync || typeof args.sync !== "object") return toolResult({ saved: false, reason: "reload" }, "This copy of the game is out of date. Reload it to keep saving.", true);
    const r = await syncFarm(admin, userId, args.sync, "Claude");
    return toolResult({ saved: r.status === 200 && !r.body.error, ...r.body }, r.status === 200 ? "Saved." : String(r.body.error || "Could not save."), r.status !== 200);
  }
  if (name === "village") {
    const st = await villageState(userId);
    return toolResult(st, st.mine ? `In ${st.village?.name}.` : "Not in a village yet.");
  }
  if (name === "village_action") {
    const action = String(args.action ?? "");
    if (!VILLAGE_ACTIONS.includes(action)) return toolResult({ ok: false, error: "Unknown village action." }, "Unknown village action.", true);
    const r = await act(userId, action, (args.args ?? {}) as Record<string, unknown>);
    return toolResult(r, r.ok ? "Done." : String(r.error));
  }
  if (name === "profiles") {
    const ids = Array.isArray(args.ids) ? (args.ids as unknown[]).map(String).slice(0, 100) : [];
    const out: Record<string, unknown> = {};
    if (ids.length) { const r = await act(userId, "get_profiles", { p_ids: ids }); out.profiles = r.ok ? r.result : []; if (!r.ok) out.error = r.error; }
    if (args.me) {
      const { data: me } = await admin.from("profiles").select("username, farm_name, public, show_online, last_seen").eq("id", userId).maybeSingle();
      out.me = me ?? null;
    }
    return toolResult(out, "Profiles loaded.");
  }
  if (name === "profile_update") {
    const patch: Record<string, unknown> = {};
    if (args.public && typeof args.public === "object" && !Array.isArray(args.public)) {
      if (JSON.stringify(args.public).length > MAX_CARD) return toolResult({ ok: false, error: "That card is too big." }, "That card is too big.", true);
      patch.public = args.public;
    }
    if (typeof args.show_online === "boolean") patch.show_online = args.show_online;
    if (Object.keys(patch).length) {
      const { error } = await admin.from("profiles").update(patch).eq("id", userId);
      if (error) return toolResult({ ok: false, error: error.message }, "Could not update the profile.", true);
    }
    if (args.touch) await act(userId, "touch_presence");
    return toolResult({ ok: true }, "Updated.");
  }
  return null;
}

async function handle(msg: Record<string, unknown>, userId: string) {
  const { id, method } = msg as { id?: unknown; method?: string };
  const params = (msg.params ?? {}) as Record<string, unknown>;
  if (id === undefined || id === null) return null; // notifications (initialized, cancelled) need no reply
  switch (method) {
    case "initialize":
      return { jsonrpc: "2.0", id, result: {
        protocolVersion: typeof params.protocolVersion === "string" ? params.protocolVersion : "2025-06-18",
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "bramblebrook-farm", title: "Bramblebrook Farm", version: "1.5.0" },
        instructions: "Loads and saves one player's Bramblebrook farm, and plays their village and profile. Used by the Bramblebrook game page.",
      } };
    case "ping":
      return { jsonrpc: "2.0", id, result: {} };
    case "tools/list":
      return { jsonrpc: "2.0", id, result: { tools: TOOLS } };
    case "tools/call": {
      const r = await callTool(userId, String(params.name ?? ""), (params.arguments ?? {}) as Record<string, unknown>);
      return r ? { jsonrpc: "2.0", id, result: r } : rpcError(id, -32602, "Unknown tool");
    }
    default:
      return rpcError(id, -32601, "Method not found");
  }
}

Deno.serve(async (req) => {
  if (req.method === "GET") return new Response("This connector answers MCP requests over POST.", { status: 405, headers: { Allow: "POST, DELETE" } });
  if (req.method === "DELETE") return new Response(null, { status: 204 });
  if (req.method !== "POST") return new Response(null, { status: 405, headers: { Allow: "POST, DELETE" } });

  const link = new URL(req.url).pathname.split("/").filter(Boolean).pop() ?? "";
  if (link.length < 24 || link === "farm-mcp") return json(rpcError(null, -32001, "This address is missing its private link. Copy it again from the game settings."), 401);
  const { data: row } = await admin.from("connector_links").select("user_id").eq("token_hash", await sha256hex(link)).maybeSingle();
  if (!row) return json(rpcError(null, -32001, "This link is no longer valid. Make a new one in the game settings."), 401);

  let body: unknown;
  try { body = await req.json(); } catch { return json(rpcError(null, -32700, "Parse error"), 400); }
  if (Array.isArray(body)) {
    const out = (await Promise.all(body.map((m) => handle(m as Record<string, unknown>, row.user_id)))).filter(Boolean);
    return out.length ? json(out) : new Response(null, { status: 202 });
  }
  const r = await handle(body as Record<string, unknown>, row.user_id);
  return r ? json(r) : new Response(null, { status: 202 });
});

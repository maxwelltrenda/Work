// Bramblebrook sync: the website and the app send the moves a player made; the server plays them through the
// game's own rules and keeps the result as the real farm (see ../_shared/farm.ts).
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { syncFarm } from "../_shared/farm.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false, autoRefreshToken: false } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const { data: auth } = await admin.auth.getUser(token);
  const user = auth?.user;
  if (!user) return json({ error: "Sign in first." }, 401);
  let body: unknown;
  try { body = await req.json(); } catch { return json({ error: "Bad request." }, 400); }
  const r = await syncFarm(admin, user.id, body, (req.headers.get("user-agent") || "").slice(0, 60));
  return json(r.body, r.status);
});

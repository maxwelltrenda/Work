// Bramblebrook sign-up: a username and password, no email.
// Players sign in afterwards with the normal password login, using the address this returns.
// Limits: 5 accounts an hour from one network (the address is kept only as a salted hash, for a day) and
// 300 an hour across everyone; usernames go through the same word filter as chat.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

async function sha256hex(s: string) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "Bad request." }, 400); }

  const username = String(body.username ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");
  const farm = String(body.farm ?? "").trim().slice(0, 40);
  if (!/^[a-z0-9_]{3,20}$/.test(username)) return json({ error: "Usernames are 3 to 20 letters, numbers or underscores." }, 400);
  if (password.length < 8 || password.length > 72) return json({ error: "Passwords need 8 to 72 characters." }, 400);
  if (password.toLowerCase() === username || /^(password|12345678|qwertyui)/i.test(password)) return json({ error: "Pick a password that is harder to guess." }, 400);

  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, key, { auth: { persistSession: false, autoRefreshToken: false } });

  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || req.headers.get("x-real-ip") || "unknown";
  const ipHash = await sha256hex(ip + "|bramblebrook|" + key.slice(-16));
  const { data: allowed, error: lerr } = await admin.rpc("signup_allowed", { p_ip_hash: ipHash });
  if (lerr) return json({ error: "Could not create the account. Try again in a moment." }, 503);
  if (!allowed) return json({ error: "Too many new accounts from here. Please try again in an hour." }, 429);

  const { data: nameOk } = await admin.rpc("username_ok", { p_username: username });
  if (nameOk === false) return json({ error: "Please pick a different username." }, 400);

  const { data: taken } = await admin.from("profiles").select("id").eq("username", username).maybeSingle();
  if (taken) return json({ error: "That username is taken." }, 409);

  // a reserved address that can never receive mail; nothing is ever sent to it
  const email = `${username}@players.bramblebrook.invalid`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { username } });
  if (error || !data.user) {
    const dup = /already|registered|exists/i.test(error?.message ?? "");
    return json({ error: dup ? "That username is taken." : "Could not create the account. Try again in a moment." }, dup ? 409 : 400);
  }
  const { error: perr } = await admin.from("profiles").insert({ id: data.user.id, username, farm_name: farm || null });
  if (perr) {
    await admin.auth.admin.deleteUser(data.user.id);
    return json({ error: perr.code === "23505" ? "That username is taken." : "Could not create the account. Try again in a moment." }, 400);
  }
  return json({ ok: true, email });
});

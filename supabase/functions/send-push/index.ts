// Sends push notifications for new sign-outs / returns. The database calls
// this after each new notification; it claims whatever hasn't been pushed yet
// (so extra calls do nothing) and sends each one to the admins' devices.
// The signing keys live in the push_config table (service role only).
import webpush from 'npm:web-push@3.6.7';
import { createClient } from 'npm:@supabase/supabase-js@2.58.0';

const SITE_URLS: Record<string, string> = {
  facilities: 'https://shop-inventory-one-omega.vercel.app',
  events: 'https://mercy-culture-events.vercel.app',
  media: 'https://mercy-culture-media-gear.vercel.app',
};

const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
let keysReady = false;
async function setKeys() {
  if (keysReady) return;
  const { data, error } = await sb.rpc('push_vapid_keys');
  if (error || !data) throw new Error(error?.message || 'No push keys in push_config');
  webpush.setVapidDetails(SITE_URLS.facilities, data.public, data.private);
  keysReady = true;
}

type Sub = { id: number; endpoint: string; p256dh: string; auth: string; site: string };
type Note = { id: number; site: string; kind: string; title: string; body: string | null; subs: Sub[] };

Deno.serve(async () => {
  try { await setKeys(); } catch (e) { return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500 }); }
  const { data, error } = await sb.rpc('claim_push_batch');
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  const notes = (data || []) as Note[];
  const dead = new Set<number>();
  let sent = 0;
  await Promise.all(notes.flatMap((n) => n.subs.map(async (s) => {
    if (dead.has(s.id)) return;
    // Open the app the device turned push on from; it shows every site the admin can see.
    const url = `${SITE_URLS[s.site] || SITE_URLS.facilities}/#/notifications`;
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify({ title: n.title, body: n.body || '', url, tag: `n${n.id}` }), { TTL: 86400, urgency: 'normal' });
      sent++;
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) dead.add(s.id);   // the device turned push off or the app was removed
      else console.error('push failed', code, (e as Error).message);
    }
  })));
  for (const id of dead) await sb.rpc('drop_push_subscription_by_id', { p_id: id });
  return new Response(JSON.stringify({ notifications: notes.length, sent, removed: dead.size }), { headers: { 'Content-Type': 'application/json' } });
});

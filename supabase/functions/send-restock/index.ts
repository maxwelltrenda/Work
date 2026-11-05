// Emails restock alerts. The database calls this after each new alert; it
// claims whatever hasn't been sent yet and emails the right people through
// Resend. The Resend key and sender address live in the email_config table
// (service role only); until that's filled in, alerts simply wait.
import { createClient } from 'npm:@supabase/supabase-js@2.58.0';

const SITE_URLS = {
  facilities: 'https://shop-inventory-one-omega.vercel.app',
  events: 'https://mercy-culture-events.vercel.app',
};
const AREA: Record<string, string> = { facilities: 'Facilities stock', maintenance: 'Maintenance stock', paint: 'Paint', events: 'Event stock' };

const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const num = (n: number) => String(Number(Number(n).toFixed(2)));

type Alert = { id: number; level: number; name: string; code: string; category: string; reorder: number; location: string | null; item_id: string; to: string[] };

Deno.serve(async () => {
  const { data, error } = await sb.rpc('claim_restock_batch');
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  const cfg = data?.config as { key: string; from: string } | null;
  const alerts = (data?.emails || []) as Alert[];
  if (!cfg) return new Response(JSON.stringify({ waiting: 'no email_config yet' }));
  let sent = 0;
  for (const a of alerts) {
    if (!a.to.length) continue;
    const unit = a.category === 'paint' ? ' gal' : '';
    const area = AREA[a.category] || 'Stock';
    const url = `${a.category === 'events' ? SITE_URLS.events : SITE_URLS.facilities}/#/item/${a.item_id}`;
    const subject = `Restock: ${a.name} (${num(a.level)}${unit} left)`;
    const text = `${a.name} needs restocking.\n\n${area} · ${a.code}\nOn hand: ${num(a.level)}${unit}\nReorder level: ${num(a.reorder)}${unit}${a.location ? `\nLocation: ${a.location}` : ''}\n\nOpen it: ${url}\n\nYou get this because you manage ${area.toLowerCase()} in the Mercy Culture inventory app.`;
    const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#0f0f0f;max-width:520px">
      <p style="font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#6b6b6b;margin:0 0 6px">${esc(area)} · ${esc(a.code)}</p>
      <h1 style="font-size:22px;margin:0 0 14px">${esc(a.name)} needs restocking</h1>
      <table style="border-collapse:collapse;margin-bottom:18px">
        <tr><td style="padding:4px 16px 4px 0;color:#6b6b6b">On hand</td><td style="padding:4px 0"><b style="color:#b3261e">${num(a.level)}${unit}</b></td></tr>
        <tr><td style="padding:4px 16px 4px 0;color:#6b6b6b">Reorder level</td><td style="padding:4px 0">${num(a.reorder)}${unit}</td></tr>
        ${a.location ? `<tr><td style="padding:4px 16px 4px 0;color:#6b6b6b">Location</td><td style="padding:4px 0">${esc(a.location)}</td></tr>` : ''}
      </table>
      <a href="${url}" style="display:inline-block;background:#11404b;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:bold">Open in the app</a>
      <p style="font-size:12px;color:#6b6b6b;margin-top:24px">You get this because you manage ${esc(area.toLowerCase())} in the Mercy Culture inventory app.</p></div>`;
    // One email per person, so nobody sees the others' addresses.
    const res = await fetch('https://api.resend.com/emails/batch', {
      method: 'POST',
      headers: { Authorization: `Bearer ${cfg.key}`, 'Content-Type': 'application/json', 'Idempotency-Key': `restock-${a.id}` },
      body: JSON.stringify(a.to.map((to) => ({ from: cfg.from, to: [to], subject, text, html }))),
    });
    if (res.ok) sent += a.to.length;
    else {
      const msg = `${res.status} ${await res.text()}`;
      console.error('restock email failed', a.id, msg);
      await sb.rpc('restock_email_failed', { p_id: a.id, p_error: msg });
    }
  }
  return new Response(JSON.stringify({ alerts: alerts.length, sent }), { headers: { 'Content-Type': 'application/json' } });
});

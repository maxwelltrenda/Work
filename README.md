# Shop Inventory & Tool Sign-Out

A private web app for your team that does two things:

1. **Inventory**: scan consumables in and out, see what's on hand, and get flagged when something drops to its reorder level.
2. **Tool sign-out**: scan a name label and a tool to sign it out, and scan the tool again to return it. You always know who has what.

It works with any USB or Bluetooth barcode scanner (they act like a keyboard) and prints its own Code 128 barcode labels on a label printer.

## How it's built

- `web/`: the whole front end (plain HTML/JS, no build step). Hosted on Vercel.
- `supabase/migrations/`: the database. Hosted on Supabase, which also handles logins.
- Only people on the **People** list (matched by login email) can see or change anything. This is enforced inside the database, not just in the page.
- Stock counts and tool status can only change through scans, so every change is in the history with who did it and when.

## Barcodes

| Prefix | What | Example |
|---|---|---|
| `INV-` | Inventory item | `INV-0001` |
| `TL-` | Tool | `TL-0001` |
| `P-` | Person (name label, since there are no ID badges) | `P-001` |
| `CMD-` | Mode switches: `CMD-IN`, `CMD-OUT`, `CMD-COUNT`, `CMD-DONE` | |

Codes are assigned automatically when you add something. Print them from the **Labels** page.

## Day-to-day use

**Scan Stock**: pick **Scan IN** or **Scan OUT** (or scan a `CMD-IN` / `CMD-OUT` label), type a quantity if it isn't 1, and scan the item. Admins also get **Set COUNT** for cycle counts.

**Check In / Out** (what the warehouse iPad shows):
- *Taking tools:* scan your name label, then scan each tool. If you scan a tool first, it asks who's taking it.
- *Returning:* scan the tool, then press Enter (or scan it again) for "Good", or tap Damaged / Needs repair. Damaged tools are blocked from sign-out until an admin marks them available.
- Scan `CMD-DONE` or tap **Done** when you're finished. It also clears itself after 2 idle minutes.

**Who Has What**: everything signed out, grouped by person, with overdue items highlighted.

## Warehouse iPad (shared kiosk)

Mount an iPad in the warehouse and leave it signed in to a **kiosk** login, so nobody needs their own device.

1. On **People**, add a person like "Warehouse iPad" with its own email (a shared or alias inbox works) and role **Kiosk**.
2. On the iPad, open the app in Safari, create the account with that email, and sign in. Then tap Share → **Add to Home Screen** so it opens full-screen.
3. Pair the barcode scanner with the iPad over Bluetooth. iPadOS treats it as a keyboard, which also hides the on-screen keyboard.
4. Optional: turn on **Guided Access** (Settings → Accessibility) to lock the iPad to this app.

At the iPad:
- **Taking anything:** scan your name label (or tap your name), choose **Shop use** or an event, then scan tools and items. Tap **Done** or scan `CMD-DONE` when finished. It also clears itself after 90 idle seconds.
- **Returning a tool:** just scan it, no name needed. If it's damaged, tap **Damaged** or **Needs repair** and it's blocked from going out until an admin clears it.
- **Putting stock back:** scan your name, tap **Putting back**, and scan.

The kiosk login can check things in and out and plan events. It can't edit items, tools, people or counts. Admins do that from their own login on any other device.

## Offsite events

On **Events**, create the event (name, place, dates, crew). At the iPad, pick the event under "Where is it going?" and scan everything going on the truck. When it comes back, scan the tools in and put leftover stock back with the event selected. The event page shows:
- every tool sent and whether it's back, with a **Mark lost** button for anything that isn't
- stock taken, brought back, and actually used
- a CSV export, and **Close event** when you're done

Tools sent to an event are due back the day after the event ends, so late ones show as overdue on **Who Has What**.

## First-time setup

1. Create a Supabase project and run `supabase/migrations/0001_init.sql` in its SQL editor.
2. In Supabase → Authentication → URL Configuration, set **Site URL** to the app's web address. Confirmation and password-reset emails link there.
3. Put the project URL and publishable key in `web/config.js` and deploy the `web/` folder to Vercel (or any static host).
4. Open the app, create an account, and the first person to sign in becomes the admin.
5. On **People**, add your team. Anyone with an email can create an account with that email. People without an email can still borrow tools with their name label.
6. Add items and tools, then print labels.

### Label printer tips (Brother QL-820NWB)
- The Labels page defaults to **Brother DK-1201 (1.1" × 3.5")**, the roll currently loaded. Other DK sizes and Dymo/Zebra sizes are in the list.
- Install the Brother QL-820NWB driver on the computer that prints (USB or Wi-Fi both work).
- In the browser print dialog, choose the Brother printer. Under *More settings*, set paper size to **29mm × 90mm** (DK-1201), margins to **None**, scale to **100%**, and turn off headers and footers. Chrome remembers these after the first time.
- Most scanners send Enter after each scan by default. If yours sends Tab, switch it to Enter using the setup barcodes in its manual.

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

**Tool Sign-Out** (good to leave open on a shop computer):
- *Taking tools:* scan your name label, then scan each tool. If you scan a tool first, it asks who's taking it.
- *Returning:* scan the tool, then press Enter (or scan it again) for "Good", or tap Damaged / Needs repair. Damaged tools are blocked from sign-out until an admin marks them available.
- Scan `CMD-DONE` or tap **Done** when you're finished. It also clears itself after 2 idle minutes.

**Who Has What**: everything signed out, grouped by person, with overdue items highlighted.

## First-time setup

1. Create a Supabase project and run `supabase/migrations/0001_init.sql` in its SQL editor.
2. In Supabase → Authentication → URL Configuration, set **Site URL** to the app's web address. Confirmation and password-reset emails link there.
3. Put the project URL and publishable key in `web/config.js` and deploy the `web/` folder to Vercel (or any static host).
4. Open the app, create an account, and the first person to sign in becomes the admin.
5. On **People**, add your team. Anyone with an email can create an account with that email. People without an email can still borrow tools with their name label.
6. Add items and tools, then print labels.

### Label printer tips
- Pick your label size on the Labels page (Dymo 30334, Zebra 2×1, and others).
- In the browser print dialog, choose the label printer, set the paper size to match, set margins to **None**, and set scale to **100%**.
- Most scanners send Enter after each scan by default. If yours sends Tab, switch it to Enter using the setup barcodes in its manual.

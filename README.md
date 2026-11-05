# Mercy Culture Facilities, Events & Media Gear

**Live sites:** Facilities https://shop-inventory-one-omega.vercel.app · Events https://mercy-culture-events.vercel.app · Media Gear https://mercy-culture-media-gear.vercel.app

A private web app for your team that tracks five things:

1. **Facilities stock**: supplies for the building. Scan them in and out, see what's on hand, and get flagged when something drops to its reorder level.
2. **Maintenance stock**: supplies for maintenance work (degreaser, caulk, filters…). Same scanning and reorder flags, with its own `MNT-` labels.
3. **Paint**: one entry per color (`PNT-` labels), marked **Interior**, **Exterior** or **Roof** and with its **sheen** (Flat, Matte, Eggshell, Satin, Semi-Gloss, Gloss). Each can is tracked by size (1 or 5 gallons) and how full it is (full, ¾, ½, ¼), and they all add up to the color's total gallons.
4. **Event stock**: supplies that go out to events. Same scanning, and each event shows what was taken, brought back and used.
5. **Tools**: scan a name label and a tool to sign it out, and scan the tool again to return it. You always know who has what.

Facilities and maintenance stock can have a **cost** (per box/pack, or per item if it isn't sold in packs). Each list then shows the cost, the value of what's on hand, and a total value. Maintenance stock also has a **category** (Plumbing, Electrical, Paint & Caulk…) you can filter by. Type a new category to add one.

Stock is counted in single pieces. An item can have a **per box/pack** number (e.g. lights that come 3 to a pack), and lists show the count both ways: "7 (2 boxes + 1 single)". Items sold in packs get two labels: the item code (e.g. `FAC-0001`) for a **single** and `FAC-0001-BOX` for a **whole box**. Scanning the box label opens the pop-up set to **Box**, and the single label sets it to **Single**. Put single labels on closet bins and box labels on warehouse shelves. The Labels page lists both, and an item's **Print label** picks both. The pop-up also has **Box of 3** / **Single** buttons, so the same barcode works for pulling a whole box in the warehouse or one at a time from a closet. The Scan Stock page has the same **Singles / Boxes** choice. Reorder levels are in pieces, and cost is per box/pack.

It works with any USB or Bluetooth barcode scanner (they act like a keyboard) and prints its own Code 128 barcode labels on a label printer.

## Three sites, one app

The same app is served at three web addresses, each showing only its own things and branded for Mercy Culture:

| Site | What it's for | Who uses it |
|---|---|---|
| **Facilities** | Check In / Out, Stock (Facilities, Maintenance, Paint), Tools. Everything else is under one **Admin** / **More** menu. | Facilities roles below |
| **Events** | Check In / Out, Events (offsite events: crew, what went out, what came back), Decor, Event stock. | People with **Events** access |
| **Media Gear** (Mercy Culture Media) | Signing camera gear out and back in, reservations, and battery / card checks on return. | People with **Media** access |

The site is picked from the address (a host name containing "events" or "media"), or forced with `?site=facilities|events|media`. Fill in `SITE_URLS` in `web/config.js` so the menus link between them.

One **People** list covers all three. Each person has:
- **Facilities** access: No access, Facilities & Maintenance, Maintenance manager, Custodian, View only, Admin (or Shared iPad for the iPad login).
- **Media Gear** access: No access, Team (sign out & reserve) or Admin (full Media access).
- **Events** access: No access, Team (plan & run events) or Admin (full Events access).

Admins can use everything on all three sites. A **Media admin** or **Events admin** has full access on their own site only, and their People page shows only their own team: they can add people (an email already on the list just joins the team), change their team access, and remove them from the team. They can't change Facilities access, other teams, or the name and email of someone who also uses other sites. The People page shows each person's access as colored tags, with filters (Everyone, Facilities, Media, Events, Admins, Can't sign in, Deactivated).

**Media gear** works like tools, with `MED-` labels and photos. Returning gear asks: *Batteries charged? Cards offloaded? Anything wrong?* Gear that came back flat or with footage on the card is flagged on the Gear list. **Reservations** book gear for dates. Double-booking is refused, and anyone signing out gear someone else reserved today sees a warning.

**Events decor** works like tools too, with `EVD-` labels, quantities (one barcode for 40 charger plates), photos and its own categories. **Event stock** (`EVS-` labels) is counted and taken like Facilities stock, on the Events site. Events team members sign decor out/in and take stock; Events admins also add and edit decor, stock and decor categories.

**Notifications.** Admins get a bell in the top corner listing every sign-out and return, with a count of new ones and a full list at *See all*. Full admins see all three sites; a Media admin sees Media gear; an Events admin sees Events decor. Each device can turn on **push notifications** from the bell. On iPhone/iPad, push only works once the app is added to the Home Screen and opened from there (iOS 16.4 or later). Pushes are sent by the `send-push` Supabase Edge Function (`supabase/functions/send-push`). The signing keys live in the `push_config` table, which only that function can read, and the public half is `VAPID_PUBLIC_KEY` in `web/config.js`.

Printed labels come out in alphabetical order.

## How it's built

- `web/`: the whole front end (plain HTML/JS, no build step). Hosted on Vercel.
- `supabase/migrations/`: the database. Hosted on Supabase, which also handles logins.
- Only people on the **People** list (matched by login email) can see or change anything. This is enforced inside the database, not just in the page.
- Stock counts and tool status can only change through scans, so every change is in the history with who did it and when.

## Barcodes

| Prefix | What | Example |
|---|---|---|
| `FAC-` | Facilities stock item | `FAC-0001` |
| `MNT-` | Maintenance stock item | `MNT-0001` |
| `PNT-` | Paint color | `PNT-0001` |
| `EVS-` | Event stock item | `EVS-0001` |
| `TL-` | Tool | `TL-0001` |
| `P-` | Person name label (optional; people can also just tap their name) | `P-001` |
| `CMD-` | Mode switches: `CMD-IN`, `CMD-OUT`, `CMD-COUNT`, `CMD-DONE` | |

Codes are assigned automatically when you add something. Print them from the **Labels** page.

## Day-to-day use

**Scan Stock**: pick **Scan IN** or **Scan OUT** (or scan a `CMD-IN` / `CMD-OUT` label), type a quantity if it isn't 1, and scan the item. Admins also get **Set COUNT** for cycle counts.

**Check In / Out** (what the warehouse iPad shows). On your own login it assumes it's you, so you can scan straight away. On the shared kiosk login, people tap their name first:
- *Taking tools:* scan your name label, then scan each tool. If you scan a tool first, it asks who's taking it.
- *Returning:* scan the tool, then press Enter (or scan it again) for "Good", or tap Damaged / Needs repair. Damaged tools are blocked from sign-out until an admin marks them available.
- Scan `CMD-DONE` or tap **Done** when you're finished. It also clears itself after 2 idle minutes.

**Categories**: tool and maintenance categories are an editable list on the **Categories** page (admins). Add, rename or delete them there. Renaming updates every tool or item in that category, renaming onto an existing name merges the two, and deleting leaves those tools or items with no category. Item and tool forms pick from the list, and admins can add a new one right from the dropdown.

**Tool quantity**: one tool barcode can stand for several of the same tool (e.g. Hammer, quantity 6). Scanning it at the iPad opens a pop-up showing how many are in and who has the rest, with **Return 1** / **Return all** buttons for each person, plus **How many?** and **Where are they going?** for taking some. Scan it again to add one more. One-of-a-kind tools work exactly as before.

**Tool categories**: give each tool a category (Power Tools, Hand Tools, Ladders & Lifts…) when adding or editing it. Type a new one to add it. The Tools list has a Category column and filter.

**Photos**: tools and stock items can both have a photo. On a tool's or item's page, admins tap **Add photo** to take a picture or pick one (on an iPad or phone this opens the camera), or attach one when adding it. Photos are shrunk before upload and show on the page, as thumbnails in the lists, and in the iPad pop-ups when scanned, so people can see they grabbed the right thing. Photos are private to the team, and each role only sees photos for what it can see.

**Who Has What**: everything signed out, grouped by person, with overdue items highlighted.

## Roles

| Role | Sees | Can change things |
|---|---|---|
| **Admin** | Everything | Yes: edits, scans, labels, people, locations |
| **Kiosk** | Check In / Out, Who Has What, Events | Scans and check-ins/outs for whoever taps their name |
| **Facilities & Maintenance** (member) | Facilities and maintenance stock, paint, tools, and their history | Scans their own area: tools, facilities and maintenance stock, paint |
| **Maintenance manager** | Maintenance stock, paint, tools, Who Has What, and their history | Scans their own area: checks tools out and in, takes and puts back maintenance stock and paint. Can also add and edit paint colors (details, photo, cans) |
| **Custodian manager** | Facilities stock and its history | Scans their own area: takes and puts back facilities stock |
| **Oversight** | Everything we have, where it is, all check-ins/outs | View only |

These rules are enforced in the database, not just hidden on screen. Editing items, counts, people and settings is admin-only. Anyone on the team list can still check things out at the warehouse iPad by tapping their name.

**Phone camera:** on your own login, **Check In / Out** has **Scan with camera**, which turns any phone or tablet camera into a barcode scanner with nothing to install. The first time, the browser asks for camera permission. The shared kiosk login has no camera button; it uses the barcode scanner only.

## Warehouse iPad (shared kiosk)

Mount an iPad in the warehouse and leave it signed in to a **kiosk** login, so nobody needs their own device.

1. On **People**, add a person like "Warehouse iPad" with its own email (a shared or alias inbox works) and role **Kiosk**.
2. On the iPad, open the app in Safari, create the account with that email, and sign in. Then tap Share → **Add to Home Screen** so it opens full-screen.
3. Pair the barcode scanner with the iPad over Bluetooth. iPadOS treats it as a keyboard, which also hides the on-screen keyboard.
4. Optional: turn on **Guided Access** (Settings → Accessibility) to lock the iPad to this app.

At the iPad:
- **Taking a tool:** tap your name (or scan your name label), then scan the tool. A pop-up asks **Where is it going?**: tap a place or an offsite event (admins can **+ Add place**). The last place you used is highlighted, so pressing Enter or scanning the tool again uses it.
- **Returning a tool:** just scan it, no name needed. A pop-up asks if anything is wrong. **No, it's fine** is the default (Enter or scan it again). **Damaged** or **Needs repair** blocks it from going out until an admin clears it.
- **Stock:** scan the item. A pop-up asks **How many?** (type a number, use − / +, or scan the same item again to add one) and **Where is it going?**, then tap **Take** or **Put back**. The printed `CMD-OUT` / `CMD-IN` labels do the same as Take / Put back, and `CMD-DONE` cancels.
- **Paint:** scan the color's label. The pop-up shows its gallons and cans. **Take**: pick which can (from what's on hand), how many, and where it's going. **Put back**: pick the can size and how full it is (Full, ¾, ½, ¼). A used can counts toward the total by how full it is (a 5-gal at ½ = 2.5 gal). Admins enter starting cans and corrections on the color's page.
- Tap **Done** or scan `CMD-DONE` when finished. It also clears itself after 90 idle seconds.

The kiosk login can check things in and out and plan events. It can't edit items, tools, people or counts. Admins do that from their own login on any other device.

## Offsite events

On **Events**, create the event (name, place, dates, crew). At the iPad, pick the event under "Where is it going?" and scan everything going on the truck. When it comes back, scan the tools in and put leftover stock back with the event selected. The event page shows:
- every tool sent and whether it's back, with a **Mark lost** button for anything that isn't
- stock taken, brought back, and actually used
- a CSV export, and **Close event** when you're done

Tools sent to an event are due back the day after the event ends, so late ones show as overdue on **Who Has What**.

## First-time setup

1. Create a Supabase project and run the files in `supabase/migrations/` in order in its SQL editor.
2. In Supabase → Authentication → URL Configuration, set **Site URL** to the app's web address. Confirmation and password-reset emails link there.
3. Put the project URL and publishable key in `web/config.js` and deploy the `web/` folder to Vercel (or any static host).
4. Open the app, create an account, and the first person to sign in becomes the admin.
5. On **People**, add your team. Anyone with an email can create an account with that email. People without an email can still borrow tools with their name label.
6. Add items and tools, then print labels.

### Label printer tips (Brother QL-820NWB)
- The Labels page defaults to the **62mm continuous roll (DK-2205 / DK-2251)** that ships with the QL-820NWB, printing compact 2.4" × 1.25" labels. If you load a different roll, pick it in **Label size**. 29mm continuous and the pre-cut DK sizes are listed. The roll's DK number is printed on the side of the spool.
- **Print labels** opens a PDF with one label per page, sized exactly to the label (3.5" × 1.1" for DK-1201), with the barcode drawn as sharp vector bars. Browsers ignore label sizes when printing a web page directly and print a letter-size page instead, which feeds about a foot of label tape. A PDF's page size is always respected.
- **Mac / PC:** install the Brother QL-820NWB driver (USB or Wi-Fi). The print dialog opens automatically. Choose the Brother printer, set paper to **29mm × 90mm**, and set scale to **100% / Actual size**, not "Fit".
- **iPad:** Safari only prints over Wi-Fi (AirPrint). Bluetooth pairing isn't used, so put the printer on the same Wi-Fi as the iPad. Tap **Print labels**, then the Share button on the PDF, then **Print**.
- Most scanners send Enter after each scan by default. If yours sends Tab, switch it to Enter using the setup barcodes in its manual.

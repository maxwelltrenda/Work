# Operations (preview)

A clickable preview of the Operations site for Skyler: where people are, every
operations team at a glance, asking someone on his teams for something, the one
request form for the whole church, and hopping into the Facilities, Events and
Media sites.

- Static page, no login, no database. It loads the shared `style.css` and logo
  from the Facilities site so it looks the same.
- Facilities requests and the custodial checklist are real items from the Monday
  boards (no requester names, emails or phone numbers). Events and Media items
  are examples. Changes are kept in the visitor's browser only.
- Deployed as its own Vercel project (`mercy-culture-operations`, root directory
  `operations/`).

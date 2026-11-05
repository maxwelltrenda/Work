// Supabase project connection. The publishable key is meant to be public:
// all data is protected by Row Level Security in the database.
export const SUPABASE_URL = 'https://cwuzlpgicxymezvghqgn.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_c3mCo75lLLKpFX6AjKMv5A_K08DqCUq';
export const APP_NAME = 'Shop Inventory';

// The same app is served at three web addresses. Each one shows only its own
// site; the address decides which ("media" or "event" in the host name), and
// ?site=facilities|events|media overrides it. Fill these in so the menus can
// link between the sites.
export const SITE_URLS = {
  facilities: 'https://shop-inventory-one-omega.vercel.app',
  events: 'https://mercy-culture-events.vercel.app',
  media: 'https://mercy-culture-media-gear.vercel.app',
};

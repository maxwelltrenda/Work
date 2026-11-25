# Bramblebrook Farm on the App Store

The app is in `bramblebrook/app`: the same game as the website, bundled inside a Capacitor 8 shell so it works
offline. Codemagic builds it (no Mac needed); `codemagic.yaml` is at the repo root.

## What is already done

- **The app shell**: `app/ios` (bundle id `com.bramblebrook.farm`, iPhone only, portrait, dark launch screen,
  1024px icon with no transparency, "no non-exempt encryption" set so export questions are skipped).
- **Account deletion in the app** (guideline 5.1.1(v)): Bag › Settings › Safety & privacy › Delete my account.
- **Chat safety** (guideline 1.2, apps with user content): a word filter on the server, Report and Block on
  every message (the ⋯) and every profile, terms agreed at sign-up with zero tolerance for abuse, and a reports
  tab in the owner's inbox (remove, mute 7 days, ban). Apple expects reports to be acted on within 24 hours.
- **Privacy policy, terms, help**: https://bramblebrook-farm.vercel.app/privacy, /terms, /support.
- **Security**: see `../security.md`.

## What only the owner can do, in order

1. **Apple Developer**: Certificates, Identifiers & Profiles › Identifiers › + › App ID `com.bramblebrook.farm`
   (no extra capabilities needed).
2. **App Store Connect**: Apps › + › New App. Name "Bramblebrook Farm", bundle id above, SKU `bramblebrook`,
   primary language English.
3. **Codemagic**: add the `maxwelltrenda/Work` repository as an app; it finds `codemagic.yaml`. The App Store
   Connect key named `codemagic` (already used by Trenda RS) works if both apps are on the same Apple team.
   Start the "Bramblebrook iOS (App Store)" workflow; the build lands in TestFlight.
4. **Fill in the listing** from `listing.md`, the privacy answers from `privacy.md`, and the review notes from
   `review-notes.md`. Screenshots are in `screenshots/`.
5. **Support email**: put an address in `bramblebrook/support-email.txt` (one line) and it appears on the help
   page. Apple asks for contact details for apps with chat.
6. **Art licences**: confirm the CraftPix and Nine Realms licences allow use in a published mobile app, and keep
   the receipts. While the repo is public, the bought art in it is downloadable by anyone; making the repo
   private fixes that.
7. **Submit for review.**

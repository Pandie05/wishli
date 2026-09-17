# wishli

A wishlist app: create wishlists, add items, share them with friends, and let people mark things purchased without spoiling the surprise.

## Stack

- [React](https://react.dev/) + TypeScript, built with [Vite](https://vite.dev/)
- [React Router](https://reactrouter.com/) for routing
- [Supabase](https://supabase.com/) — Postgres database, auth, storage, and two edge functions
- [oxlint](https://oxc.rs/docs/guide/usage/linter.html) for linting

## Getting started

```
npm install
npm run dev
```

The app needs a Supabase project to talk to — see **Supabase setup** below before the first run, or auth/data calls will fail.

Other scripts:

```
npm run build     # typecheck + production build
npm run preview   # preview a production build locally
npm run lint      # oxlint
```

## Supabase setup

Make a file named `.env` in the repo root, next to `package.json`:

```
package.json
.env          <- here
src/
```

Put this in it:

```
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

Get both values from your Supabase project under **Project Settings**:

- **URL** — Data API → Project URL
- **Key** — API Keys → the `anon` / public key

Then restart the dev server.

### Database schema

The database has no separate migration tool — `sql-queries/` holds the schema and RLS policies as plain numbered `.sql` files. Run them in order, once, in the Supabase dashboard's **SQL Editor**:

```
sql-queries/
  001_create_users_table.sql
  002_wishlists_rls.sql
  003_items_rls.sql
  004_friends_and_sharing.sql
  005_account_settings.sql
  006_purchase_visibility.sql
  007_notifications.sql
  008_item_priority_rename.sql
  009_claims_editors_contributions.sql
  010_fix_contribution_and_item_gaps.sql
  011_wishlist_details_and_uploads.sql
  012_wishlist_description.sql
  013_avatars_sharing_and_reminders.sql
  014_drop_unused_verification_codes.sql
  015_item_quantity_and_claims.sql
  016_public_profiles.sql
```

Each file is safe to re-run (everything is `if not exists` / `or replace`), so if you're not sure what's already applied, running the whole sequence again won't break anything.

The one file to read before running is `015`: it moves reservations out of `items.claimed_by` into a new `item_claims` table and then **drops** `claimed_by`/`claimed_at`. Existing reservations are copied across first, and a second run skips the copy rather than failing — but those two columns do not come back.

### Edge functions

Two Deno functions in `supabase/functions/`, deployed separately from the rest of the app:

```
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase functions deploy fetch-link-preview
npx supabase functions deploy send-date-reminders
```

- **`fetch-link-preview`** — auto-fills an item's name/price/image from a pasted product URL. The app works without it, the "Fetch details" button just won't return anything until it's deployed.
- **`send-date-reminders`** — scans for wishlists whose target date is coming up and notifies the owner. It reads `SUPABASE_SERVICE_ROLE_KEY`, which Supabase auto-injects into every edge function (the `SUPABASE_` prefix is reserved — you can't set it yourself, the dashboard/CLI will reject it) — no extra setup needed for that part. It scans across every account, which is why it needs that elevated key rather than running under any single user's normal access. Triggered daily by `.github/workflows/date-reminders.yml`, which needs the same `SUPABASE_URL`/`SUPABASE_KEY` repo secrets the existing keepalive workflow already uses.

## What's in the app

- **Auth** — email/password and Google sign-in
- **Dashboard** — your wishlists and the ones shared with you, with budget-vs-spent tracking, search, and sorting (including by soonest upcoming date)
- **Wishlist detail** — add/edit/delete items, mark purchased, occasion + target date, and a "how many" count so several people can each reserve part of one wish
- **Friends** — send/accept/decline friend requests, resend after a decline
- **Sharing** — share a wishlist with a friend; they can view and mark items purchased, but can't edit the list unless made an editor. The owner can choose whether they see exactly what's been claimed or just a count, so a shared wishlist can still be a surprise
- **Share links** — a read-only public link per wishlist, shown with a QR code so a room can open it without typing anything. No account needed to look, still needed to reserve
- **Public profile** — opt-in page at `/u/<username>` listing only the wishlists you have already turned link-sharing on for
- **Notifications** — friend requests, accepted requests, being added to a wishlist, items getting claimed, and upcoming target dates
- **Settings** — profile picture, username, email, password, and the public-profile switch
- **Installable** — ships a web app manifest and a service worker, so it can be added to a phone home screen and opens without browser chrome

## Notes

- Requires Node 20.19+ or 22.12+. It'll run on older Node 20.18 with a warning, but that's unsupported territory.
- On Windows, `npm install` can intermittently fail to pull in the native `@rolldown/binding-win32-x64-msvc` binary Vite needs (a known npm bug with optional dependencies), and `npm run dev` then fails with `'vite' is not recognized`. It isn't pinned as a direct dependency — that fixes Windows but breaks `npm install` on Vercel's Linux builds outright (an explicit non-Windows dependency triggers a hard `EBADPLATFORM` error rather than a skip). If you hit this, delete `node_modules` and `package-lock.json` and reinstall, sometimes twice.
- The service worker only precaches the app shell (JS/CSS/HTML/fonts), never Supabase responses — so offline the app opens instantly and then has no data to show. Real offline browsing would need cached API responses plus a write queue and conflict resolution, which is deliberately out of scope. The service worker is only built by `npm run build`, so `npm run dev` is unaffected.
- The PWA icons come from `public/app-icon.svg`; `public/pwa-192.png`, `pwa-512.png` and `apple-touch-icon.png` are generated from it, so regenerate all three if that source changes.
- Friends, Notifications, and Settings are still on early, functional-only styling (`friends-temp.css`, `notifications-temp.css`, `settings-temp.css`) — Dashboard, Wishlist detail, and the shared modals have had a real design pass.

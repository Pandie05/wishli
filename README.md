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
  001_users_and_auth.sql
  002_wishlists_and_items.sql
  003_notifications.sql
  004_friends_and_sharing.sql
  005_claims_and_contributions.sql
  006_uploads_and_public_sharing.sql
  007_friends_and_notifications_pages.sql
  008_sync_live_database.sql          <- existing database only, see below
```

Each file is safe to re-run (everything is `if not exists` / `or replace`), so if you're not sure what's already applied, running the whole sequence again won't break anything.

This six-file set is a squashed rewrite of what used to be 22 incremental migrations — it creates the same final schema directly instead of replaying every fix-up along the way (a column added then dropped, a policy patched twice, etc.). **It has not been run against a real database yet** — I traced it carefully by hand from the original files, but couldn't execute it in this environment to confirm it runs clean end to end, so treat it as needing one verification pass (a throwaway Supabase project, or a careful read) before relying on it for a fresh setup. The original 22 files are kept in `sql-queries/archive/` for reference and are still what produced the current live database — nothing there needs to be re-run.

`007` is the first file added on top of the squash: it fixes notification messages coming out blank when a username could not be resolved (in SQL, `null || ' sent you a friend request'` is `null`, not the rest of the sentence), repairs the rows already written that way, and adds the two read-side functions the friends and notifications pages use — `friend_overview()` and `notification_feed()`. It creates no tables and changes no policies.

#### `008` — only for a database that already exists

**A fresh project does not need this file; run `001`–`007` and stop.**

The live database grew through the original 22 files, and the squash was never executed against it — `007` was, which is why its functions are there and the squash's are not. That left three things the app calls missing from the live database: `usernames_for_ids` (dashboard avatars fall back to "?", the wish modal says "Reserved by a friend" instead of a name), `search_users` (the friends type-ahead silently returns nothing, because the call site discards the error), and the current `set_item_purchased` (marking something bought without reserving it first fails with `column reference "item_id" is ambiguous`).

`008` applies just those, plus the missing indexes and the membership uniqueness, rather than running the whole squash against live rows. Every statement is idempotent.

**It deliberately does not touch `public.friend_requests`** — that table is being worked on separately. The consequence to know about: removing a friend still fails silently for whoever *received* the original request, because the delete policy only allows the sender and PostgREST reports success for deleting nothing. Whoever picks that table up should carry `either party can remove a friend request` across from `004`.

One judgement call in `008` worth reading before you run it: section 6 turns `users.public_profile` on by default and switches it on for existing accounts, carried over from the old `021`. It cannot distinguish an account that never changed the setting from one that deliberately opted out. Delete that section if you would rather leave existing accounts alone — nothing else depends on it.

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
- **Dashboard** — your wishlists and the ones shared with you, with budget-vs-spent tracking and sorting (including by soonest upcoming date). Search matches wish names as well as list names, so you can find something without remembering which list you put it on
- **Wishlist detail** — add/edit/delete items, mark purchased, occasion + target date, and a "how many" count so several people can each reserve part of one wish
- **Friends** — send/accept/decline friend requests, resend after a decline, and remove a friend from either side. One friendship per pair whichever way round it was asked, enforced in the database rather than only in the form. Removing someone does not revoke wishlists you already shared with them; take those back on the list itself
- **Sharing** — share a wishlist with a friend; they can view and mark items purchased, but can't edit the list unless made an editor. The owner can choose whether they see exactly what's been claimed or just a count, so a shared wishlist can still be a surprise
- **Share links** — a read-only public link per wishlist, shown with a QR code so a room can open it without typing anything. No account needed to look, still needed to reserve
- **Public profile** — opt-in page at `/u/<username>` listing only the wishlists you have already turned link-sharing on for
- **Notifications** — friend requests, accepted requests, being added to a wishlist, items getting claimed, and upcoming target dates, each with a relative timestamp, plus mark-all-read
- **Settings** — appearance (system/light/dark), profile picture, username, email, password, and the public-profile switch
- **Installable** — ships a web app manifest and a service worker, so it can be added to a phone home screen and opens without browser chrome

## Notes

- Requires Node 20.19+ or 22.12+. It'll run on older Node 20.18 with a warning, but that's unsupported territory.
- On Windows, `npm install` can intermittently fail to pull in a native binary it should have installed — a known npm bug with optional dependencies. It hits two packages here. Missing `@rolldown/binding-win32-x64-msvc` makes `npm run dev` fail with `'vite' is not recognized`; missing `@oxlint/binding-win32-x64-msvc` makes `npm run lint` fail with `Cannot find module './oxlint.win32-x64-msvc.node'`. Neither is pinned as a direct dependency on purpose — that fixes Windows but breaks `npm install` on Vercel's Linux builds outright, since an explicit non-Windows dependency triggers a hard `EBADPLATFORM` error rather than a skip. Deleting `node_modules` and `package-lock.json` and reinstalling usually fixes it, sometimes on the second try. If it does not, fetch the one package directly: `npm pack @oxlint/binding-win32-x64-msvc@<version matching oxlint>`, then unpack it into `node_modules/@oxlint/binding-win32-x64-msvc/`.
- The service worker only precaches the app shell (JS/CSS/HTML/fonts), never Supabase responses — so offline the app opens instantly and then has no data to show. Real offline browsing would need cached API responses plus a write queue and conflict resolution, which is deliberately out of scope. The service worker is only built by `npm run build`, so `npm run dev` is unaffected.
- The PWA icons come from `public/app-icon.svg`; `public/pwa-192.png`, `pwa-512.png` and `apple-touch-icon.png` are generated from it, so regenerate all three if that source changes.
- The login art in `src/images/` is WebP, not PNG, and that is worth keeping. As PNGs those two files were 2.0 MB between them — four times the size of the whole JavaScript bundle, on the first page every visitor loads. Re-exported at identical dimensions they come to 316 KB with no visible difference. If you ever replace them, convert before committing.
- Routes are code-split (`React.lazy` in `App.tsx`), so a logged-out visitor — including someone opening a share link who may never sign up — no longer downloads the whole signed-in app. `Auth` is deliberately left eager because it is the cold start for anyone without a session. The `qrcode` encoder is imported inside the share modal for the same reason. There are two `<Suspense>` boundaries: one at the router, and one inside `AppShell` below the nav, so moving between signed-in pages never blanks the rail.
- Dark mode lives in one `:root[data-theme='dark']` block in `index.css`, not the usual pair of a `prefers-color-scheme` query plus a manual override. `src/lib/theme.ts` resolves the three-way choice (system/light/dark) in JS and always stamps a concrete value on `<html>`, so the stylesheet never has to ask what the OS is set to and the two cannot disagree. A small inline script in `index.html` applies it before first paint, which is what stops a white flash; it duplicates a few lines of that logic on purpose, because a module would load too late to help. Text on the accent colour uses `--on-accent` rather than a literal white — the accent lightens in dark mode and white on it is too little contrast. The auth pages pin the shared tokens to their light values in `auth.css`: they carry their own palette and artwork and are deliberately light-only.
- Every page now has a real design pass and its own stylesheet; the `*-temp.css` placeholders are gone. They all share one editorial language — full-bleed hairline bands, an oversized page heading, and small letterspaced uppercase labels — so a new page should start by copying that frame rather than inventing another one. There is no global `box-sizing` reset; it is set per rule where needed.
- Uploaded pictures are cleaned up by `src/lib/storage.ts`, which every delete/replace path calls. It only ever removes URLs that point into our own bucket, so a product image scraped from a shop is left alone, and the storage policy in `011` means you can only delete inside your own folder — an owner clearing out a wishlist cannot remove a picture an editor uploaded. Cleanup is best-effort and never blocks the save or delete the person actually asked for.
- A render error anywhere lands on the crash screen in `src/components/ErrorBoundary.tsx` instead of a blank page. Its buttons navigate with a full page load on purpose — the state that caused the crash is still in memory, so re-rendering into it would usually just crash again.

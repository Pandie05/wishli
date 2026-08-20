# wishli

A wishlist app: create wishlists, add items, share them with friends, and let people mark things purchased without spoiling the surprise.

## Stack

- [React](https://react.dev/) + TypeScript, built with [Vite](https://vite.dev/)
- [React Router](https://reactrouter.com/) for routing
- [Supabase](https://supabase.com/) — Postgres database, auth, and one edge function
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
```

Each file is safe to re-run (everything is `if not exists` / `or replace`), so if you're not sure what's already applied, running the whole sequence again won't break anything.

### Edge function (link auto-fill)

Adding an item can auto-fill its name/price/image from a pasted product URL, via a Supabase edge function in `supabase/functions/fetch-link-preview`. It needs to be deployed separately from the rest of the app:

```
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase functions deploy fetch-link-preview
```

The app works without this — the "Fetch details" button just won't return anything until the function is deployed.

## What's in the app

- **Auth** — email/password and Google sign-in
- **Dashboard** — your wishlists and the ones shared with you, with budget-vs-spent tracking
- **Wishlist detail** — add/edit/delete items, mark purchased, sort by priority/date/price
- **Friends** — send/accept/decline friend requests
- **Sharing** — share a wishlist with a friend; they can view and mark items purchased, but can't edit the list. The owner can choose whether they see exactly what's been claimed or just a count, so a shared wishlist can still be a surprise
- **Notifications** — friend requests, accepted requests, being added to a wishlist, items getting claimed
- **Settings** — change username, email, or password

## Notes

- Requires Node 20.19+ or 22.12+. It'll run on older Node 20.18 with a warning, but that's unsupported territory.
- On Windows, `package.json` pins `@rolldown/binding-win32-x64-msvc` as a direct dependency. Without it, `npm install` intermittently fails to pull in the native binary Vite needs (a known npm bug with optional dependencies) and `npm run dev` fails with `'vite' is not recognized`. If that happens, delete `node_modules` and `package-lock.json` and reinstall.
- Styling in most pages is intentionally throwaway (files named `*-temp.css`, marked for deletion) — the app is functional but not the final design.

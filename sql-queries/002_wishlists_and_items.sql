-- ============================================================================
-- wishli — the wishlists and items tables. Run after 001.
--
-- Just the data model here -- row level security for both tables lives in
-- 004_friends_and_sharing.sql instead, because the final policies (a member
-- or editor, not just the owner, can see or touch a row) depend on functions
-- that in turn depend on wishlist_members, which does not exist yet. Rather
-- than write a throwaway owner-only policy here and replace it later, both
-- tables' RLS is written once, in its final shape, once everything it needs
-- exists.
--
-- Run this once in the Supabase dashboard: SQL Editor -> New query -> Run.
-- Safe to re-run.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. Wishlists
-- ----------------------------------------------------------------------------
create table if not exists public.wishlists (
  wishlist_id       uuid        primary key default gen_random_uuid(),
  -- the owner's user id, not the wishlist's own id
  id                uuid        not null references public.users (id) on delete cascade,
  name              text        not null,
  item_img          text,
  budget            decimal,
  -- optional blurb shown under the wishlist title
  description       text,
  -- free-text occasion label, e.g. "Birthday" -- not an enum, so the
  -- picker's options can change without a migration
  occasion          text,
  target_date       date,
  -- owner-only setting: whether a shared member sees exactly what has been
  -- claimed/bought ('full'), or just a running count ('aggregate') -- so a
  -- shared list can still be a surprise for the owner
  purchase_visibility text      not null default 'full'
                                check (purchase_visibility in ('full', 'aggregate')),
  -- set = link-sharing on, null = off. Grants read-only anonymous access via
  -- get_shared_wishlist(s) in 006_uploads_and_public_sharing.sql
  share_token       uuid,
  -- set the first time the target-date reminder fires, so the scheduled job
  -- (send-date-reminders edge function) does not repeat it daily
  reminder_sent_at  timestamptz,
  created_at        timestamptz not null default now()
);

create unique index if not exists wishlists_share_token_idx
  on public.wishlists (share_token)
  where share_token is not null;

create index if not exists wishlists_owner_idx on public.wishlists (id);

comment on column public.wishlists.description is 'Optional blurb shown under the wishlist title.';
comment on column public.wishlists.occasion is 'Free-text occasion label, e.g. Birthday. Null means none chosen.';
comment on column public.wishlists.target_date is 'Optional date the list is needed by.';
comment on column public.wishlists.share_token is 'Set = link-sharing on, null = off. Grants read-only anonymous access via get_shared_wishlist(s).';
comment on column public.wishlists.reminder_sent_at is 'Set the first time the target-date reminder fires, so it does not repeat daily.';


-- ----------------------------------------------------------------------------
-- 2. Items
-- ----------------------------------------------------------------------------
create table if not exists public.items (
  item_id      uuid        primary key default gen_random_uuid(),
  wishlist_id  uuid        not null references public.wishlists (wishlist_id) on delete cascade,
  -- whoever added the item -- the owner for most lists, or an editor adding
  -- their own idea to a shared one
  user_id      uuid        not null references public.users (id) on delete cascade,
  name         text        not null,
  product_url  text,
  image_url    text,
  price        decimal,
  notes        text,
  purchased    boolean     not null default false,
  -- 1 (just an idea) to 5 (top of my list). Null means unrated.
  priority     int         check (priority is null or priority between 1 and 5),
  -- how many of this item the owner wants; reserved counts in item_claims
  -- (005_claims_and_contributions.sql) add up against it
  quantity     int         not null default 1 check (quantity > 0),
  added_at     timestamptz not null default now()
);

create index if not exists items_wishlist_id_idx on public.items (wishlist_id);
create index if not exists items_user_id_idx     on public.items (user_id);

comment on column public.items.priority is '1 (just an idea) to 5 (top of my list). Null means unrated.';
comment on column public.items.quantity is 'How many of this item the owner wants. Reserved counts in item_claims add up against it.';

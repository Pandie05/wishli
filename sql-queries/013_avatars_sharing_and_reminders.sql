-- ============================================================================
-- wishli — profile avatars, public read-only share links, and a target-date
-- reminder column. Run after 012.
--
-- Run this once in the Supabase dashboard: SQL Editor -> New query -> Run.
-- Safe to re-run.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. Avatars
--
-- Same bucket and path convention item/wishlist images already use (see 011):
-- ImageDrop uploads to "<uid>/<random>.<ext>" in wishli-images, so no new
-- storage policy is needed. Reading it back is already covered by the
-- self-scoped select policy on public.users from 001; writing it is already
-- covered by that table's self-scoped update policy.
-- ----------------------------------------------------------------------------
alter table public.users add column if not exists avatar_url text;

comment on column public.users.avatar_url is 'Profile picture, uploaded to the wishli-images bucket. Null means show initials instead.';


-- ----------------------------------------------------------------------------
-- 2. Public read-only share links
--
-- Null means link-sharing is off for that wishlist, same null-means-none
-- convention occasion/target_date already use. There is deliberately no RLS
-- policy granting anon select on wishlists or items directly -- a policy like
-- "using (share_token is not null)" would let anyone enumerate every
-- publicly-shared list on the whole site with one unfiltered query, not just
-- the one list whose token they actually have. Instead, anonymous access goes
-- through the two narrow functions below, the same shape as username_for_id
-- in 004: each only ever returns the one row matching the exact token it was
-- given.
-- ----------------------------------------------------------------------------
alter table public.wishlists add column if not exists share_token uuid;

create unique index if not exists wishlists_share_token_idx
  on public.wishlists (share_token)
  where share_token is not null;

comment on column public.wishlists.share_token is 'Set = link-sharing on, null = off. Grants read-only anonymous access via get_shared_wishlist(s).';

create or replace function public.get_shared_wishlist(token uuid)
returns table (
  wishlist_id uuid,
  name text,
  description text,
  occasion text,
  target_date date,
  item_img text,
  budget decimal
)
language sql
security definer
set search_path = public
stable
as $$
  select w.wishlist_id, w.name, w.description, w.occasion, w.target_date, w.item_img, w.budget
  from public.wishlists w
  where w.share_token = get_shared_wishlist.token;
$$;

revoke all on function public.get_shared_wishlist(uuid) from public;
grant execute on function public.get_shared_wishlist(uuid) to anon, authenticated;

-- who claimed something is not part of this: that is fine for a signed-in
-- member to see (see WishDetailModal), not for an anonymous visitor.
create or replace function public.get_shared_wishlist_items(token uuid)
returns table (
  item_id uuid,
  name text,
  product_url text,
  image_url text,
  price decimal,
  notes text,
  reserved boolean
)
language sql
security definer
set search_path = public
stable
as $$
  select i.item_id, i.name, i.product_url, i.image_url, i.price, i.notes,
         (i.purchased or i.claimed_by is not null) as reserved
  from public.items i
  join public.wishlists w on w.wishlist_id = i.wishlist_id
  where w.share_token = get_shared_wishlist_items.token;
$$;

revoke all on function public.get_shared_wishlist_items(uuid) from public;
grant execute on function public.get_shared_wishlist_items(uuid) to anon, authenticated;


-- ----------------------------------------------------------------------------
-- 3. Target-date reminders
--
-- Set once a reminder has actually been sent for a list, so the scheduled
-- job (send-date-reminders edge function) only ever notifies once per list
-- rather than every day it stays inside the reminder window.
-- ----------------------------------------------------------------------------
alter table public.wishlists add column if not exists reminder_sent_at timestamptz;

comment on column public.wishlists.reminder_sent_at is 'Set the first time the target-date reminder fires, so it does not repeat daily.';

-- ============================================================================
-- wishli — performance only. No behaviour changes. Run after 017.
--
-- Two things, both invisible from the UI:
--
-- 1. Indexes. Postgres creates an index for a primary key and for a unique
--    constraint, but NOT for a foreign key -- that part is on us, and until
--    now it was simply missing. Every RLS policy in this schema leans on the
--    same handful of lookups (is this item on a list I own, am I a member of
--    this wishlist, how many notifications are unread), and each one was a
--    sequential scan. Small tables hide it; the fix is cheap either way.
--
-- 2. usernames_for_ids. username_for_id answers for exactly one person, so
--    every page that shows a list of people fired one request per row. Same
--    data, same visibility, one round trip.
--
-- Safe to re-run: every index is `if not exists`.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. Items
--
-- items(wishlist_id) is the single most-used lookup in the app -- the wishlist
-- page, the dashboard totals, and every items RLS policy all start here.
-- items(user_id) backs the editor policies from 009, which check the item was
-- added by the person editing it.
-- ----------------------------------------------------------------------------
create index if not exists items_wishlist_id_idx on public.items (wishlist_id);
create index if not exists items_user_id_idx     on public.items (user_id);


-- ----------------------------------------------------------------------------
-- 2. Claims and contributions
--
-- Both already carry a unique (item_id, user_id), and Postgres can use that
-- index for item_id alone because it is the leading column -- so only the
-- user_id direction ("everything I have reserved / pledged") needs adding.
-- ----------------------------------------------------------------------------
create index if not exists item_claims_user_id_idx        on public.item_claims (user_id);
create index if not exists item_contributions_user_id_idx on public.item_contributions (user_id);


-- ----------------------------------------------------------------------------
-- 3. Membership
--
-- is_wishlist_member/-owner/-editor (004, 009) run on nearly every policy
-- evaluation in the schema, always as "this wishlist AND this user", which is
-- exactly what the composite serves. The user_id index covers the other
-- direction: the lists shared with me.
-- ----------------------------------------------------------------------------
create index if not exists wishlist_members_wishlist_user_idx
  on public.wishlist_members (wishlist_id, user_id);
create index if not exists wishlist_members_user_id_idx
  on public.wishlist_members (user_id);

-- wishlists.id is the owner, not the primary key (that is wishlist_id), so it
-- is a foreign key like any other and was unindexed
create index if not exists wishlists_owner_idx on public.wishlists (id);


-- ----------------------------------------------------------------------------
-- 4. Notifications
--
-- Two shapes: the rail's unread badge counts by (user_id, is_read), and the
-- notifications page reads them newest-first. A partial index keeps the first
-- one small -- once things are read they drop out of it entirely, and read
-- rows are the ones that accumulate.
-- ----------------------------------------------------------------------------
create index if not exists notifications_unread_idx
  on public.notifications (user_id) where not is_read;
create index if not exists notifications_user_created_idx
  on public.notifications (user_id, created_at desc);


-- ----------------------------------------------------------------------------
-- 5. Friend requests
--
-- Read from both ends -- incoming is keyed on receiver_id, outgoing on
-- sender_id -- and the select policy checks both, so both need an index.
-- ----------------------------------------------------------------------------
create index if not exists friend_requests_sender_idx   on public.friend_requests (sender_id);
create index if not exists friend_requests_receiver_idx on public.friend_requests (receiver_id);


-- ----------------------------------------------------------------------------
-- 6. Batched username lookup
--
-- Exposes nothing username_for_id (004) did not already expose to a signed-in
-- user; it just answers for a whole set at once. Parameter and column
-- references are qualified for the usual reason -- `ids` and the returned
-- `id`/`username` would otherwise be ambiguous against the table's own
-- columns.
-- ----------------------------------------------------------------------------
create or replace function public.usernames_for_ids(ids uuid[])
returns table (id uuid, username text)
language sql
security definer
set search_path = public
stable
as $$
  select u.id, u.username
  from public.users u
  where u.id = any(usernames_for_ids.ids);
$$;

revoke all on function public.usernames_for_ids(uuid[]) from public;
grant execute on function public.usernames_for_ids(uuid[]) to authenticated;

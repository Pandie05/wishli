-- ============================================================================
-- wishli — what the friends and notifications pages need. Run after 006.
--
-- Three things live here:
--
--   1. A fix. Every notification message is built by concatenating a
--      username into a sentence, and in SQL `null || ' sent you a friend
--      request'` is null, not the rest of the sentence. So one missing
--      username did not just drop a name -- it blanked the whole row, and
--      the notifications page rendered an empty line. username_for_id now
--      falls back to 'Someone' instead of returning null, which fixes every
--      caller at once (003, 004 and 005 all go through it), and the
--      already-written rows are repaired below.
--
--   2. friend_overview(). The friends page used to read friend_requests and
--      then call usernames_for_ids to put names on it -- two round trips,
--      and no avatars at all, since usernames_for_ids only answers with the
--      name. This answers the whole page in one call, avatars included.
--
--   3. notification_feed(). Same idea for notifications: the rows, plus who
--      sent each one and what list it points at, plus -- for a friend
--      request -- the id of the request itself, so it can be accepted or
--      declined from the notification without a second lookup.
--
-- Nothing here changes a table, a policy or a trigger wiring, so it cannot
-- affect what any existing page is allowed to read or write.
--
-- Run this once in the Supabase dashboard: SQL Editor -> New query -> Run.
-- Safe to re-run.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. username_for_id never returns null
--
-- Same signature, same grants, same exposure as 001 -- the only change is the
-- coalesce, so that a deleted account (sender_id is `on delete set null`, but
-- a row can also simply be missing) costs a name rather than a sentence.
-- ----------------------------------------------------------------------------
create or replace function public.username_for_id(id uuid)
returns text
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(
    (select u.username from public.users u where u.id = username_for_id.id),
    'Someone'
  );
$$;

revoke all on function public.username_for_id(uuid) from public;
grant execute on function public.username_for_id(uuid) to authenticated;


-- ----------------------------------------------------------------------------
-- 2. Repair the rows that were written blank
--
-- Rebuilt from type + sender_id + wishlist_id, which is everything the
-- triggers in 003/004 had to work with in the first place.
-- ----------------------------------------------------------------------------
update public.notifications n
set message = case n.type
  when 'friend_request'  then public.username_for_id(n.sender_id) || ' sent you a friend request'
  when 'friend_accepted' then public.username_for_id(n.sender_id) || ' accepted your friend request'
  when 'wishlist_shared' then coalesce(
                                (select w.name from public.wishlists w
                                  where w.wishlist_id = n.wishlist_id),
                                'A wishlist'
                              ) || ' was shared with you'
  when 'item_purchased'  then public.username_for_id(n.sender_id) || ' marked an item as purchased'
  else 'You have a new notification'
end
where n.message is null or btrim(n.message) = '';


-- ----------------------------------------------------------------------------
-- 3. The whole friends page in one call
--
-- Returns every friend_requests row either end of which is the caller, with
-- the other person's name and avatar already attached and a `direction` the
-- page can group on. Security definer for the usual reason: rls on
-- public.users only exposes your own row, so the join has to run as the
-- owner -- but it exposes nothing usernames_for_ids (001) did not already,
-- plus the avatar, which search_users (004) already returns for any account.
--
-- The where clause is the same condition as friend_requests' own select
-- policy, so a definer function cannot see a row the caller could not have
-- read for itself.
-- ----------------------------------------------------------------------------
create or replace function public.friend_overview()
returns table (
  request_id uuid,
  other_id   uuid,
  username   text,
  avatar_url text,
  status     text,
  direction  text,
  created_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select
    fr.request_id,
    other.id,
    other.username,
    other.avatar_url,
    fr.status,
    case
      when fr.status = 'accepted'   then 'friend'
      when fr.sender_id = auth.uid() then 'outgoing'
      else 'incoming'
    end,
    fr.created_at
  from public.friend_requests fr
  join public.users other
    on other.id = case when fr.sender_id = auth.uid() then fr.receiver_id else fr.sender_id end
  where fr.sender_id = auth.uid() or fr.receiver_id = auth.uid()
  order by other.username;
$$;

revoke all on function public.friend_overview() from public;
grant execute on function public.friend_overview() to authenticated;


-- ----------------------------------------------------------------------------
-- 4. The notifications page, one page at a time
--
-- Paged the same way the page already pages (limit/offset over
-- created_at desc), and carrying the three things the row could not render
-- before: who it is from, what list it points at, and -- only while the
-- request is still unanswered -- the friend request id, so Accept and
-- Decline can be right there on the notification.
--
-- friend_request_id is looked up by (sender, me, pending) rather than stored
-- on the notification, so a request answered or withdrawn anywhere else
-- simply stops offering the buttons here.
-- ----------------------------------------------------------------------------
create or replace function public.notification_feed(
  limit_count  int default 25,
  offset_count int default 0
)
returns table (
  notification_id   uuid,
  type              text,
  message           text,
  wishlist_id       uuid,
  wishlist_name     text,
  sender_id         uuid,
  sender_username   text,
  sender_avatar     text,
  friend_request_id uuid,
  is_read           boolean,
  created_at        timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select
    n.notification_id,
    n.type,
    n.message,
    n.wishlist_id,
    w.name,
    n.sender_id,
    s.username,
    s.avatar_url,
    case
      when n.type = 'friend_request' and n.sender_id is not null then (
        select fr.request_id
        from public.friend_requests fr
        where fr.status = 'pending'
          and fr.sender_id = n.sender_id
          and fr.receiver_id = auth.uid()
        limit 1
      )
    end,
    n.is_read,
    n.created_at
  from public.notifications n
  left join public.users s      on s.id = n.sender_id
  left join public.wishlists w  on w.wishlist_id = n.wishlist_id
  -- the same condition as notifications' own select policy
  where n.user_id = auth.uid()
  order by n.created_at desc
  limit greatest(least(coalesce(notification_feed.limit_count, 25), 100), 1)
  offset greatest(coalesce(notification_feed.offset_count, 0), 0);
$$;

revoke all on function public.notification_feed(int, int) from public;
grant execute on function public.notification_feed(int, int) to authenticated;

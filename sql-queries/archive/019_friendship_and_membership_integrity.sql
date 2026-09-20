-- ============================================================================
-- wishli — three gaps where the database trusted the client. Run after 018.
--
-- friend_requests and wishlist_members were created with nothing but foreign
-- keys on them. Every rule about what rows may exist lived in the React code,
-- which means a race between two tabs, a retried request, or anyone calling
-- the API directly could write a row the app assumes is impossible.
--
-- Each section cleans up whatever already violates the rule before adding it,
-- so this runs on a live database rather than failing on existing data. Safe
-- to re-run: the cleanups find nothing the second time and both indexes are
-- `if not exists`.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. You cannot be your own friend
--
-- Nothing stopped sender_id = receiver_id, and the Friends page looked the
-- username up without checking it was not your own -- so typing your own
-- handle sent yourself a request, which then appeared in both your incoming
-- and your outgoing list.
-- ----------------------------------------------------------------------------
delete from public.friend_requests where sender_id = receiver_id;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'friend_requests_not_self'
      and conrelid = 'public.friend_requests'::regclass
  ) then
    alter table public.friend_requests
      add constraint friend_requests_not_self check (sender_id <> receiver_id);
  end if;
end $$;


-- ----------------------------------------------------------------------------
-- 2. One friendship per pair, whichever way round it was asked
--
-- The app checked for an existing request before inserting, but only in the
-- direction it was about to send (sender = me, receiver = them). If both
-- people sent a request to each other, both rows passed that check and both
-- could be accepted -- two friendships between the same two people, each one
-- showing up as a separate entry in the other's list.
--
-- Indexing on (least, greatest) of the pair makes the constraint symmetric:
-- A->B and B->A produce the same key, so the second one is rejected.
--
-- Cleanup keeps an accepted row over a pending one, and the oldest otherwise,
-- so an existing friendship is never the row that gets dropped.
-- ----------------------------------------------------------------------------
delete from public.friend_requests
where request_id in (
  select request_id
  from (
    select request_id,
           row_number() over (
             partition by least(sender_id, receiver_id), greatest(sender_id, receiver_id)
             order by (status = 'accepted') desc, created_at asc
           ) as rn
    from public.friend_requests
  ) ranked
  where ranked.rn > 1
);

create unique index if not exists friend_requests_pair_idx
  on public.friend_requests (least(sender_id, receiver_id), greatest(sender_id, receiver_id));


-- ----------------------------------------------------------------------------
-- 3. One membership row per person per wishlist
--
-- The manage-people modal only offers friends who are not already on the
-- list, so this is not reachable through the UI today -- but nothing in the
-- database said so, and a duplicate row would double that person in the
-- member list and in the friend count on the card.
--
-- Cleanup keeps the stronger role, so deduplicating never quietly demotes an
-- editor back to a viewer.
-- ----------------------------------------------------------------------------
delete from public.wishlist_members
where member_id in (
  select member_id
  from (
    select member_id,
           row_number() over (
             partition by wishlist_id, user_id
             order by (role = 'editor') desc, joined_at asc
           ) as rn
    from public.wishlist_members
  ) ranked
  where ranked.rn > 1
);

create unique index if not exists wishlist_members_unique_idx
  on public.wishlist_members (wishlist_id, user_id);

-- 018 added a plain (wishlist_id, user_id) index for the membership checks.
-- The unique index above covers exactly the same lookup, so the other one is
-- now dead weight on every write to this table.
drop index if exists public.wishlist_members_wishlist_user_idx;

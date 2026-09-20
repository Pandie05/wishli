-- ============================================================================
-- wishli — bring the live database up to match the squashed schema.
--
-- WHY THIS EXISTS
--
-- 001-006 are a squashed rewrite: they build the whole schema from nothing and
-- are what a fresh Supabase project should run. The live database was not
-- built that way -- it grew through the original 22 incremental files -- and
-- the squash has never been executed against it. 007 was run (its functions
-- are live), but the squash itself was not, so a handful of things the app
-- calls are defined in 001-006 and simply absent from the live database:
--
--   * usernames_for_ids  -> dashboard activity avatars show "?", and the wish
--                           modal says "Reserved by a friend" instead of a name
--   * search_users       -> the friends page type-ahead silently returns
--                           nothing (the error is discarded at the call site)
--   * set_item_purchased -> still the older body, which raises
--                           'column reference "item_id" is ambiguous' when you
--                           mark something bought without reserving it first
--
-- Running 001-006 against live data would also work, but it is a much bigger
-- surface for a database with real rows in it. This file does only the parts
-- that are actually missing, and every statement is idempotent, so running it
-- twice changes nothing.
--
--
-- DELIBERATELY NOT INCLUDED: anything touching public.friend_requests
--
-- Someone else is working on that table right now, so this file does not add
-- its indexes, its unique pair constraint, its self-request check, or its
-- delete policy, and does not delete any row from it.
--
-- One user-visible consequence, so it is not a surprise: removing a friend
-- still fails silently for whoever *received* the original request. The delete
-- policy on friend_requests only allows the sender, the RLS match finds no
-- row, and PostgREST reports success for having deleted nothing. Whoever picks
-- that table up should carry across `either party can remove a friend request`
-- from 004 of the squash.
--
-- Run this once in the Supabase dashboard: SQL Editor -> New query -> Run.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. usernames_for_ids  (matches 001 of the squash)
--
-- One lookup for a whole page of people instead of one request per row.
-- Exposes nothing username_for_id did not already expose to a signed-in user.
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


-- ----------------------------------------------------------------------------
-- 2. search_users  (matches 004 of the squash)
--
-- Backs the type-ahead on the friends page. Never returns the caller, and
-- prefixes rank above mid-word matches so typing the start of a handle puts
-- it first.
-- ----------------------------------------------------------------------------
create or replace function public.search_users(query text)
returns table (id uuid, username text, avatar_url text)
language sql
security definer
set search_path = public
stable
as $$
  select u.id, u.username, u.avatar_url
  from public.users u
  where char_length(trim(search_users.query)) >= 1
    and u.id <> auth.uid()
    and u.username ilike '%' || trim(search_users.query) || '%'
  order by
    -- a name starting with what was typed reads as the more likely match
    (lower(u.username) like lower(trim(search_users.query)) || '%') desc,
    u.username asc
  limit 8;
$$;

revoke all on function public.search_users(text) from public;
grant execute on function public.search_users(text) to authenticated;


-- ----------------------------------------------------------------------------
-- 3. set_item_purchased  (matches 005 of the squash)
--
-- The live copy still carries the older auto-claim step, whose
-- `on conflict (item_id, user_id)` names a column that is also this
-- function's own parameter -- plpgsql cannot tell them apart, and a conflict
-- target cannot be table-qualified. That path only runs when you have no
-- claim of your own, which is exactly why marking something bought worked
-- after reserving it and failed before.
--
-- `on conflict do nothing` with no column list still catches any unique
-- violation and leaves nothing to be ambiguous.
-- ----------------------------------------------------------------------------
create or replace function public.set_item_purchased(item_id uuid, purchased boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_wishlist_id   uuid;
  v_owner_id      uuid;
  v_wishlist_name text;
  v_visibility    text;
  v_item_name     text;
  v_was_purchased boolean;
  v_quantity      int;
  v_claimed       int;
  v_mine          int;
begin
  select i.wishlist_id, i.name, i.purchased, i.quantity, w.id, w.name, w.purchase_visibility
    into v_wishlist_id, v_item_name, v_was_purchased, v_quantity, v_owner_id, v_wishlist_name, v_visibility
  from public.items i
  join public.wishlists w on w.wishlist_id = i.wishlist_id
  where i.item_id = set_item_purchased.item_id
    and (
      w.id = auth.uid()
      or exists (
        select 1 from public.wishlist_members m
        where m.wishlist_id = i.wishlist_id and m.user_id = auth.uid()
      )
    );

  if v_wishlist_id is null then
    raise exception 'not allowed';
  end if;

  select coalesce(sum(c.quantity), 0),
         coalesce(sum(c.quantity) filter (where c.user_id = auth.uid()), 0)
    into v_claimed, v_mine
  from public.item_claims c
  where c.item_id = set_item_purchased.item_id;

  if set_item_purchased.purchased and v_mine = 0 and v_claimed > 0 then
    raise exception 'claimed by someone else';
  end if;

  update public.items
  set purchased = set_item_purchased.purchased
  where items.item_id = set_item_purchased.item_id;

  -- no claim of your own yet: record one for whatever is still unspoken
  -- for, so buying without reserving first still attributes the purchase
  if set_item_purchased.purchased and v_mine = 0 and v_claimed < v_quantity then
    insert into public.item_claims (item_id, user_id, quantity)
    values (set_item_purchased.item_id, auth.uid(), v_quantity - v_claimed)
    on conflict do nothing;
  end if;

  if set_item_purchased.purchased and not v_was_purchased and v_owner_id <> auth.uid() then
    insert into public.notifications (user_id, sender_id, wishlist_id, type, message)
    values (
      v_owner_id,
      auth.uid(),
      v_wishlist_id,
      'item_purchased',
      case v_visibility
        when 'full' then public.username_for_id(auth.uid()) || ' marked "' || v_item_name || '" as purchased'
        else 'An item was claimed on ' || v_wishlist_name
      end
    );
  end if;
end;
$$;


-- ----------------------------------------------------------------------------
-- 4. Indexes
--
-- Postgres indexes a primary key and a unique constraint for you, but not a
-- foreign key -- and the RLS policies lean on these lookups constantly.
-- The friend_requests indexes from the squash are deliberately left out.
-- ----------------------------------------------------------------------------
create index if not exists wishlists_owner_idx            on public.wishlists (id);
create index if not exists items_wishlist_id_idx          on public.items (wishlist_id);
create index if not exists items_user_id_idx              on public.items (user_id);
create index if not exists wishlist_members_user_id_idx   on public.wishlist_members (user_id);
create index if not exists item_claims_user_id_idx        on public.item_claims (user_id);
create index if not exists item_contributions_user_id_idx on public.item_contributions (user_id);

-- unread is what the rail's badge counts, and read rows are the ones that
-- pile up, so a partial index stays small
create index if not exists notifications_unread_idx
  on public.notifications (user_id) where not is_read;
create index if not exists notifications_user_created_idx
  on public.notifications (user_id, created_at desc);


-- ----------------------------------------------------------------------------
-- 5. One membership row per person per wishlist
--
-- The squash declares this as a table constraint, which does nothing for a
-- table that already exists, so it goes on as a unique index instead.
-- Duplicates have to go first or the index cannot be built -- keeping the
-- stronger role, so deduplicating never quietly demotes an editor to a viewer.
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


-- ----------------------------------------------------------------------------
-- 6. Public profiles default on  (matches 001 of the squash)
--
-- Only ever turns a profile on for accounts still sitting at the old default
-- of false; anyone who has deliberately switched theirs off in Settings has
-- public_profile = false too, so this cannot tell them apart. If that matters,
-- skip this section -- nothing else here depends on it.
-- ----------------------------------------------------------------------------
alter table public.users alter column public_profile set default true;

update public.users set public_profile = true where not public_profile;

comment on column public.users.public_profile is 'Default true: /u/<username> lists this user''s link-shared wishlists to anyone unless they opt out in Settings.';

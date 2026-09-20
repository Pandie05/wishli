-- ============================================================================
-- wishli — friends, wishlist sharing, and the access-control functions that
-- both wishlists and items ultimately rely on. Run after 003.
--
-- This is where wishlists' and items' row level security is finalized (see
-- the note at the top of 002_wishlists_and_items.sql for why it waits until
-- here): both need is_wishlist_member/-editor below, which need
-- wishlist_members, which needs friend_requests for its own insert policy.
--
-- Run this once in the Supabase dashboard: SQL Editor -> New query -> Run.
-- Safe to re-run.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. Friend requests
-- ----------------------------------------------------------------------------
create table if not exists public.friend_requests (
  request_id  uuid        primary key default gen_random_uuid(),
  sender_id   uuid        not null references public.users (id) on delete cascade,
  receiver_id uuid        not null references public.users (id) on delete cascade,
  status      text        not null default 'pending',
  created_at  timestamptz not null default now(),

  constraint friend_requests_not_self check (sender_id <> receiver_id)
);

-- one friendship per pair, whichever way round it was asked: A->B and B->A
-- produce the same key here, so the second insert is rejected
create unique index if not exists friend_requests_pair_idx
  on public.friend_requests (least(sender_id, receiver_id), greatest(sender_id, receiver_id));

-- the select policy below checks both ends -- incoming keyed on
-- receiver_id, outgoing on sender_id -- so both need an index
create index if not exists friend_requests_sender_idx   on public.friend_requests (sender_id);
create index if not exists friend_requests_receiver_idx on public.friend_requests (receiver_id);

alter table public.friend_requests enable row level security;

drop policy if exists "parties can read their friend requests" on public.friend_requests;
drop policy if exists "senders can create friend requests" on public.friend_requests;
drop policy if exists "either party can remove a friend request" on public.friend_requests;

create policy "parties can read their friend requests"
  on public.friend_requests for select
  to authenticated
  using (sender_id = auth.uid() or receiver_id = auth.uid());

create policy "senders can create friend requests"
  on public.friend_requests for insert
  to authenticated
  with check (sender_id = auth.uid() and sender_id <> receiver_id);

-- either party can end it: cancel an outgoing request, remove a friend from
-- either side, or a receiver clearing a request outright. no update policy --
-- accepting/declining goes through respond_to_friend_request below instead,
-- since a plain "receiver can update" policy would let the receiver rewrite
-- sender_id/receiver_id on the row too, not just its status.
create policy "either party can remove a friend request"
  on public.friend_requests for delete
  to authenticated
  using (sender_id = auth.uid() or receiver_id = auth.uid());

drop trigger if exists on_friend_request_created on public.friend_requests;
create trigger on_friend_request_created
  after insert on public.friend_requests
  for each row execute function public.notify_on_friend_request();

-- accepting a friend request notifies whoever sent it
create or replace function public.respond_to_friend_request(request_id uuid, new_status text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sender_id uuid;
begin
  if new_status not in ('accepted', 'declined') then
    raise exception 'invalid status';
  end if;

  update public.friend_requests
  set status = respond_to_friend_request.new_status
  where friend_requests.request_id = respond_to_friend_request.request_id
    and friend_requests.receiver_id = auth.uid()
  returning friend_requests.sender_id into v_sender_id;

  if v_sender_id is null then
    raise exception 'not allowed';
  end if;

  if new_status = 'accepted' then
    insert into public.notifications (user_id, sender_id, type, message)
    values (
      v_sender_id,
      auth.uid(),
      'friend_accepted',
      public.username_for_id(auth.uid()) || ' accepted your friend request'
    );
  end if;
end;
$$;

revoke all on function public.respond_to_friend_request(uuid, text) from public;
grant execute on function public.respond_to_friend_request(uuid, text) to authenticated;


-- ----------------------------------------------------------------------------
-- 2. Wishlist members -- who a list is shared with, and their role
-- ----------------------------------------------------------------------------
create table if not exists public.wishlist_members (
  member_id   uuid        primary key default gen_random_uuid(),
  wishlist_id uuid        not null references public.wishlists (wishlist_id) on delete cascade,
  user_id     uuid        not null references public.users (id) on delete cascade,
  -- an editor can add and change wishes on the list; a viewer can only
  -- reserve and pledge
  role        text        not null default 'viewer' check (role in ('viewer', 'editor')),
  joined_at   timestamptz not null default now(),

  unique (wishlist_id, user_id)
);

create index if not exists wishlist_members_user_id_idx on public.wishlist_members (user_id);


-- ----------------------------------------------------------------------------
-- 3. Access-control functions
--
-- wishlists' and items' select policies need to check wishlist_members, and
-- wishlist_members' own policies need to check wishlists -- querying each
-- other directly inside a policy causes "infinite recursion detected in
-- policy", since each read re-triggers the other table's rls, forever.
-- Security definer functions break the cycle: their internal queries run as
-- the function's owner, which is exempt from rls on tables it owns, so
-- calling these from a policy does not re-trigger rls on the table being
-- checked.
-- ----------------------------------------------------------------------------
create or replace function public.is_wishlist_owner(wishlist_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.wishlists w
    where w.wishlist_id = is_wishlist_owner.wishlist_id and w.id = auth.uid()
  );
$$;

revoke all on function public.is_wishlist_owner(uuid) from public;
grant execute on function public.is_wishlist_owner(uuid) to authenticated;

create or replace function public.is_wishlist_member(wishlist_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.wishlist_members m
    where m.wishlist_id = is_wishlist_member.wishlist_id and m.user_id = auth.uid()
  );
$$;

revoke all on function public.is_wishlist_member(uuid) from public;
grant execute on function public.is_wishlist_member(uuid) to authenticated;

create or replace function public.is_wishlist_editor(wishlist_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.wishlist_members m
    where m.wishlist_id = is_wishlist_editor.wishlist_id
      and m.user_id = auth.uid()
      and m.role = 'editor'
  );
$$;

revoke all on function public.is_wishlist_editor(uuid) from public;
grant execute on function public.is_wishlist_editor(uuid) to authenticated;


-- ----------------------------------------------------------------------------
-- 4. Wishlist members RLS
-- ----------------------------------------------------------------------------
alter table public.wishlist_members enable row level security;

drop policy if exists "members and owners can read membership" on public.wishlist_members;
drop policy if exists "owners can add members who are friends" on public.wishlist_members;
drop policy if exists "owners or the member can remove membership" on public.wishlist_members;

create policy "members and owners can read membership"
  on public.wishlist_members for select
  to authenticated
  using (
    user_id = auth.uid()
    or public.is_wishlist_owner(wishlist_id)
  );

create policy "owners can add members who are friends"
  on public.wishlist_members for insert
  to authenticated
  with check (
    public.is_wishlist_owner(wishlist_id)
    and exists (
      select 1 from public.friend_requests fr
      where fr.status = 'accepted'
        and (
          (fr.sender_id = auth.uid() and fr.receiver_id = wishlist_members.user_id)
          or (fr.receiver_id = auth.uid() and fr.sender_id = wishlist_members.user_id)
        )
    )
  );

-- no update policy: role changes go through set_wishlist_member_role below,
-- not a direct update, so a plain policy cannot be used to rewrite
-- wishlist_id/user_id on the row instead of just role
create policy "owners or the member can remove membership"
  on public.wishlist_members for delete
  to authenticated
  using (
    user_id = auth.uid()
    or public.is_wishlist_owner(wishlist_id)
  );

drop trigger if exists on_wishlist_member_created on public.wishlist_members;
create trigger on_wishlist_member_created
  after insert on public.wishlist_members
  for each row execute function public.notify_on_wishlist_share();

-- promote/demote a member; owner-only
create or replace function public.set_wishlist_member_role(wishlist_id uuid, user_id uuid, role text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if role not in ('viewer', 'editor') then
    raise exception 'invalid role';
  end if;

  if not public.is_wishlist_owner(set_wishlist_member_role.wishlist_id) then
    raise exception 'not allowed';
  end if;

  update public.wishlist_members m
  set role = set_wishlist_member_role.role
  where m.wishlist_id = set_wishlist_member_role.wishlist_id
    and m.user_id = set_wishlist_member_role.user_id;

  if not found then
    raise exception 'not a member';
  end if;
end;
$$;

revoke all on function public.set_wishlist_member_role(uuid, uuid, text) from public;
grant execute on function public.set_wishlist_member_role(uuid, uuid, text) to authenticated;


-- ----------------------------------------------------------------------------
-- 5. Wishlists RLS (final) -- owner always, a member can additionally read
-- ----------------------------------------------------------------------------
alter table public.wishlists enable row level security;

drop policy if exists "owners can read their wishlists"   on public.wishlists;
drop policy if exists "owners can insert their wishlists" on public.wishlists;
drop policy if exists "owners can update their wishlists" on public.wishlists;
drop policy if exists "owners can delete their wishlists" on public.wishlists;

create policy "owners can read their wishlists"
  on public.wishlists for select
  to authenticated
  using (
    auth.uid() = id
    or public.is_wishlist_member(wishlist_id)
  );

create policy "owners can insert their wishlists"
  on public.wishlists for insert
  to authenticated
  with check (auth.uid() = id);

create policy "owners can update their wishlists"
  on public.wishlists for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

create policy "owners can delete their wishlists"
  on public.wishlists for delete
  to authenticated
  using (auth.uid() = id);


-- ----------------------------------------------------------------------------
-- 6. Items RLS (final) -- owner can do anything; an editor can add items and
-- can edit/delete only the ones they personally added; anyone with read
-- access to the list can read its items.
-- ----------------------------------------------------------------------------
alter table public.items enable row level security;

drop policy if exists "owners can read their items" on public.items;
drop policy if exists "owners and editors can insert items" on public.items;
drop policy if exists "owners can update any item, editors their own" on public.items;
drop policy if exists "owners can delete any item, editors their own" on public.items;

create policy "owners can read their items"
  on public.items for select
  to authenticated
  using (
    public.is_wishlist_owner(wishlist_id)
    or public.is_wishlist_member(wishlist_id)
  );

create policy "owners and editors can insert items"
  on public.items for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and (
      public.is_wishlist_owner(wishlist_id)
      or public.is_wishlist_editor(wishlist_id)
    )
  );

create policy "owners can update any item, editors their own"
  on public.items for update
  to authenticated
  using (
    public.is_wishlist_owner(wishlist_id)
    or (public.is_wishlist_editor(wishlist_id) and user_id = auth.uid())
  )
  with check (
    public.is_wishlist_owner(wishlist_id)
    or (public.is_wishlist_editor(wishlist_id) and user_id = auth.uid())
  );

create policy "owners can delete any item, editors their own"
  on public.items for delete
  to authenticated
  using (
    public.is_wishlist_owner(wishlist_id)
    or (public.is_wishlist_editor(wishlist_id) and user_id = auth.uid())
  );

-- an update policy alone cannot stop an editor moving an item they added
-- onto a different wishlist they also have editor access to -- with check
-- only re-validates the new row's own values, not that wishlist_id held
-- still, so this closes that gap from the other side
create or replace function public.prevent_item_wishlist_reassignment()
returns trigger
language plpgsql
as $$
begin
  if new.wishlist_id <> old.wishlist_id then
    raise exception 'cannot move an item to a different wishlist';
  end if;
  return new;
end;
$$;

drop trigger if exists items_immutable_wishlist on public.items;
create trigger items_immutable_wishlist
  before update on public.items
  for each row execute function public.prevent_item_wishlist_reassignment();


-- ----------------------------------------------------------------------------
-- 7. Friend and user search
-- ----------------------------------------------------------------------------

-- type-ahead for the "invite friends to a list" field -- can only ever
-- return people already friends, so it is not a way to enumerate accounts
create or replace function public.search_friends(term text)
returns table (id uuid, username text)
language sql
security definer
set search_path = public
stable
as $$
  select u.id, u.username
  from public.users u
  where u.id <> auth.uid()
    and exists (
      select 1 from public.friend_requests fr
      where fr.status = 'accepted'
        and (
          (fr.sender_id = auth.uid() and fr.receiver_id = u.id)
          or (fr.receiver_id = auth.uid() and fr.sender_id = u.id)
        )
    )
    and (
      term is null
      or btrim(term) = ''
      -- the field accepts "@handle" as well as a bare name
      or u.username ilike '%' || btrim(btrim(term), '@') || '%'
    )
  order by u.username
  limit 8;
$$;

revoke all on function public.search_friends(text) from public;
grant execute on function public.search_friends(text) to authenticated;

-- username search for the "add a friend" autocomplete -- unlike
-- search_friends, this searches everyone (rls only exposes your own row in
-- public.users otherwise), so it is capped to 8 rows and requires at least
-- 1 character so an empty search cannot page through the whole table
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

-- friends + wishlist sharing, run after 003

-- ----------------------------------------------------------------------------
-- friend requests
-- ----------------------------------------------------------------------------
alter table public.friend_requests enable row level security;

drop policy if exists "parties can read their friend requests" on public.friend_requests;
drop policy if exists "senders can create friend requests" on public.friend_requests;
drop policy if exists "receivers can respond to friend requests" on public.friend_requests;
drop policy if exists "senders can cancel their friend requests" on public.friend_requests;

create policy "parties can read their friend requests"
  on public.friend_requests for select
  to authenticated
  using (sender_id = auth.uid() or receiver_id = auth.uid());

create policy "senders can create friend requests"
  on public.friend_requests for insert
  to authenticated
  with check (sender_id = auth.uid() and sender_id <> receiver_id);

-- no update policy: accepting/declining goes through respond_to_friend_request
-- below instead of a direct table update. a plain "receiver can update" policy
-- would let the receiver rewrite sender_id/receiver_id on the row too (with
-- check only re-validates the new receiver_id, not that other columns held
-- still), which would let someone forge an accepted friendship with a third
-- party who never sent or accepted anything.

create policy "senders can cancel their friend requests"
  on public.friend_requests for delete
  to authenticated
  using (sender_id = auth.uid());


-- ----------------------------------------------------------------------------
-- username <-> id lookups, same shape as email_for_login in 001. narrow on
-- purpose: single column, single row, not a general users select.
-- ----------------------------------------------------------------------------
create or replace function public.user_id_for_username(username text)
returns uuid
language sql
security definer
set search_path = public
stable
as $$
  select u.id
  from public.users u
  where lower(u.username) = lower(trim(user_id_for_username.username))
  limit 1;
$$;

revoke all on function public.user_id_for_username(text) from public;
grant execute on function public.user_id_for_username(text) to authenticated;

-- same reasoning as set_item_purchased below: the receiver may only flip
-- status, not rewrite sender_id/receiver_id, so this goes through a function
-- instead of a general update policy.
create or replace function public.respond_to_friend_request(request_id uuid, new_status text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if new_status not in ('accepted', 'declined') then
    raise exception 'invalid status';
  end if;

  update public.friend_requests
  set status = respond_to_friend_request.new_status
  where friend_requests.request_id = respond_to_friend_request.request_id
    and friend_requests.receiver_id = auth.uid();

  if not found then
    raise exception 'not allowed';
  end if;
end;
$$;

revoke all on function public.respond_to_friend_request(uuid, text) from public;
grant execute on function public.respond_to_friend_request(uuid, text) to authenticated;

create or replace function public.username_for_id(id uuid)
returns text
language sql
security definer
set search_path = public
stable
as $$
  select u.username
  from public.users u
  where u.id = username_for_id.id;
$$;

revoke all on function public.username_for_id(uuid) from public;
grant execute on function public.username_for_id(uuid) to authenticated;


-- ----------------------------------------------------------------------------
-- wishlists' select policy needs to check wishlist_members, and
-- wishlist_members' policies need to check wishlists -- querying each other
-- directly inside a policy causes "infinite recursion detected in policy",
-- since each read re-triggers the other table's rls, forever. security
-- definer functions break the cycle: their internal queries run as the
-- function's owner, which (same as email_for_login in 001) is exempt from
-- rls on tables it owns, so calling these from a policy doesn't re-trigger
-- rls on the table being checked.
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


-- ----------------------------------------------------------------------------
-- wishlist members
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

create policy "owners or the member can remove membership"
  on public.wishlist_members for delete
  to authenticated
  using (
    user_id = auth.uid()
    or public.is_wishlist_owner(wishlist_id)
  );


-- ----------------------------------------------------------------------------
-- extend wishlists + items select policies to include members, alongside
-- owners. insert/update/delete stay owner-only (see 002 and 003).
-- ----------------------------------------------------------------------------
drop policy if exists "owners can read their wishlists" on public.wishlists;
create policy "owners can read their wishlists"
  on public.wishlists for select
  to authenticated
  using (
    auth.uid() = id
    or public.is_wishlist_member(wishlist_id)
  );

drop policy if exists "owners can read their items" on public.items;
create policy "owners can read their items"
  on public.items for select
  to authenticated
  using (
    public.is_wishlist_owner(wishlist_id)
    or public.is_wishlist_member(wishlist_id)
  );


-- ----------------------------------------------------------------------------
-- toggling purchased is the one thing a member can change on an item. rls is
-- row-level only, so a plain update policy for members would let them edit
-- everything else too. this function does just the one column, after
-- checking the caller owns the wishlist or is an accepted member of it.
-- ----------------------------------------------------------------------------
create or replace function public.set_item_purchased(item_id uuid, purchased boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1
    from public.items i
    join public.wishlists w on w.wishlist_id = i.wishlist_id
    where i.item_id = set_item_purchased.item_id
      and (
        w.id = auth.uid()
        or exists (
          select 1 from public.wishlist_members m
          where m.wishlist_id = i.wishlist_id and m.user_id = auth.uid()
        )
      )
  ) then
    raise exception 'not allowed';
  end if;

  update public.items
  set purchased = set_item_purchased.purchased
  where items.item_id = set_item_purchased.item_id;
end;
$$;

revoke all on function public.set_item_purchased(uuid, boolean) from public;
grant execute on function public.set_item_purchased(uuid, boolean) to authenticated;

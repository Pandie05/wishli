-- reserve-before-purchase, editor role, and group contributions, run after 008

-- ============================================================================
-- 1. reserve-before-purchase: claim an item before buying it
--
-- claimed_by/claimed_at work alongside the existing `purchased` column rather
-- than replacing it: claiming just locks in who's planning to buy something,
-- so two friends don't both show up with the same gift. Marking something
-- purchased without claiming it first still works exactly as before -- it
-- just claims it for you at that point, same as set_item_purchased already
-- attributes the notification to whoever flipped the flag.
-- ============================================================================
alter table public.items
  add column if not exists claimed_by uuid references public.users(id) on delete set null,
  add column if not exists claimed_at timestamptz;

create or replace function public.set_item_claimed(item_id uuid, claimed boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_wishlist_id uuid;
  v_current_claimant uuid;
begin
  select i.wishlist_id, i.claimed_by into v_wishlist_id, v_current_claimant
  from public.items i
  where i.item_id = set_item_claimed.item_id
    and (
      public.is_wishlist_owner(i.wishlist_id)
      or public.is_wishlist_member(i.wishlist_id)
    );

  if v_wishlist_id is null then
    raise exception 'not allowed';
  end if;

  if set_item_claimed.claimed then
    if v_current_claimant is not null and v_current_claimant <> auth.uid() then
      raise exception 'already claimed';
    end if;

    update public.items
    set claimed_by = auth.uid(), claimed_at = now()
    where items.item_id = set_item_claimed.item_id;
  else
    -- releasing: the claimant can back out, and the owner can clear a stale
    -- claim (e.g. a friend who claimed something and never followed through)
    if v_current_claimant is not null
       and v_current_claimant <> auth.uid()
       and not public.is_wishlist_owner(v_wishlist_id) then
      raise exception 'not allowed';
    end if;

    update public.items
    set claimed_by = null, claimed_at = null
    where items.item_id = set_item_claimed.item_id;
  end if;
end;
$$;

revoke all on function public.set_item_claimed(uuid, boolean) from public;
grant execute on function public.set_item_claimed(uuid, boolean) to authenticated;


-- redefine set_item_purchased (same as 004/007) to respect an existing claim
-- by someone else, and to auto-claim on purchase if nobody claimed it first
create or replace function public.set_item_purchased(item_id uuid, purchased boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_wishlist_id uuid;
  v_owner_id uuid;
  v_wishlist_name text;
  v_visibility text;
  v_item_name text;
  v_was_purchased boolean;
  v_claimed_by uuid;
begin
  select i.wishlist_id, i.name, i.purchased, i.claimed_by, w.id, w.name, w.purchase_visibility
    into v_wishlist_id, v_item_name, v_was_purchased, v_claimed_by, v_owner_id, v_wishlist_name, v_visibility
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

  if set_item_purchased.purchased and v_claimed_by is not null and v_claimed_by <> auth.uid() then
    raise exception 'claimed by someone else';
  end if;

  update public.items
  set purchased = set_item_purchased.purchased,
      claimed_by = case
        when set_item_purchased.purchased then coalesce(items.claimed_by, auth.uid())
        else items.claimed_by
      end,
      claimed_at = case
        when set_item_purchased.purchased then coalesce(items.claimed_at, now())
        else items.claimed_at
      end
  where items.item_id = set_item_purchased.item_id;

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


-- ============================================================================
-- 2. editor role: shared members who can add their own items to a wishlist,
-- for group-gift-idea style lists. `role` already existed (default 'viewer')
-- but nothing constrained or read it until now.
-- ============================================================================
alter table public.wishlist_members
  add constraint wishlist_members_role_check check (role in ('viewer', 'editor'));

-- same reasoning as is_wishlist_owner/is_wishlist_member in 004: a security
-- definer function so this can be called from item policies without
-- retriggering rls on wishlist_members.
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

-- promote/demote a member; owner-only. goes through a function rather than
-- an update policy for the same reason respond_to_friend_request does: a
-- plain "owner can update wishlist_members" policy would let the owner
-- rewrite wishlist_id/user_id on the row too, not just role.
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

-- extend items policies: editors can add items, and can edit/delete only the
-- items they personally added. owners keep full control over every item.
drop policy if exists "owners can insert their items" on public.items;
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

drop policy if exists "owners can update their items" on public.items;
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

drop policy if exists "owners can delete their items" on public.items;
create policy "owners can delete any item, editors their own"
  on public.items for delete
  to authenticated
  using (
    public.is_wishlist_owner(wishlist_id)
    or (public.is_wishlist_editor(wishlist_id) and user_id = auth.uid())
  );


-- ============================================================================
-- 3. group contributions: friends pool money toward one item instead of one
-- person claiming/buying the whole thing.
-- ============================================================================
create table if not exists public.item_contributions (
  contribution_id uuid primary key default gen_random_uuid(),
  item_id     uuid not null references public.items(item_id) on delete cascade,
  user_id     uuid not null references public.users(id) on delete cascade,
  amount      decimal not null check (amount > 0),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  -- one row per person per item; change your pledge by updating the amount
  unique (item_id, user_id)
);

comment on table public.item_contributions is 'Per-person amounts pledged toward one item, for splitting the cost of a gift.';

drop trigger if exists item_contributions_set_updated_at on public.item_contributions;
create trigger item_contributions_set_updated_at
  before update on public.item_contributions
  for each row execute function public.set_updated_at();

alter table public.item_contributions enable row level security;

drop policy if exists "wishlist owners and members can read contributions" on public.item_contributions;
drop policy if exists "members can contribute to items" on public.item_contributions;
drop policy if exists "contributors can update their own contribution" on public.item_contributions;
drop policy if exists "contributors can delete their own contribution" on public.item_contributions;

-- read visibility deliberately mirrors items.purchased: the row is readable
-- by the owner too (same as set_item_purchased already lets the owner see
-- who marked things purchased), and purchase_visibility is what the client
-- uses to decide whether to display who/how much to the owner vs a total.
create policy "wishlist owners and members can read contributions"
  on public.item_contributions for select
  to authenticated
  using (
    exists (
      select 1 from public.items i
      where i.item_id = item_contributions.item_id
        and (public.is_wishlist_owner(i.wishlist_id) or public.is_wishlist_member(i.wishlist_id))
    )
  );

-- members can pledge to items on lists they're shared on, but not to items
-- on their own wishlist (you can't contribute to your own gift)
create policy "members can contribute to items"
  on public.item_contributions for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.items i
      where i.item_id = item_contributions.item_id
        and public.is_wishlist_member(i.wishlist_id)
        and not public.is_wishlist_owner(i.wishlist_id)
    )
  );

create policy "contributors can update their own contribution"
  on public.item_contributions for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "contributors can delete their own contribution"
  on public.item_contributions for delete
  to authenticated
  using (user_id = auth.uid());

-- ============================================================================
-- wishli — reserving part of a wish (item_claims) and pooling money toward
-- one (item_contributions), plus the purchase flow that ties into both.
-- Run after 004.
--
-- Run this once in the Supabase dashboard: SQL Editor -> New query -> Run.
-- Safe to re-run.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. Contributions -- friends pool money toward one item instead of one
-- person buying the whole thing
-- ----------------------------------------------------------------------------
create table if not exists public.item_contributions (
  contribution_id uuid        primary key default gen_random_uuid(),
  item_id         uuid        not null references public.items (item_id) on delete cascade,
  user_id         uuid        not null references public.users (id) on delete cascade,
  amount          decimal     not null check (amount > 0),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  -- one row per person per item; change a pledge by updating the amount
  unique (item_id, user_id)
);

comment on table public.item_contributions is 'Per-person amounts pledged toward one item, for splitting the cost of a gift.';

create index if not exists item_contributions_user_id_idx on public.item_contributions (user_id);

drop trigger if exists item_contributions_set_updated_at on public.item_contributions;
create trigger item_contributions_set_updated_at
  before update on public.item_contributions
  for each row execute function public.set_updated_at();

-- an update policy that only checks who owns the row would let a
-- contributor rewrite item_id to point their pledge at any item at all,
-- bypassing the insert policy's membership/not-owner checks entirely since
-- those only run on insert. a trigger is what actually closes it -- with
-- check has no way to compare against the row's previous values, only a
-- trigger sees both.
create or replace function public.prevent_contribution_reassignment()
returns trigger
language plpgsql
as $$
begin
  if new.item_id <> old.item_id or new.user_id <> old.user_id then
    raise exception 'cannot change item_id or user_id on a contribution';
  end if;
  return new;
end;
$$;

drop trigger if exists item_contributions_immutable_identity on public.item_contributions;
create trigger item_contributions_immutable_identity
  before update on public.item_contributions
  for each row execute function public.prevent_contribution_reassignment();

alter table public.item_contributions enable row level security;

drop policy if exists "wishlist owners and members can read contributions" on public.item_contributions;
drop policy if exists "members can contribute to items" on public.item_contributions;
drop policy if exists "contributors can update their own contribution" on public.item_contributions;
drop policy if exists "contributors can delete their own contribution" on public.item_contributions;

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
-- on their own wishlist -- you can't contribute to your own gift
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


-- ----------------------------------------------------------------------------
-- 2. Claims -- who has reserved how many of a (possibly multi-quantity) item
-- ----------------------------------------------------------------------------
create table if not exists public.item_claims (
  claim_id   uuid        primary key default gen_random_uuid(),
  item_id    uuid        not null references public.items (item_id) on delete cascade,
  user_id    uuid        not null references public.users (id) on delete cascade,
  quantity   int         not null check (quantity > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- one row per person per item; reserve more or fewer by updating quantity
  unique (item_id, user_id)
);

comment on table public.item_claims is 'Per-person counts reserved against one item, so several people can each take part of a multi-quantity wish.';

create index if not exists item_claims_user_id_idx on public.item_claims (user_id);

drop trigger if exists item_claims_set_updated_at on public.item_claims;
create trigger item_claims_set_updated_at
  before update on public.item_claims
  for each row execute function public.set_updated_at();

-- you cannot reserve more than is left. `for update` on the item row
-- serialises two people reserving the last one at the same moment --
-- without it both could read "1 left" and both insert.
create or replace function public.enforce_claim_quantity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_wanted  int;
  v_claimed int;
begin
  select i.quantity into v_wanted
  from public.items i
  where i.item_id = new.item_id
  for update;

  if v_wanted is null then
    raise exception 'no such item';
  end if;

  -- excluding this row makes the same check correct for an update as well
  -- as an insert; on insert nothing matches the not-yet-stored claim_id
  select coalesce(sum(c.quantity), 0) into v_claimed
  from public.item_claims c
  where c.item_id = new.item_id
    and c.claim_id <> new.claim_id;

  if v_claimed + new.quantity > v_wanted then
    raise exception 'only % of that left to reserve', v_wanted - v_claimed;
  end if;

  return new;
end;
$$;

drop trigger if exists item_claims_within_quantity on public.item_claims;
create trigger item_claims_within_quantity
  before insert or update on public.item_claims
  for each row execute function public.enforce_claim_quantity();

-- the same rule from the other side: editing a wish down to fewer than are
-- already reserved would leave the claims adding up to more than exists
create or replace function public.enforce_quantity_covers_claims()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claimed int;
begin
  if new.quantity >= old.quantity then
    return new;
  end if;

  select coalesce(sum(c.quantity), 0) into v_claimed
  from public.item_claims c
  where c.item_id = new.item_id;

  if new.quantity < v_claimed then
    raise exception '% are already reserved -- release some first', v_claimed;
  end if;

  return new;
end;
$$;

drop trigger if exists items_quantity_covers_claims on public.items;
create trigger items_quantity_covers_claims
  before update of quantity on public.items
  for each row execute function public.enforce_quantity_covers_claims();

-- same gap item_contributions closed above: without this, an update policy
-- checking only who owns the row would let a claimant re-point item_id at
-- an item they were never allowed to insert against
create or replace function public.prevent_claim_reassignment()
returns trigger
language plpgsql
as $$
begin
  if new.item_id <> old.item_id or new.user_id <> old.user_id then
    raise exception 'cannot change item_id or user_id on a claim';
  end if;
  return new;
end;
$$;

drop trigger if exists item_claims_immutable_identity on public.item_claims;
create trigger item_claims_immutable_identity
  before update on public.item_claims
  for each row execute function public.prevent_claim_reassignment();

-- mirrors item_contributions, except the list owner may also reserve -- an
-- owner buying one of their own multi-quantity wishes is reasonable
alter table public.item_claims enable row level security;

drop policy if exists "wishlist owners and members can read claims" on public.item_claims;
drop policy if exists "owners and members can claim items" on public.item_claims;
drop policy if exists "claimants can update their own claim" on public.item_claims;
drop policy if exists "claimants and list owners can delete a claim" on public.item_claims;

create policy "wishlist owners and members can read claims"
  on public.item_claims for select
  to authenticated
  using (
    exists (
      select 1 from public.items i
      where i.item_id = item_claims.item_id
        and (public.is_wishlist_owner(i.wishlist_id) or public.is_wishlist_member(i.wishlist_id))
    )
  );

create policy "owners and members can claim items"
  on public.item_claims for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.items i
      where i.item_id = item_claims.item_id
        and (public.is_wishlist_owner(i.wishlist_id) or public.is_wishlist_member(i.wishlist_id))
    )
  );

create policy "claimants can update their own claim"
  on public.item_claims for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- the owner clearing someone else's stale claim is the one case that is
-- not self-service
create policy "claimants and list owners can delete a claim"
  on public.item_claims for delete
  to authenticated
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.items i
      where i.item_id = item_claims.item_id and public.is_wishlist_owner(i.wishlist_id)
    )
  );


-- ----------------------------------------------------------------------------
-- 3. Marking a wish bought
--
-- `purchased` is a whole-item flag: it means the wish is done, however many
-- were wanted. Buying it blocks if someone else has reserved part of it and
-- you have not -- it is not yours to mark bought. Buying it with no claim
-- on record still records one for you, which is how the owner sees who did
-- it. Also notifies the owner (respecting purchase_visibility) unless they
-- are the one who bought it.
--
-- The insert below carries no column list on its `on conflict` clause on
-- purpose: a conflict target is a bare list of column names and cannot take
-- a table qualifier, and naming item_id there is ambiguous against this
-- function's own parameter of the same name. `on conflict do nothing` with
-- no target catches any unique violation on the table instead, and there is
-- nothing left to be ambiguous.
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

revoke all on function public.set_item_purchased(uuid, boolean) from public;
grant execute on function public.set_item_purchased(uuid, boolean) to authenticated;

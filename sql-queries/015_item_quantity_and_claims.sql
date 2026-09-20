-- ============================================================================
-- wishli — "I want 2 of these". Run after 014.
--
-- Until now an item was a single thing: one `claimed_by` column, so the first
-- person to reserve it took the whole item and nobody else could get near it.
-- That makes a wish like "3 pairs of socks" impossible to express.
--
-- items.quantity is how many the owner wants. Who reserved how many moves out
-- of items and into its own table, shaped exactly like item_contributions
-- from 009: one row per person per item, a unique (item_id, user_id), an
-- identity-immutability trigger of the same kind 010 added, and the same
-- owner-or-member read policy. An item is fully spoken for when the claimed
-- quantities add up to items.quantity.
--
-- DESTRUCTIVE: this drops items.claimed_by / items.claimed_at. Existing
-- claims are copied into item_claims first (as quantity 1, which is what they
-- meant), so no reservation is lost -- but the columns themselves do not come
-- back. Safe to re-run: after the first run the backfill finds no columns to
-- read and skips itself.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. How many of the thing the owner actually wants
-- ----------------------------------------------------------------------------
alter table public.items add column if not exists quantity int not null default 1;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'items_quantity_check' and conrelid = 'public.items'::regclass
  ) then
    alter table public.items add constraint items_quantity_check check (quantity > 0);
  end if;
end $$;

comment on column public.items.quantity is 'How many of this item the owner wants. Reserved counts in item_claims add up against it.';


-- ----------------------------------------------------------------------------
-- 2. Who reserved how many
-- ----------------------------------------------------------------------------
create table if not exists public.item_claims (
  claim_id   uuid primary key default gen_random_uuid(),
  item_id    uuid not null references public.items(item_id) on delete cascade,
  user_id    uuid not null references public.users(id) on delete cascade,
  quantity   int not null check (quantity > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- one row per person per item; reserve more or fewer by updating quantity
  unique (item_id, user_id)
);

comment on table public.item_claims is 'Per-person counts reserved against one item, so several people can each take part of a multi-quantity wish.';

drop trigger if exists item_claims_set_updated_at on public.item_claims;
create trigger item_claims_set_updated_at
  before update on public.item_claims
  for each row execute function public.set_updated_at();


-- ----------------------------------------------------------------------------
-- 3. Carry the old single-claimant data across, then drop it
--
-- Wrapped in a column-exists check so a second run is a no-op rather than an
-- error on the missing column.
-- ----------------------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'items' and column_name = 'claimed_by'
  ) then
    execute $backfill$
      insert into public.item_claims (item_id, user_id, quantity, created_at)
      select i.item_id, i.claimed_by, 1, coalesce(i.claimed_at, now())
      from public.items i
      where i.claimed_by is not null
      on conflict (item_id, user_id) do nothing;
    $backfill$;
  end if;
end $$;

alter table public.items drop column if exists claimed_by;
alter table public.items drop column if exists claimed_at;


-- ----------------------------------------------------------------------------
-- 4. You cannot reserve more than is left
--
-- `for update` on the item row serialises two people reserving the last one
-- at the same moment -- without it both could read "1 left" and both insert.
-- ----------------------------------------------------------------------------
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

  -- excluding this row makes the same check correct for an update as well as
  -- an insert; on insert nothing matches the not-yet-stored claim_id anyway
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
-- already reserved would leave the claims adding up to more than exists. The
-- claim trigger above cannot catch this -- it only runs when a claim changes,
-- and here it is the item moving underneath them.
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


-- same gap 010 closed on item_contributions: an update policy that only
-- checks who owns the row would let a claimant re-point item_id at an item
-- they were never allowed to insert against, since with check only re-runs
-- the insert rules on the new values, not the membership behind them.
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


-- ----------------------------------------------------------------------------
-- 5. RLS — mirrors item_contributions, except that the list owner may also
-- reserve (set_item_claimed allowed that before, and an owner buying one of
-- their own multi-quantity wishes is reasonable).
-- ----------------------------------------------------------------------------
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

-- the owner clearing someone else's stale claim is the one case that is not
-- self-service, carried over from set_item_claimed's release branch in 009
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
-- 6. Reserving is now a plain insert against the policies above, so the
-- single-claimant RPC has nothing left to do.
-- ----------------------------------------------------------------------------
drop function if exists public.set_item_claimed(uuid, boolean);


-- ----------------------------------------------------------------------------
-- 7. set_item_purchased, rewritten off claimed_by
--
-- `purchased` stays a whole-item flag: it means the wish is done, however
-- many were wanted. The guard it used to do with claimed_by now asks the same
-- question of item_claims -- somebody else has reserved part of this and you
-- have not, so it is not yours to mark bought. Buying it with no claim on
-- record still records one for you, which is how the owner sees who did it.
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

  -- no claim of your own yet: record one for whatever is still unspoken for,
  -- so buying without reserving first still attributes the purchase
  if set_item_purchased.purchased and v_mine = 0 and v_claimed < v_quantity then
    -- no column list on the conflict target on purpose: it cannot take a
    -- table qualifier, so naming item_id there is ambiguous against this
    -- function's own parameter of the same name (see 020)
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
-- 8. The public share view has to stop reading claimed_by too (013).
--
-- Dropped and recreated rather than replaced: the returned column list grows
-- by two, and `create or replace function` cannot change a return type.
-- An anonymous visitor still never learns *who* reserved anything, only how
-- many are left.
-- ----------------------------------------------------------------------------
drop function if exists public.get_shared_wishlist_items(uuid);

create function public.get_shared_wishlist_items(token uuid)
returns table (
  item_id uuid,
  name text,
  product_url text,
  image_url text,
  price decimal,
  notes text,
  quantity int,
  claimed_quantity int,
  reserved boolean
)
language sql
security definer
set search_path = public
stable
as $$
  select i.item_id, i.name, i.product_url, i.image_url, i.price, i.notes,
         i.quantity,
         coalesce(c.taken, 0)::int as claimed_quantity,
         (i.purchased or coalesce(c.taken, 0) >= i.quantity) as reserved
  from public.items i
  join public.wishlists w on w.wishlist_id = i.wishlist_id
  left join (
    select item_id, sum(quantity) as taken
    from public.item_claims
    group by item_id
  ) c on c.item_id = i.item_id
  where w.share_token = get_shared_wishlist_items.token;
$$;

revoke all on function public.get_shared_wishlist_items(uuid) from public;
grant execute on function public.get_shared_wishlist_items(uuid) to anon, authenticated;

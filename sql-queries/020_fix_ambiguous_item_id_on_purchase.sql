-- ============================================================================
-- wishli — fix "column reference item_id is ambiguous" when marking a wish
-- bought. Run after 019.
--
-- 015 gave set_item_purchased an auto-claim step, so that buying something
-- you had not reserved still records who bought it:
--
--     insert into public.item_claims (item_id, user_id, quantity)
--     values (...)
--     on conflict (item_id, user_id) do nothing;
--
-- The conflict target is the problem. Everywhere else in that function the
-- parameter is written out in full as set_item_purchased.item_id, but a
-- conflict target is a bare list of column names and cannot take a table
-- qualifier -- so plpgsql sees `item_id`, finds both the function's parameter
-- and the column, and refuses to guess.
--
-- It only ever fired on the one path where that insert runs: no claim of your
-- own yet. Reserving first skipped the insert entirely, which is why marking
-- something bought appeared to work only after reserving it.
--
-- The fix is `on conflict do nothing` with no target at all. It is valid
-- Postgres, it catches any unique violation on the table, and naming no
-- columns means there is nothing left to be ambiguous. Nothing else in the
-- function changes.
-- ============================================================================

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
  -- so buying without reserving first still attributes the purchase.
  -- `on conflict do nothing` carries no column list on purpose -- see above.
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

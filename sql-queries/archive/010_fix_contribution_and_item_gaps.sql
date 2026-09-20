-- close two gaps from 009, run after 009
--
-- both are the same shape of bug as respond_to_friend_request's original
-- version (004/006): an update policy that only checks who owns the row,
-- not whether they're changing a column that identifies WHICH row it is.
--
-- item_contributions' update policy only checks user_id = auth.uid(), which
-- let a contributor rewrite item_id to point their pledge at any item at
-- all -- including one on a wishlist they have no access to, bypassing the
-- insert policy's membership/not-owner checks entirely since those only run
-- on insert. items' editor update policy had a related gap: nothing tied
-- the old and new wishlist_id together, so an editor with access to two
-- wishlists could relocate an item they added from one to the other.
--
-- fixed with triggers rather than tighter policies, since with check has no
-- way to compare against the old row's values -- only a trigger sees both.

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

-- rls for items, run after 002

alter table public.items enable row level security;

drop policy if exists "owners can read their items" on public.items;
drop policy if exists "owners can insert their items" on public.items;
drop policy if exists "owners can update their items" on public.items;
drop policy if exists "owners can delete their items" on public.items;

-- no sharing yet, access is gated on owning the parent wishlist
create policy "owners can read their items"
  on public.items for select
  to authenticated
  using (
    exists (
      select 1 from public.wishlists w
      where w.wishlist_id = items.wishlist_id and w.id = auth.uid()
    )
  );

create policy "owners can insert their items"
  on public.items for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.wishlists w
      where w.wishlist_id = items.wishlist_id and w.id = auth.uid()
    )
  );

create policy "owners can update their items"
  on public.items for update
  to authenticated
  using (
    exists (
      select 1 from public.wishlists w
      where w.wishlist_id = items.wishlist_id and w.id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.wishlists w
      where w.wishlist_id = items.wishlist_id and w.id = auth.uid()
    )
  );

create policy "owners can delete their items"
  on public.items for delete
  to authenticated
  using (
    exists (
      select 1 from public.wishlists w
      where w.wishlist_id = items.wishlist_id and w.id = auth.uid()
    )
  );

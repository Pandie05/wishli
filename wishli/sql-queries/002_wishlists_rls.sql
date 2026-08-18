-- rls for wishlists, run after 001

alter table public.wishlists enable row level security;

drop policy if exists "owners can read their wishlists" on public.wishlists;
drop policy if exists "owners can insert their wishlists" on public.wishlists;
drop policy if exists "owners can update their wishlists" on public.wishlists;
drop policy if exists "owners can delete their wishlists" on public.wishlists;

-- id column on wishlists is the owner's user id, not the wishlist's own id
-- (that's wishlist_id) keep match 001.
create policy "owners can read their wishlists"
  on public.wishlists for select
  to authenticated
  using (auth.uid() = id);

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

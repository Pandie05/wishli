-- ============================================================================
-- wishli — image uploads, public read-only share links, and public profile
-- pages. Run after 005 (get_shared_wishlist_items reads item_claims).
--
-- NOTE: the storage section creates policies on storage.objects, which
-- needs the elevated role the dashboard's SQL editor already runs as. If
-- you run this from a client connected as a plain user those statements
-- will fail.
--
-- Run this once in the Supabase dashboard: SQL Editor -> New query -> Run.
-- Safe to re-run.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. Image uploads
--
-- One public bucket holds wishlist covers, item photos, and avatars. Reads
-- are open because the URLs end up in <img src> on pages the client renders
-- directly; writes are locked to the uploader's own folder, so the object
-- key must start with their user id (e.g. "<uid>/9f3c....jpg").
--
-- "Public" here means unguessable-but-readable: knowing the URL is enough.
-- Do not put anything sensitive in this bucket.
-- ----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'wishli-images',
  'wishli-images',
  true,
  5242880, -- 5 MB, matching the hint the upload control shows
  array['image/png', 'image/jpeg', 'image/webp', 'image/gif']
)
on conflict (id) do update
set public             = excluded.public,
    file_size_limit    = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "wishli images are readable"        on storage.objects;
drop policy if exists "users upload to their own folder"  on storage.objects;
drop policy if exists "users replace their own uploads"   on storage.objects;
drop policy if exists "users delete their own uploads"    on storage.objects;

create policy "wishli images are readable"
  on storage.objects for select
  using (bucket_id = 'wishli-images');

create policy "users upload to their own folder"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'wishli-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "users replace their own uploads"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'wishli-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "users delete their own uploads"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'wishli-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );


-- ----------------------------------------------------------------------------
-- 2. Public read-only share links
--
-- Null share_token means link-sharing is off for that wishlist. There is
-- deliberately no RLS policy granting anon select on wishlists or items
-- directly -- a policy like "using (share_token is not null)" would let
-- anyone enumerate every publicly-shared list on the whole site with one
-- unfiltered query, not just the one list whose token they actually have.
-- Instead, anonymous access goes through these two narrow functions, each
-- of which only ever returns the one row matching the exact token given.
--
-- Who claimed something is not part of this: that is fine for a signed-in
-- member to see, not for an anonymous visitor -- they only learn how many
-- are left, not who has them.
-- ----------------------------------------------------------------------------
create or replace function public.get_shared_wishlist(token uuid)
returns table (
  wishlist_id uuid,
  name text,
  description text,
  occasion text,
  target_date date,
  item_img text,
  budget decimal
)
language sql
security definer
set search_path = public
stable
as $$
  select w.wishlist_id, w.name, w.description, w.occasion, w.target_date, w.item_img, w.budget
  from public.wishlists w
  where w.share_token = get_shared_wishlist.token;
$$;

revoke all on function public.get_shared_wishlist(uuid) from public;
grant execute on function public.get_shared_wishlist(uuid) to anon, authenticated;

create or replace function public.get_shared_wishlist_items(token uuid)
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


-- ----------------------------------------------------------------------------
-- 3. Public profile pages at /u/<username>
--
-- Same shape as the share-link functions above: no blanket anon select
-- policy on users or wishlists, just two narrow security-definer functions
-- that answer one question about one handle and nothing else. A profile
-- only lists wishlists that already have link-sharing enabled -- it is an
-- index of things the user chose to make linkable, never a window into
-- private lists, even though public_profile now defaults to true.
--
-- The parameter is `handle`, not `username`, so nothing in the body can be
-- read as either the argument or the returned column of the same name.
-- ----------------------------------------------------------------------------
create or replace function public.get_public_profile(handle text)
returns table (
  username text,
  avatar_url text
)
language sql
security definer
set search_path = public
stable
as $$
  select u.username, u.avatar_url
  from public.users u
  where lower(u.username) = lower(get_public_profile.handle)
    and u.public_profile;
$$;

revoke all on function public.get_public_profile(text) from public;
grant execute on function public.get_public_profile(text) to anon, authenticated;

create or replace function public.get_public_profile_wishlists(handle text)
returns table (
  wishlist_id uuid,
  name text,
  description text,
  occasion text,
  target_date date,
  item_img text,
  share_token uuid,
  item_count int
)
language sql
security definer
set search_path = public
stable
as $$
  select w.wishlist_id, w.name, w.description, w.occasion, w.target_date, w.item_img,
         w.share_token,
         (select count(*) from public.items i where i.wishlist_id = w.wishlist_id)::int
  from public.wishlists w
  join public.users u on u.id = w.id
  where lower(u.username) = lower(get_public_profile_wishlists.handle)
    and u.public_profile
    and w.share_token is not null
  order by w.target_date asc nulls last, w.created_at desc;
$$;

revoke all on function public.get_public_profile_wishlists(text) from public;
grant execute on function public.get_public_profile_wishlists(text) to anon, authenticated;

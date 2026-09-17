-- ============================================================================
-- wishli — opt-in public profile pages at /u/<username>. Run after 015.
--
-- Same shape as the share-link functions in 013: no blanket anon select
-- policy on users or wishlists, just two narrow security-definer functions
-- that answer one question about one handle and nothing else.
--
-- The opt-in matters. A share token is a private URL you hand to someone; a
-- profile is discoverable by guessing a username. Turning a token on must not
-- silently publish that list under your name, so a profile stays invisible
-- until public_profile is switched on in Settings, and even then only lists
-- wishlists that already have link-sharing enabled.
-- ============================================================================

alter table public.users add column if not exists public_profile boolean not null default false;

comment on column public.users.public_profile is 'Opt-in: when true, /u/<username> lists this user''s link-shared wishlists to anyone.';


-- ----------------------------------------------------------------------------
-- The parameter is `handle`, not `username`, so nothing in the body can be
-- read as either the argument or the returned column of the same name. Every
-- column reference is alias-qualified for the same reason (see 004's notes on
-- user_id_for_username).
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


-- Only lists that already have a share token: the profile is an index of
-- things the user chose to make linkable, never a window into private lists.
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

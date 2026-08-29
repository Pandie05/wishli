-- ============================================================================
-- wishli — wishlist occasion/target date, a real 1–5 priority scale, image
-- uploads, and friend search. Run after 010.
--
-- Run this once in the Supabase dashboard: SQL Editor -> New query -> Run.
-- Safe to re-run (everything is "if not exists" / "or replace" / idempotent).
--
-- NOTE: section 3 creates policies on storage.objects, which needs the
-- elevated role the dashboard's SQL editor already runs as. If you run this
-- from a client connected as a plain user those statements will fail.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. Occasion and target date on a wishlist
--
-- Both are optional and purely descriptive -- nothing keys off them, they are
-- there so a list can say what it is for and when it is needed by. Occasion is
-- free text rather than an enum so the picker's options can change without a
-- migration.
-- ----------------------------------------------------------------------------
alter table public.wishlists
  add column if not exists occasion    text,
  add column if not exists target_date date;

comment on column public.wishlists.occasion is 'Free-text occasion label, e.g. Birthday. Null means none chosen.';
comment on column public.wishlists.target_date is 'Optional date the list is needed by.';


-- ----------------------------------------------------------------------------
-- 2. items.priority becomes a real 1–5 scale
--
-- Until now the column was used as a flag: 1 meant "most wanted" and null
-- meant normal. Under a 1–5 scale a bare 1 would read as the *lowest* rating,
-- silently demoting everything that had been flagged -- so existing 1s are
-- moved to 5 first, and only then is the range enforced.
--
-- The order matters: remap before clamping, clamp before adding the check,
-- or the constraint would fail on whatever is already out of range.
-- ----------------------------------------------------------------------------
update public.items set priority = 5 where priority = 1;

update public.items
set priority = null
where priority is not null and priority not between 1 and 5;

alter table public.items drop constraint if exists items_priority_range;

alter table public.items
  add constraint items_priority_range
  check (priority is null or priority between 1 and 5);

comment on column public.items.priority is '1 (just an idea) to 5 (top of my list). Null means unrated.';


-- ----------------------------------------------------------------------------
-- 3. Image uploads
--
-- One public bucket holds both wishlist covers and item photos. Reads are
-- open because the URLs end up in <img src> on pages the client renders
-- directly; writes are locked to the uploader's own folder, so the object key
-- must start with their user id (e.g. "<uid>/9f3c....jpg").
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
-- 4. Friend search for the "invite friends" field
--
-- user_id_for_username only does exact matches, which is no use to a
-- type-ahead. This is security definer because RLS on public.users only lets
-- you read your own row -- but it can only ever return people you already
-- have an accepted friendship with, so it is not a way to enumerate accounts.
-- ----------------------------------------------------------------------------
create or replace function public.search_friends(term text)
returns table (id uuid, username text)
language sql
security definer
set search_path = public
stable
as $$
  select u.id, u.username
  from public.users u
  where u.id <> auth.uid()
    and exists (
      select 1 from public.friend_requests fr
      where fr.status = 'accepted'
        and (
          (fr.sender_id = auth.uid() and fr.receiver_id = u.id)
          or (fr.receiver_id = auth.uid() and fr.sender_id = u.id)
        )
    )
    and (
      term is null
      or btrim(term) = ''
      -- the field accepts "@handle" as well as a bare name. btrim's two-arg
      -- form takes a set of characters to strip; the "both ... from" spelling
      -- belongs to trim(), not btrim().
      or u.username ilike '%' || btrim(btrim(term), '@') || '%'
    )
  order by u.username
  limit 8;
$$;

revoke all on function public.search_friends(text) from public;
grant execute on function public.search_friends(text) to authenticated;

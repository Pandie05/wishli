-- ============================================================================
-- wishli — the notifications table and the functions that write to it.
-- Run after 002.
--
-- The table and its RLS are self-contained (users + wishlists already
-- exist). The two trigger functions below are defined here too, since both
-- just need users/wishlists/username_for_id, all of which already exist --
-- but the triggers that actually wire them up onto friend_requests and
-- wishlist_members live in 004_friends_and_sharing.sql, since those tables
-- do not exist yet.
--
-- Run this once in the Supabase dashboard: SQL Editor -> New query -> Run.
-- Safe to re-run.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. The table
-- ----------------------------------------------------------------------------
create table if not exists public.notifications (
  notification_id uuid        primary key default gen_random_uuid(),
  user_id         uuid        not null references public.users (id) on delete cascade,
  sender_id       uuid        references public.users (id) on delete set null,
  wishlist_id     uuid        references public.wishlists (wishlist_id) on delete cascade,
  type            text        not null,
  message         text,
  is_read         boolean     not null default false,
  created_at      timestamptz not null default now()
);

-- the rail's unread badge counts by (user_id, is_read); a partial index
-- keeps that one small since read rows are the ones that accumulate. the
-- notifications page reads newest-first.
create index if not exists notifications_unread_idx
  on public.notifications (user_id) where not is_read;
create index if not exists notifications_user_created_idx
  on public.notifications (user_id, created_at desc);


-- ----------------------------------------------------------------------------
-- 2. Row level security
--
-- No insert policy: rls enabled + no policy means clients can never insert
-- one directly, for themselves or anyone else. Every row comes from a
-- trigger or an existing security definer function instead.
-- ----------------------------------------------------------------------------
alter table public.notifications enable row level security;

drop policy if exists "users can read their notifications"   on public.notifications;
drop policy if exists "users can update their notifications" on public.notifications;
drop policy if exists "users can delete their notifications" on public.notifications;

create policy "users can read their notifications"
  on public.notifications for select
  to authenticated
  using (user_id = auth.uid());

create policy "users can update their notifications"
  on public.notifications for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "users can delete their notifications"
  on public.notifications for delete
  to authenticated
  using (user_id = auth.uid());


-- ----------------------------------------------------------------------------
-- 3. A new friend request notifies the receiver
-- ----------------------------------------------------------------------------
create or replace function public.notify_on_friend_request()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.notifications (user_id, sender_id, type, message)
  values (
    new.receiver_id,
    new.sender_id,
    'friend_request',
    public.username_for_id(new.sender_id) || ' sent you a friend request'
  );
  return new;
end;
$$;


-- ----------------------------------------------------------------------------
-- 4. Getting added to a wishlist notifies the new member
-- ----------------------------------------------------------------------------
create or replace function public.notify_on_wishlist_share()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_wishlist_name text;
  v_owner_id uuid;
begin
  select w.name, w.id into v_wishlist_name, v_owner_id
  from public.wishlists w
  where w.wishlist_id = new.wishlist_id;

  insert into public.notifications (user_id, sender_id, wishlist_id, type, message)
  values (
    new.user_id,
    v_owner_id,
    new.wishlist_id,
    'wishlist_shared',
    coalesce(v_wishlist_name, 'A wishlist') || ' was shared with you'
  );
  return new;
end;
$$;

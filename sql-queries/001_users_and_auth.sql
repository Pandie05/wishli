-- ============================================================================
-- wishli — users table, auth plumbing, and username/email lookup helpers.
--
-- Supabase keeps credentials in auth.users, which apps are not allowed to
-- read directly. public.users is the profile row apps actually query, one
-- per account, kept in step with auth.users by the triggers below.
--
-- Run this once in the Supabase dashboard: SQL Editor -> New query -> Run.
-- Safe to re-run (everything is "if not exists" / "or replace").
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. The users table
-- ----------------------------------------------------------------------------
create table if not exists public.users (
  id             uuid        primary key references auth.users (id) on delete cascade,
  username       text        not null,
  email          text        not null,
  -- profile picture, uploaded to the wishli-images bucket. null shows
  -- initials instead.
  avatar_url     text,
  -- default true: /u/<username> lists this user's link-shared wishlists to
  -- anyone unless they opt out in Settings.
  public_profile boolean     not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint users_username_length check (char_length(username) between 3 and 30),
  constraint users_username_format check (username ~ '^[A-Za-z0-9_.]+$')
);

-- usernames and emails are unique but case-insensitive: "Jayden" and
-- "jayden" are the same account.
create unique index if not exists users_username_lower_idx on public.users (lower(username));
create unique index if not exists users_email_lower_idx    on public.users (lower(email));

comment on table  public.users is 'Public profile for each auth.users account.';
comment on column public.users.username is 'Case-insensitive unique handle, also usable to log in.';
comment on column public.users.avatar_url is 'Profile picture, uploaded to the wishli-images bucket. Null means show initials instead.';
comment on column public.users.public_profile is 'Default true: /u/<username> lists this user''s link-shared wishlists to anyone unless they opt out in Settings.';


-- ----------------------------------------------------------------------------
-- 2. Keep updated_at honest -- reused by every other table with the column
-- ----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists users_set_updated_at on public.users;
create trigger users_set_updated_at
  before update on public.users
  for each row execute function public.set_updated_at();


-- ----------------------------------------------------------------------------
-- 3. Row level security
--
-- A signed-in user can read and edit their own row and nothing else. Rows
-- are never inserted from the client -- the trigger in section 4 does it.
-- ----------------------------------------------------------------------------
alter table public.users enable row level security;

drop policy if exists "Users can read their own profile"   on public.users;
drop policy if exists "Users can update their own profile" on public.users;

create policy "Users can read their own profile"
  on public.users for select
  to authenticated
  using (auth.uid() = id);

create policy "Users can update their own profile"
  on public.users for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);


-- ----------------------------------------------------------------------------
-- 4. Create the profile row automatically on sign up
--
-- When the create-account page calls supabase.auth.signUp() with
-- `options: { data: { username: '...' } }`, this trigger copies the
-- username and email into public.users. Google sign-in has no username
-- field, so it falls back to the email handle. A duplicate username raises
-- a unique violation, which surfaces to the client as a failed sign up.
-- ----------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (id, username, email)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data ->> 'username',
      split_part(new.email, '@', 1)
    ),
    new.email
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();


-- ----------------------------------------------------------------------------
-- 5. Keep public.users.email in step with auth.users.email
--
-- The settings page changes an email through supabase.auth.updateUser(),
-- which only writes auth.users, and only once the confirmation link is
-- clicked. The copy in public.users has to be updated from the database
-- side or it goes stale -- and email_for_login (below) reads that copy, so
-- a stale row means logging in with the new address silently fails.
-- ----------------------------------------------------------------------------
create or replace function public.sync_user_email()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.users
  set email = new.email
  where users.id = new.id;

  return new;
end;
$$;

drop trigger if exists on_auth_user_email_changed on auth.users;
create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row
  when (old.email is distinct from new.email)
  execute function public.sync_user_email();


-- ----------------------------------------------------------------------------
-- 6. Log in with a username
--
-- Supabase's signInWithPassword() only accepts an email, so the login page
-- first trades the typed identifier for an email through this function. It
-- is security definer because anonymous visitors cannot select from
-- public.users.
--
-- NOTE: this deliberately lets an anonymous caller learn the email address
-- behind a username. That is the cost of username login. Keep Supabase's
-- default auth rate limits on, and if that trade is not acceptable, drop
-- this function and make the login page email-only.
-- ----------------------------------------------------------------------------
create or replace function public.email_for_login(identifier text)
returns text
language sql
security definer
set search_path = public
stable
as $$
  select u.email
  from public.users u
  where lower(u.username) = lower(trim(identifier))
     or lower(u.email)    = lower(trim(identifier))
  limit 1;
$$;

revoke all on function public.email_for_login(text) from public;
grant execute on function public.email_for_login(text) to anon, authenticated;


-- ----------------------------------------------------------------------------
-- 7. Username <-> id lookups
--
-- RLS on public.users only exposes your own row, so these security definer
-- functions are what let an authenticated caller resolve someone else's
-- username or id. Each is narrow on purpose: a single column, or (for
-- usernames_for_ids) a whole set answered in one round trip instead of one
-- request per row, for every page that shows a list of people.
-- ----------------------------------------------------------------------------
create or replace function public.user_id_for_username(username text)
returns uuid
language sql
security definer
set search_path = public
stable
as $$
  select u.id
  from public.users u
  where lower(u.username) = lower(trim(user_id_for_username.username))
  limit 1;
$$;

revoke all on function public.user_id_for_username(text) from public;
grant execute on function public.user_id_for_username(text) to authenticated;

create or replace function public.username_for_id(id uuid)
returns text
language sql
security definer
set search_path = public
stable
as $$
  select u.username
  from public.users u
  where u.id = username_for_id.id;
$$;

revoke all on function public.username_for_id(uuid) from public;
grant execute on function public.username_for_id(uuid) to authenticated;

create or replace function public.usernames_for_ids(ids uuid[])
returns table (id uuid, username text)
language sql
security definer
set search_path = public
stable
as $$
  select u.id, u.username
  from public.users u
  where u.id = any(usernames_for_ids.ids);
$$;

revoke all on function public.usernames_for_ids(uuid[]) from public;
grant execute on function public.usernames_for_ids(uuid[]) to authenticated;

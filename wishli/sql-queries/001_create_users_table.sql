-- ============================================================================
-- wishli — users table + auth plumbing
--
-- Run this once in the Supabase dashboard: SQL Editor -> New query -> Run.
-- Safe to re-run (everything is "if not exists" / "or replace").
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. The users table
--
-- Supabase keeps credentials in the `auth.users` table, which apps are not
-- allowed to read directly. `public.users` is our own profile row, one per
-- account, keyed by the same id. This is where the username lives.
-- ----------------------------------------------------------------------------
create table if not exists public.users (
  id         uuid        primary key references auth.users (id) on delete cascade,
  username   text        not null,
  email      text        not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint users_username_length check (char_length(username) between 3 and 30),
  constraint users_username_format check (username ~ '^[A-Za-z0-9_.]+$')
);

-- Usernames and emails are unique but case-insensitive: "Jayden" and "jayden"
-- are the same account.
create unique index if not exists users_username_lower_idx on public.users (lower(username));
create unique index if not exists users_email_lower_idx    on public.users (lower(email));

comment on table  public.users is 'Public profile for each auth.users account.';
comment on column public.users.username is 'Case-insensitive unique handle, also usable to log in.';


-- ----------------------------------------------------------------------------
-- 2. Keep updated_at honest
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
-- A signed-in user can read and edit their own row and nothing else. Rows are
-- never inserted from the client — the trigger in section 4 does it.
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
-- `options: { data: { username: '...' } }`, this trigger copies the username
-- and email into public.users. A duplicate username raises a unique violation,
-- which surfaces to the client as a failed sign up.
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
    -- Google sign-in has no username field, so fall back to the email handle.
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
-- 5. Log in with a username
--
-- Supabase's signInWithPassword() only accepts an email, so the login page
-- first trades the typed identifier for an email through this function.
-- It is security definer because anonymous visitors cannot select from
-- public.users (see the RLS policies above).
--
-- NOTE: this deliberately lets an anonymous caller learn the email address
-- behind a username. That is the cost of username login. Keep Supabase's
-- default auth rate limits on, and if that trade is not acceptable, drop this
-- function and make the login page email-only.
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
-- Create Wishlists Table
-- ----------------------------------------------------------------------------
create table wishlists (
  wishlist_id uuid primary key default gen_random_uuid(),
  id uuid not null references users(id) on delete cascade,
  name text not null,
  item_img text,
  budget decimal,
  created_at timestamptz not null default now()
);
-- ----------------------------------------------------------------------------


-- ----------------------------------------------------------------------------
-- Create Items Table
-- ----------------------------------------------------------------------------
create table items (
  item_id uuid primary key default gen_random_uuid(),
  wishlist_id uuid not null references wishlists(wishlist_id) on delete cascade,
  added_by_user_id uuid not null references users(id) on delete cascade,
  name text not null,
  product_url text,
  image_url text,
  price decimal,
  notes text,
  purchased boolean not null default false,
  added_at timestamptz not null default now()
);
-- ----------------------------------------------------------------------------


-- ----------------------------------------------------------------------------
-- Create Wishlist Members Table
-- ----------------------------------------------------------------------------
create table wishlist_members (
  member_id uuid primary key default gen_random_uuid(),
  wishlist_id uuid not null references wishlists(wishlist_id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  role text not null default 'viewer',
  joined_at timestamptz not null default now()
);
-- ----------------------------------------------------------------------------


-- ----------------------------------------------------------------------------
-- Create Friend Requests Table
-- ----------------------------------------------------------------------------
create table friend_requests (
  request_id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references users(id) on delete cascade,
  receiver_id uuid not null references users(id) on delete cascade,
  status text not null default 'pending',
  created_at timestamptz not null default now()
);
-- ----------------------------------------------------------------------------


-- ----------------------------------------------------------------------------
-- Create Notifications Table
-- ----------------------------------------------------------------------------
create table notifications (
  notification_id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  sender_id uuid references users(id) on delete set null,
  wishlist_id uuid references wishlists(wishlist_id) on delete cascade,
  type text not null,
  message text,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);
-- ----------------------------------------------------------------------------


-- ----------------------------------------------------------------------------
-- Create Verification Code Table
-- ----------------------------------------------------------------------------
create table verification_codes (
  code_id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  code text not null,
  expires_at timestamptz not null,
  used boolean not null default false,
  created_at timestamptz not null default now()
);
-- ----------------------------------------------------------------------------

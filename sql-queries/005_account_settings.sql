-- account settings support, run after 004

-- ----------------------------------------------------------------------------
-- keep public.users.email in step with auth.users.email
--
-- The settings page changes an email through supabase.auth.updateUser(), which
-- only writes auth.users, and only once the user clicks the confirmation link.
-- Nothing in the client is still running at that point, so the copy in
-- public.users has to be updated from the database side or it goes stale --
-- and email_for_login (001) reads that copy, so a stale row means logging in
-- with the new address silently fails.
--
-- Same shape as on_auth_user_created in 001: security definer, because the
-- trigger runs as whoever updated auth.users and public.users is behind rls.
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
-- one-time backfill
--
-- The trigger above only catches changes from this point on. Anyone who
-- changed their email before this migration ran is still stuck on the old
-- address in public.users -- this brings those rows in line too.
-- ----------------------------------------------------------------------------
update public.users u
set email = a.email
from auth.users a
where u.id = a.id
  and u.email is distinct from a.email;

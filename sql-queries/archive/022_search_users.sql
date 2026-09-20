-- username search for the friends page autocomplete. Run after 021.
--
-- Same shape as email_for_login/user_id_for_username: rls only exposes your
-- own row in public.users, so a security-definer function is what lets an
-- authenticated caller look up *other* people by (partial) username. Unlike
-- those two, this returns several rows instead of one -- so it also caps how
-- much it hands back to 8 rows, and still requires at least 1 character, so
-- an empty search can't be used to page through the whole users table.
create or replace function public.search_users(query text)
returns table (
  id uuid,
  username text,
  avatar_url text
)
language sql
security definer
set search_path = public
stable
as $$
  select u.id, u.username, u.avatar_url
  from public.users u
  where char_length(trim(search_users.query)) >= 1
    and u.id <> auth.uid()
    and u.username ilike '%' || trim(search_users.query) || '%'
  order by
    -- a name starting with what was typed reads as the more likely match
    (lower(u.username) like lower(trim(search_users.query)) || '%') desc,
    u.username asc
  limit 8;
$$;

revoke all on function public.search_users(text) from public;
grant execute on function public.search_users(text) to authenticated;

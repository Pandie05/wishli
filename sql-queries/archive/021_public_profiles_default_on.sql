-- flip public_profile's default and backfill everyone to public. Run after 020.
--
-- 016 made profiles opt-in (default false) since a profile is discoverable by
-- guessing a username, unlike a share link you hand someone directly. Product
-- direction has since changed: profiles are public by default, with Settings'
-- existing toggle (handlePublicProfile) as the opt-out. That toggle already
-- supports turning it back off, so nothing on the client needs to change for
-- someone who wants to go private -- this migration only changes what a new
-- row starts as, and brings existing rows in line with it.

alter table public.users alter column public_profile set default true;

update public.users set public_profile = true where not public_profile;

comment on column public.users.public_profile is 'Default true: /u/<username> lists this user''s link-shared wishlists to anyone unless they opt out in Settings.';

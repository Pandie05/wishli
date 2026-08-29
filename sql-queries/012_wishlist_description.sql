-- ============================================================================
-- wishli — a description on a wishlist. Run after 011.
--
-- Run this once in the Supabase dashboard: SQL Editor -> New query -> Run.
-- Safe to re-run.
-- ============================================================================

-- The blurb shown under the title on the wishlist page: what the list is for,
-- and anything the owner wants people to know before they reserve something.
-- Optional and purely descriptive; nothing keys off it. Free text rather than
-- a length-capped column so the UI decides how much to allow.
alter table public.wishlists
  add column if not exists description text;

comment on column public.wishlists.description is 'Optional blurb shown under the wishlist title.';

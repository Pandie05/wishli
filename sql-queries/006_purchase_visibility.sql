-- per-wishlist purchase visibility, run after 005

alter table public.wishlists
  add column if not exists purchase_visibility text not null default 'full'
  check (purchase_visibility in ('full', 'aggregate'));

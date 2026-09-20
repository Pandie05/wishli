-- ============================================================================
-- wishli — drop the unused verification_codes table.
--
-- Created in 001 but never referenced anywhere: no RLS policy was ever added
-- for it, and no code in src/ or the edge functions reads or writes it.
-- Email/password verification goes through Supabase's own built-in auth.users
-- flow instead. Safe to drop.
-- ============================================================================

--goodbye random ahh table nobody used :'(

drop table if exists public.verification_codes;

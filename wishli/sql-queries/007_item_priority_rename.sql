-- rename items."Priority" to items.priority, run after 006
--
-- the column was originally added with a capital P (probably via the table
-- editor), which meant every query had to double-quote it to avoid hitting a
-- different, nonexistent lowercase column. renaming it once here so the rest
-- of the app can just use `priority` like every other column.

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'items' and column_name = 'Priority'
  ) then
    alter table public.items rename column "Priority" to priority;
  end if;
end $$;

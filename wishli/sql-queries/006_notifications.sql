-- notifications, run after 005

alter table public.notifications enable row level security;

drop policy if exists "users can read their notifications" on public.notifications;
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

-- no insert policy: rls enabled + no policy means clients can never insert
-- one directly, for themselves or anyone else. every row below comes from a
-- trigger or an existing security definer function instead.


-- ----------------------------------------------------------------------------
-- a new friend request notifies the receiver
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

drop trigger if exists on_friend_request_created on public.friend_requests;
create trigger on_friend_request_created
  after insert on public.friend_requests
  for each row execute function public.notify_on_friend_request();


-- ----------------------------------------------------------------------------
-- getting added to a wishlist notifies the new member
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

drop trigger if exists on_wishlist_member_created on public.wishlist_members;
create trigger on_wishlist_member_created
  after insert on public.wishlist_members
  for each row execute function public.notify_on_wishlist_share();


-- ----------------------------------------------------------------------------
-- accepting a friend request notifies whoever sent it. same function as 004,
-- with the sender lookup + notification insert added.
-- ----------------------------------------------------------------------------
create or replace function public.respond_to_friend_request(request_id uuid, new_status text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sender_id uuid;
begin
  if new_status not in ('accepted', 'declined') then
    raise exception 'invalid status';
  end if;

  update public.friend_requests
  set status = respond_to_friend_request.new_status
  where friend_requests.request_id = respond_to_friend_request.request_id
    and friend_requests.receiver_id = auth.uid()
  returning friend_requests.sender_id into v_sender_id;

  if v_sender_id is null then
    raise exception 'not allowed';
  end if;

  if new_status = 'accepted' then
    insert into public.notifications (user_id, sender_id, type, message)
    values (
      v_sender_id,
      auth.uid(),
      'friend_accepted',
      public.username_for_id(auth.uid()) || ' accepted your friend request'
    );
  end if;
end;
$$;


-- ----------------------------------------------------------------------------
-- marking an item purchased notifies the wishlist owner, unless they're the
-- one who marked it, and only on the false -> true transition. wording
-- respects purchase_visibility the same way the ui already does. same
-- function as 004, with the lookup + notification insert added.
-- ----------------------------------------------------------------------------
create or replace function public.set_item_purchased(item_id uuid, purchased boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_wishlist_id uuid;
  v_owner_id uuid;
  v_wishlist_name text;
  v_visibility text;
  v_item_name text;
  v_was_purchased boolean;
begin
  select i.wishlist_id, i.name, i.purchased, w.id, w.name, w.purchase_visibility
    into v_wishlist_id, v_item_name, v_was_purchased, v_owner_id, v_wishlist_name, v_visibility
  from public.items i
  join public.wishlists w on w.wishlist_id = i.wishlist_id
  where i.item_id = set_item_purchased.item_id
    and (
      w.id = auth.uid()
      or exists (
        select 1 from public.wishlist_members m
        where m.wishlist_id = i.wishlist_id and m.user_id = auth.uid()
      )
    );

  if v_wishlist_id is null then
    raise exception 'not allowed';
  end if;

  update public.items
  set purchased = set_item_purchased.purchased
  where items.item_id = set_item_purchased.item_id;

  if set_item_purchased.purchased and not v_was_purchased and v_owner_id <> auth.uid() then
    insert into public.notifications (user_id, sender_id, wishlist_id, type, message)
    values (
      v_owner_id,
      auth.uid(),
      v_wishlist_id,
      'item_purchased',
      case v_visibility
        when 'full' then public.username_for_id(auth.uid()) || ' marked "' || v_item_name || '" as purchased'
        else 'An item was claimed on ' || v_wishlist_name
      end
    );
  end if;
end;
$$;

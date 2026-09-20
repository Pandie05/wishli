-- ============================================================================
-- wishli — let either person end a friendship. Run after 016.
--
-- The delete policy from 004 was `using (sender_id = auth.uid())`, which made
-- sense while the only thing it had to support was a sender cancelling a
-- request they had just sent. It aged badly: a friendship is stored as that
-- same accepted row, so whoever sent the original request was the only one
-- who could ever undo it. Accept someone and you were stuck with them, with
-- no way out from your side at all.
--
-- Widening it to either party covers three things with one rule: cancelling
-- your own outgoing request, removing a friend from either side, and a
-- receiver clearing a request outright instead of leaving a declined row
-- sitting there.
-- ============================================================================

drop policy if exists "senders can cancel their friend requests" on public.friend_requests;
drop policy if exists "either party can remove a friend request" on public.friend_requests;

create policy "either party can remove a friend request"
  on public.friend_requests for delete
  to authenticated
  using (sender_id = auth.uid() or receiver_id = auth.uid());

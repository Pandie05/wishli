import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { initialsFor } from '../components/AppShell'
import ConfirmModal from '../components/ConfirmModal'
import '../css/friends.css'

type Request = {
  request_id: string
  otherUsername: string
  otherId: string
  status: string
  isSender: boolean
}

export default function Friends() {
  const navigate = useNavigate()
  const [userId, setUserId] = useState<string | null>(null)
  const [incoming, setIncoming] = useState<Request[]>([])
  const [outgoing, setOutgoing] = useState<Request[]>([])
  const [friends, setFriends] = useState<Request[]>([])
  const [loading, setLoading] = useState(true)

  const [username, setUsername] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const [removing, setRemoving] = useState<Request | null>(null)
  const [removeBusy, setRemoveBusy] = useState(false)

  async function loadRequests(uid: string) {
    const { data: rows } = await supabase
      .from('friend_requests')
      .select('request_id, sender_id, receiver_id, status')

    // one lookup for everyone on the page rather than one per row (see
    // usernames_for_ids in 018)
    const otherIds = [
      ...new Set((rows ?? []).map((r) => (r.sender_id === uid ? r.receiver_id : r.sender_id))),
    ]

    const { data: nameRows } = otherIds.length
      ? await supabase.rpc('usernames_for_ids', { ids: otherIds })
      : { data: [] }

    const names = Object.fromEntries(
      ((nameRows ?? []) as { id: string; username: string | null }[]).map((row) => [
        row.id,
        row.username ?? '(unknown)',
      ]),
    ) as Record<string, string>

    const withUsernames = (rows ?? []).map((r) => {
      const otherId = r.sender_id === uid ? r.receiver_id : r.sender_id
      return {
        request_id: r.request_id,
        otherId,
        otherUsername: names[otherId] ?? '(unknown)',
        status: r.status,
        isSender: r.sender_id === uid,
      }
    })

    setIncoming(withUsernames.filter((r) => !r.isSender && r.status === 'pending'))
    setOutgoing(withUsernames.filter((r) => r.isSender && r.status === 'pending'))
    setFriends(withUsernames.filter((r) => r.status === 'accepted'))
  }

  useEffect(() => {
    let cancelled = false

    async function load() {
      const { data } = await supabase.auth.getSession()
      const user = data.session?.user

      if (!user) {
        if (!cancelled) navigate('/login', { replace: true })
        return
      }

      await loadRequests(user.id)

      if (!cancelled) {
        setUserId(user.id)
        setLoading(false)
      }
    }

    load()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigate])

  async function handleSend(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting || !userId) return

    const trimmed = username.trim()
    if (!trimmed) {
      setError('enter a username')
      return
    }

    setError(null)
    setSubmitting(true)

    const { data: targetId, error: lookupError } = await supabase.rpc('user_id_for_username', {
      username: trimmed,
    })

    if (lookupError || !targetId) {
      setError('no user with that username')
      setSubmitting(false)
      return
    }

    if (targetId === userId) {
      setError('that is you')
      setSubmitting(false)
      return
    }

    // both directions, not just the one about to be sent: if they already
    // asked you, sending back would make a second, separate friendship
    // between the same two people (see 019)
    const { data: existing } = await supabase
      .from('friend_requests')
      .select('request_id, status, sender_id')
      .or(
        `and(sender_id.eq.${userId},receiver_id.eq.${targetId}),` +
          `and(sender_id.eq.${targetId},receiver_id.eq.${userId})`,
      )
      .maybeSingle()

    if (existing?.status === 'pending') {
      setError(
        existing.sender_id === userId
          ? 'you already sent that person a request'
          : 'they have already asked you -- accept it above',
      )
      setSubmitting(false)
      return
    }
    if (existing?.status === 'accepted') {
      setError('you are already friends with that person')
      setSubmitting(false)
      return
    }
    if (existing?.status === 'declined') {
      // either party can clear a request now (see 017) -- reusing that here
      // rather than leaving the old row behind
      await supabase.from('friend_requests').delete().eq('request_id', existing.request_id)
    }

    const { error: insertError } = await supabase
      .from('friend_requests')
      .insert({ sender_id: userId, receiver_id: targetId })

    if (insertError) {
      setError(insertError.message)
      setSubmitting(false)
      return
    }

    setUsername('')
    await loadRequests(userId)
    setSubmitting(false)
  }

  async function respond(requestId: string, status: 'accepted' | 'declined') {
    if (!userId) return
    // goes through a function rather than a direct update — see
    // respond_to_friend_request in 004_friends_and_sharing.sql
    await supabase.rpc('respond_to_friend_request', { request_id: requestId, new_status: status })
    await loadRequests(userId)
  }

  async function cancel(requestId: string) {
    if (!userId) return
    await supabase.from('friend_requests').delete().eq('request_id', requestId)
    await loadRequests(userId)
  }

  // a friendship is the accepted row itself, so unfriending is the same
  // delete as cancelling -- it just needed 017 before either side could do it
  async function confirmRemove() {
    if (!removing || !userId || removeBusy) return

    setRemoveBusy(true)
    const { error: failure } = await supabase
      .from('friend_requests')
      .delete()
      .eq('request_id', removing.request_id)
    setRemoveBusy(false)

    if (failure) {
      setError(failure.message)
      setRemoving(null)
      return
    }

    setRemoving(null)
    await loadRequests(userId)
  }

  return (
    <div className="fr">
      <header className="fr-head">
        <div className="fr-headline">
          <p className="fr-eyebrow">
            {loading
              ? 'Loading'
              : `${friends.length} connected${incoming.length ? ` · ${incoming.length} waiting on you` : ''}`}
          </p>
          <h1 className="fr-title">Friends</h1>
        </div>

        <form className="fr-add" onSubmit={handleSend}>
          <label className="fr-add-field">
            <span className="fr-add-at">@</span>
            <input
              type="text"
              placeholder="username"
              aria-label="Username to add"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </label>
          <button type="submit" className="fr-add-go" disabled={submitting}>
            {submitting ? 'Sending...' : 'Send request'}
          </button>
        </form>
      </header>

      {error && <p className="fr-error">{error}</p>}

      <div className="fr-body">
        <section className="fr-section">
          <div className="fr-section-head">
            <span className="fr-section-num">01</span>
            <h2>Incoming</h2>
            <span className="fr-section-count">{incoming.length}</span>
          </div>

          <ul className="fr-list">
            {incoming.map((r) => (
              <li key={r.request_id} className="fr-row">
                <span className="fr-avatar">{initialsFor(r.otherUsername)}</span>
                <span className="fr-name">@{r.otherUsername}</span>
                <span className="fr-actions">
                  <button
                    type="button"
                    className="fr-accept"
                    onClick={() => respond(r.request_id, 'accepted')}
                  >
                    Accept
                  </button>
                  <button type="button" onClick={() => respond(r.request_id, 'declined')}>
                    Decline
                  </button>
                </span>
              </li>
            ))}
            {!loading && incoming.length === 0 && (
              <li className="fr-empty">Nobody has asked to connect yet.</li>
            )}
          </ul>
        </section>

        <section className="fr-section">
          <div className="fr-section-head">
            <span className="fr-section-num">02</span>
            <h2>Sent</h2>
            <span className="fr-section-count">{outgoing.length}</span>
          </div>

          <ul className="fr-list">
            {outgoing.map((r) => (
              <li key={r.request_id} className="fr-row">
                <span className="fr-avatar fr-avatar--pending">
                  {initialsFor(r.otherUsername)}
                </span>
                <span className="fr-name">
                  @{r.otherUsername}
                  <small>waiting</small>
                </span>
                <span className="fr-actions">
                  <button type="button" onClick={() => cancel(r.request_id)}>
                    Cancel
                  </button>
                </span>
              </li>
            ))}
            {!loading && outgoing.length === 0 && (
              <li className="fr-empty">No requests waiting on anyone else.</li>
            )}
          </ul>
        </section>

        <section className="fr-section">
          <div className="fr-section-head">
            <span className="fr-section-num">03</span>
            <h2>Your people</h2>
            <span className="fr-section-count">{friends.length}</span>
          </div>

          <ul className="fr-list">
            {friends.map((r) => (
              <li key={r.request_id} className="fr-row">
                <span className="fr-avatar">{initialsFor(r.otherUsername)}</span>
                <span className="fr-name">@{r.otherUsername}</span>
                <span className="fr-actions">
                  <button type="button" className="fr-remove" onClick={() => setRemoving(r)}>
                    Remove
                  </button>
                </span>
              </li>
            ))}
            {!loading && friends.length === 0 && (
              <li className="fr-empty">
                Add someone by their username and their wishlists become shareable with you.
              </li>
            )}
          </ul>
        </section>
      </div>

      <ConfirmModal
        open={!!removing}
        eyebrow="Remove friend"
        title={removing ? `Remove @${removing.otherUsername}?` : 'Remove friend?'}
        confirmLabel="Remove"
        busy={removeBusy}
        onConfirm={confirmRemove}
        onClose={() => setRemoving(null)}
      >
        <p className="modal-empty-lead">You can always send them a request again later.</p>
        <p className="modal-empty-note">
          Any wishlist you already shared with them stays shared — remove them from the
          list itself if you want to take that back too.
        </p>
      </ConfirmModal>
    </div>
  )
}

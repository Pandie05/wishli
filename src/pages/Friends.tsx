import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import '../css/friends-temp.css'

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

  async function loadRequests(uid: string) {
    const { data: rows } = await supabase
      .from('friend_requests')
      .select('request_id, sender_id, receiver_id, status')

    const withUsernames = await Promise.all(
      (rows ?? []).map(async (r) => {
        const otherId = r.sender_id === uid ? r.receiver_id : r.sender_id
        const { data: otherUsername } = await supabase.rpc('username_for_id', { id: otherId })
        return {
          request_id: r.request_id,
          otherId,
          otherUsername: otherUsername ?? '(unknown)',
          status: r.status,
          isSender: r.sender_id === uid,
        }
      }),
    )

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

  return (
    <div className="fr">
      <h1>Friends</h1>

      <form className="fr-form" onSubmit={handleSend}>
        <input
          type="text"
          placeholder="username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />
        <button type="submit" disabled={submitting}>
          {submitting ? 'Sending...' : 'Send request'}
        </button>
      </form>

      {error && <p className="fr-error">{error}</p>}

      <h2>Incoming requests</h2>
      <ul className="fr-list">
        {incoming.map((r) => (
          <li key={r.request_id} className="fr-list-item">
            <span>{r.otherUsername}</span>
            <button type="button" onClick={() => respond(r.request_id, 'accepted')}>
              Accept
            </button>
            <button type="button" onClick={() => respond(r.request_id, 'declined')}>
              Decline
            </button>
          </li>
        ))}
        {!loading && incoming.length === 0 && (
          <li className="fr-empty">no incoming requests</li>
        )}
      </ul>

      <h2>Outgoing requests</h2>
      <ul className="fr-list">
        {outgoing.map((r) => (
          <li key={r.request_id} className="fr-list-item">
            <span>{r.otherUsername}</span>
            <button type="button" onClick={() => cancel(r.request_id)}>
              Cancel
            </button>
          </li>
        ))}
        {!loading && outgoing.length === 0 && (
          <li className="fr-empty">no outgoing requests</li>
        )}
      </ul>

      <h2>Friends</h2>
      <ul className="fr-list">
        {friends.map((r) => (
          <li key={r.request_id} className="fr-list-item">
            <span>{r.otherUsername}</span>
          </li>
        ))}
        {!loading && friends.length === 0 && <li className="fr-empty">no friends yet</li>}
      </ul>
    </div>
  )
}

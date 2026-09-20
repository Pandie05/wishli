import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { timeAgo } from '../lib/dates'
import { describeError } from '../lib/errors'
import { supabase } from '../lib/supabase'
import { initialsFor, useShell } from '../components/AppShell'
import AddToWishlistModal from '../components/AddToWishlistModal'
import ConfirmModal from '../components/ConfirmModal'
import type { WishlistRow } from '../components/WishlistFormModal'
import '../css/friends.css'

/** One row of friend_overview (see 007) -- a request or a friendship. */
type FriendRow = {
  request_id: string
  other_id: string
  username: string
  avatar_url: string | null
  status: string
  direction: 'friend' | 'incoming' | 'outgoing'
  created_at: string
}

type UserMatch = {
  id: string
  username: string
  avatar_url: string | null
}

type Membership = { wishlist_id: string; user_id: string }

function ordinal(index: number): string {
  return String(index + 1).padStart(2, '0')
}

/** Avatar if they have one, their initials if not -- same as the nav. */
function Face({ row, pending }: { row: { username: string; avatar_url: string | null }; pending?: boolean }) {
  return (
    <span className={pending ? 'fr-avatar fr-avatar--pending' : 'fr-avatar'}>
      {row.avatar_url ? <img src={row.avatar_url} alt="" loading="lazy" /> : initialsFor(row.username)}
    </span>
  )
}

export default function Friends() {
  // the shell already resolved the session (and redirects to /login itself
  // if there is none) -- this page just waits for that instead of running
  // its own supabase.auth.getSession() check
  const shell = useShell()
  const userId = shell.userId

  const [rows, setRows] = useState<FriendRow[]>([])
  const [wishlists, setWishlists] = useState<WishlistRow[]>([])
  const [memberships, setMemberships] = useState<Membership[]>([])
  const [loading, setLoading] = useState(true)

  const [username, setUsername] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const [suggestions, setSuggestions] = useState<UserMatch[]>([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const searchRef = useRef<HTMLDivElement | null>(null)

  /** filters the main list only; the rail always shows everything pending */
  const [filter, setFilter] = useState('')

  // which friend's ⋯ menu is open, keyed by request_id
  const [openMenu, setOpenMenu] = useState<string | null>(null)
  const [sharing, setSharing] = useState<FriendRow | null>(null)
  const [removing, setRemoving] = useState<FriendRow | null>(null)
  const [removeBusy, setRemoveBusy] = useState(false)
  // request_ids currently mid-write, so a row can say so and not be clicked twice
  const [busyRows, setBusyRows] = useState<string[]>([])

  const load = useCallback(async () => {
    if (!userId) return

    // friend_overview answers the whole page -- rows, names and avatars -- in
    // one call (see 007). the other two are for the ⋯ menu's "add to a
    // wishlist" and the shared-with figure above it.
    const [{ data: overview, error: overviewError }, { data: listRows }, { data: memberRows }] =
      await Promise.all([
        supabase.rpc('friend_overview'),
        supabase
          .from('wishlists')
          .select('wishlist_id, id, name, budget, created_at, purchase_visibility, item_img, description, occasion, target_date, share_token')
          .order('created_at', { ascending: false }),
        supabase.from('wishlist_members').select('wishlist_id, user_id'),
      ])

    // a rejected query used to look exactly like an account with no friends
    if (overviewError) setError(describeError(overviewError))

    setRows((overview ?? []) as FriendRow[])
    setWishlists((listRows ?? []) as WishlistRow[])
    setMemberships(memberRows ?? [])
    setLoading(false)
  }, [userId])

  useEffect(() => {
    load()
  }, [load, shell.dataVersion])

  // debounced as-you-type search -- waits for a pause in typing rather than
  // firing search_users on every keystroke
  useEffect(() => {
    const trimmed = username.trim()
    if (trimmed.length < 1) {
      setSuggestions([])
      return
    }

    let cancelled = false
    const timer = setTimeout(async () => {
      const { data } = await supabase.rpc('search_users', { query: trimmed })
      if (!cancelled) setSuggestions((data ?? []) as UserMatch[])
    }, 250)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [username])

  // closes the suggestion list on a click anywhere outside the search field,
  // same pattern AppShell uses for its account menu
  useEffect(() => {
    if (!showSuggestions) return

    function onDown(event: MouseEvent) {
      if (!searchRef.current?.contains(event.target as Node)) setShowSuggestions(false)
    }

    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [showSuggestions])

  // and the same for whichever friend's ⋯ menu is open
  useEffect(() => {
    if (!openMenu) return

    function onDown(event: MouseEvent) {
      const target = event.target as HTMLElement
      if (!target.closest('.fr-menu-wrap')) setOpenMenu(null)
    }

    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [openMenu])

  const friends = useMemo(() => rows.filter((r) => r.direction === 'friend'), [rows])
  const incoming = useMemo(
    () => rows.filter((r) => r.direction === 'incoming' && r.status === 'pending'),
    [rows],
  )
  const outgoing = useMemo(
    () => rows.filter((r) => r.direction === 'outgoing' && r.status === 'pending'),
    [rows],
  )

  const owned = useMemo(() => wishlists.filter((w) => w.id === userId), [wishlists, userId])
  const ownedIds = useMemo(() => new Set(owned.map((w) => w.wishlist_id)), [owned])

  /** people on a list you own -- the same friendship counted once, not per list */
  const sharedWith = useMemo(
    () =>
      new Set(
        memberships
          .filter((m) => ownedIds.has(m.wishlist_id) && m.user_id !== userId)
          .map((m) => m.user_id),
      ).size,
    [memberships, ownedIds, userId],
  )

  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase()
    if (!needle) return friends
    return friends.filter((r) => r.username.toLowerCase().includes(needle))
  }, [friends, filter])

  async function withRow<T>(requestId: string, work: () => PromiseLike<T>): Promise<T> {
    setBusyRows((ids) => [...ids, requestId])
    try {
      return await work()
    } finally {
      setBusyRows((ids) => ids.filter((id) => id !== requestId))
    }
  }

  function pickSuggestion(match: UserMatch) {
    setUsername(match.username)
    setShowSuggestions(false)
  }

  async function handleSend(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting || !userId) return
    setShowSuggestions(false)

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
          : 'they have already asked you -- answer it in the rail',
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
      setError(describeError(insertError))
      setSubmitting(false)
      return
    }

    setUsername('')
    await load()
    setSubmitting(false)
  }

  async function respond(row: FriendRow, status: 'accepted' | 'declined') {
    if (!userId) return
    // goes through a function rather than a direct update — see
    // respond_to_friend_request in 004_friends_and_sharing.sql
    const { error: failure } = await withRow(row.request_id, () =>
      supabase.rpc('respond_to_friend_request', {
        request_id: row.request_id,
        new_status: status,
      }),
    )

    if (failure) {
      setError(describeError(failure))
      return
    }

    // an answered request stops being news: drop the notification it arrived
    // as, so it clears from the notifications page and the dashboard's
    // activity panel instead of lingering with no buttons left to press
    await supabase
      .from('notifications')
      .delete()
      .eq('type', 'friend_request')
      .eq('sender_id', row.other_id)

    // accepting writes the sender a notification, so the nav's badge is stale
    // too -- and bumping dataVersion is what reloads this page as well
    shell.refresh()
  }

  async function cancel(row: FriendRow) {
    if (!userId) return
    const { error: failure } = await withRow(row.request_id, () =>
      supabase.from('friend_requests').delete().eq('request_id', row.request_id),
    )
    if (failure) setError(describeError(failure))
    await load()
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
      setError(describeError(failure))
      setRemoving(null)
      return
    }

    setRemoving(null)
    await load()
  }

  // the page renders before the first load lands, so a figure must show a
  // rule rather than flash a zero on its way to the real number
  const stat = (value: ReactNode) => (loading ? <i className="fr-stat-idle">—</i> : value)

  function sharedCount(otherId: string): number {
    return memberships.filter((m) => m.user_id === otherId && ownedIds.has(m.wishlist_id)).length
  }

  return (
    <div className="fr">
      <header className="fr-head">
        <div className="fr-headline">
          <p className="fr-eyebrow">
            {loading
              ? 'Loading'
              : incoming.length
                ? `${incoming.length} waiting on you`
                : 'Everyone answered'}
          </p>
          <h1 className="fr-title">Friends</h1>
        </div>

        <form className="fr-add" onSubmit={handleSend}>
          <div className="fr-add-search" ref={searchRef}>
            <label className="fr-add-field">
              <span className="fr-add-at">@</span>
              <input
                type="text"
                placeholder="username"
                aria-label="Username to add"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                onFocus={() => setShowSuggestions(true)}
                autoComplete="off"
              />
            </label>

            {showSuggestions && suggestions.length > 0 && (
              <ul className="fr-suggest">
                {suggestions.map((match) => (
                  <li key={match.id}>
                    <button type="button" onClick={() => pickSuggestion(match)}>
                      <span className="fr-suggest-avatar">
                        {match.avatar_url ? (
                          <img src={match.avatar_url} alt="" />
                        ) : (
                          initialsFor(match.username)
                        )}
                      </span>
                      @{match.username}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <button type="submit" className="fr-add-go" disabled={submitting}>
            {submitting ? 'Sending...' : 'Send request'}
          </button>
        </form>
      </header>

      <section className="fr-stats">
        <div className="fr-stat">
          <span className="fr-stat-label">
            <b>{ordinal(0)}</b> / Friends
          </span>
          <span className="fr-stat-value">{stat(String(friends.length).padStart(2, '0'))}</span>
        </div>

        <div className="fr-stat">
          <span className="fr-stat-label">
            <b>{ordinal(1)}</b> / Waiting on you
          </span>
          <span className="fr-stat-value">{stat(String(incoming.length).padStart(2, '0'))}</span>
        </div>

        <div className="fr-stat">
          <span className="fr-stat-label">
            <b>{ordinal(2)}</b> / Sent
          </span>
          <span className="fr-stat-value">{stat(String(outgoing.length).padStart(2, '0'))}</span>
        </div>

        <div className="fr-stat">
          <span className="fr-stat-label">
            <b>{ordinal(3)}</b> / On your lists
          </span>
          <span className="fr-stat-value">
            {stat(
              <>
                {sharedWith}
                <small>/{friends.length}</small>
              </>,
            )}
          </span>
        </div>
      </section>

      {error && <p className="fr-error">{error}</p>}

      <div className="fr-cols">
        <div className="fr-main">
          <div className="fr-main-head">
            <h2>Your people</h2>

            <label className="fr-filter">
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                <circle cx="7" cy="7" r="4.5" />
                <path d="M10.5 10.5 14 14" strokeLinecap="round" />
              </svg>
              <input
                type="text"
                placeholder="Filter friends"
                aria-label="Filter friends by username"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              />
            </label>
          </div>

          <ul className="fr-grid">
            {visible.map((r) => {
              const shared = sharedCount(r.other_id)

              return (
                <li key={r.request_id} className="fr-card">
                  <Face row={r} />

                  <div className="fr-card-text">
                    <Link className="fr-card-name" to={`/u/${r.username}`}>
                      @{r.username}
                    </Link>
                    <p className="fr-card-meta">
                      {shared > 0 ? `On ${shared} of your lists` : 'Not on any of your lists'}
                      {' · '}
                      {timeAgo(r.created_at)}
                    </p>
                  </div>

                  <div className="fr-menu-wrap">
                    <button
                      type="button"
                      className="fr-menu"
                      aria-label={`Options for ${r.username}`}
                      aria-expanded={openMenu === r.request_id}
                      onClick={() =>
                        setOpenMenu((id) => (id === r.request_id ? null : r.request_id))
                      }
                    >
                      ⋯
                    </button>

                    {openMenu === r.request_id && (
                      <div className="fr-pop">
                        <button
                          type="button"
                          onClick={() => {
                            setSharing(r)
                            setOpenMenu(null)
                          }}
                        >
                          Add to a wishlist
                        </button>
                        <Link to={`/u/${r.username}`} onClick={() => setOpenMenu(null)}>
                          View profile
                        </Link>
                        <button
                          type="button"
                          className="fr-pop-danger"
                          onClick={() => {
                            setRemoving(r)
                            setOpenMenu(null)
                          }}
                        >
                          Remove friend
                        </button>
                      </div>
                    )}
                  </div>
                </li>
              )
            })}

            {!loading && visible.length === 0 && (
              <li className="fr-empty">
                {filter.trim()
                  ? `nobody matches "${filter.trim()}"`
                  : 'Add someone by their username and their wishlists become shareable with you.'}
              </li>
            )}
          </ul>
        </div>

        <aside className="fr-rail">
          <section className="fr-rail-section">
            <h2 className="fr-rail-title">
              Incoming
              {incoming.length > 0 && <span className="fr-rail-count">{incoming.length}</span>}
            </h2>

            <ul className="fr-rail-list">
              {incoming.map((r) => {
                const busy = busyRows.includes(r.request_id)

                return (
                  <li key={r.request_id} className="fr-rail-row">
                    <Face row={r} />

                    <div className="fr-rail-text">
                      <span className="fr-rail-name">@{r.username}</span>
                      <span className="fr-rail-when">{timeAgo(r.created_at)}</span>
                    </div>

                    <div className="fr-rail-actions">
                      <button
                        type="button"
                        className="fr-accept"
                        disabled={busy}
                        onClick={() => respond(r, 'accepted')}
                      >
                        Accept
                      </button>
                      <button type="button" disabled={busy} onClick={() => respond(r, 'declined')}>
                        Decline
                      </button>
                    </div>
                  </li>
                )
              })}

              {!loading && incoming.length === 0 && (
                <li className="fr-rail-empty">nobody has asked to connect</li>
              )}
            </ul>
          </section>

          <section className="fr-rail-section">
            <h2 className="fr-rail-title">
              Sent
              {outgoing.length > 0 && <span className="fr-rail-count">{outgoing.length}</span>}
            </h2>

            <ul className="fr-rail-list">
              {outgoing.map((r) => {
                const busy = busyRows.includes(r.request_id)

                return (
                  <li key={r.request_id} className="fr-rail-row">
                    <Face row={r} pending />

                    <div className="fr-rail-text">
                      <span className="fr-rail-name">@{r.username}</span>
                      <span className="fr-rail-when">sent {timeAgo(r.created_at)}</span>
                    </div>

                    <div className="fr-rail-actions">
                      <button type="button" disabled={busy} onClick={() => cancel(r)}>
                        Cancel
                      </button>
                    </div>
                  </li>
                )
              })}

              {!loading && outgoing.length === 0 && (
                <li className="fr-rail-empty">no requests waiting on anyone else</li>
              )}
            </ul>
          </section>
        </aside>
      </div>

      <AddToWishlistModal
        open={!!sharing}
        friend={sharing}
        wishlists={owned}
        memberships={memberships}
        onClose={() => setSharing(null)}
        onChanged={shell.refresh}
      />

      <ConfirmModal
        open={!!removing}
        eyebrow="Remove friend"
        title={removing ? `Remove @${removing.username}?` : 'Remove friend?'}
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

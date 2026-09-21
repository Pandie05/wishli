import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { timeAgo } from '../lib/dates'
import { describeError } from '../lib/errors'
import { supabase } from '../lib/supabase'
import { initialsFor, useShell } from '../components/AppShell'
import '../css/notifications.css'

/** Enough to fill a screen; the rest is a click away rather than a download. */
const PAGE_SIZE = 25

/** One row of notification_feed (see 007). */
type Notification = {
  notification_id: string
  type: string
  message: string | null
  wishlist_id: string | null
  wishlist_name: string | null
  sender_id: string | null
  sender_username: string | null
  sender_avatar: string | null
  /** set only while a friend request from this sender is still unanswered */
  friend_request_id: string | null
  is_read: boolean
  created_at: string
}

type Tab = 'all' | 'unread' | 'requests'

const TABS: { key: Tab; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'unread', label: 'Unread' },
  { key: 'requests', label: 'Requests' },
]

/** Who a notification is from, for the avatar and the name beside it. */
function actorName(n: Notification): string {
  return n.sender_username ?? 'wishli'
}

export default function Notifications() {
  const navigate = useNavigate()
  // the rail's unread badge outlives a navigation now, so it has to be told
  // when this page reads or dismisses something
  const shell = useShell()
  const userId = shell.userId

  const [notifications, setNotifications] = useState<Notification[]>([])
  // counted on the server rather than derived from the rows above -- with
  // paging, what is loaded is not the whole story
  const [unread, setUnread] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('all')
  // notification_ids mid-write, so a row can be disabled rather than
  // double-answered
  const [busyRows, setBusyRows] = useState<string[]>([])

  const load = useCallback(async () => {
    if (!userId) return

    const [{ data: rows, error: feedError }, { count }] = await Promise.all([
      // one call rather than rows-then-usernames: the feed carries the
      // sender's name and avatar, the list it points at, and -- for a friend
      // request still waiting -- the request id, so Accept works from here
      supabase.rpc('notification_feed', { limit_count: PAGE_SIZE, offset_count: 0 }),
      supabase
        .from('notifications')
        .select('notification_id', { count: 'exact', head: true })
        .eq('is_read', false),
    ])

    setError(describeError(feedError))
    setNotifications((rows ?? []) as Notification[])
    setUnread(count ?? 0)
    setHasMore((rows?.length ?? 0) === PAGE_SIZE)
    setLoading(false)
  }, [userId])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    if (!userId) return

    const channel = supabase
      .channel(`notifications-${userId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` },
        () => {
          load()
        },
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [userId, load])

  async function loadMore() {
    if (loadingMore) return
    setLoadingMore(true)

    const { data: rows, error: failure } = await supabase.rpc('notification_feed', {
      limit_count: PAGE_SIZE,
      offset_count: notifications.length,
    })

    setLoadingMore(false)
    if (failure) {
      setError(describeError(failure))
      return
    }

    setNotifications((prev) => [...prev, ...((rows ?? []) as Notification[])])
    setHasMore((rows?.length ?? 0) === PAGE_SIZE)
  }

  async function withRow<T>(id: string, work: () => PromiseLike<T>): Promise<T> {
    setBusyRows((ids) => [...ids, id])
    try {
      return await work()
    } finally {
      setBusyRows((ids) => ids.filter((x) => x !== id))
    }
  }

  /** Flip one row's read state, both on the server and in the badge. */
  async function setRead(n: Notification, read: boolean) {
    if (n.is_read === read) return

    const { error: failure } = await supabase
      .from('notifications')
      .update({ is_read: read })
      .eq('notification_id', n.notification_id)

    if (failure) {
      setError(describeError(failure))
      return
    }

    setNotifications((prev) =>
      prev.map((x) => (x.notification_id === n.notification_id ? { ...x, is_read: read } : x)),
    )
    setUnread((count) => Math.max(0, count + (read ? -1 : 1)))
    shell.refresh()
  }

  /** Clicking the message reads it, and opens whatever it is about. */
  async function open(n: Notification) {
    await setRead(n, true)

    if (n.wishlist_id) {
      navigate(`/wishlist/${n.wishlist_id}`)
      return
    }
    // a friend notification has no list to open; the friends page is what it
    // is actually about, and its rail is where an unanswered request lives
    if (n.type === 'friend_request' || n.type === 'friend_accepted') navigate('/friends')
  }

  // rls already scopes this to your own rows, so no user filter is needed --
  // and it clears everything, including anything not loaded onto the page yet
  async function markAllRead() {
    if (clearing) return
    setClearing(true)
    const { error: failure } = await supabase
      .from('notifications')
      .update({ is_read: true })
      .eq('is_read', false)
    setClearing(false)

    if (failure) {
      setError(describeError(failure))
      return
    }

    setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })))
    setUnread(0)
    shell.refresh()
  }

  async function remove(n: Notification) {
    const { error: failure } = await withRow(n.notification_id, () =>
      supabase.from('notifications').delete().eq('notification_id', n.notification_id),
    )

    if (failure) {
      setError(describeError(failure))
      return
    }

    setNotifications((prev) => prev.filter((x) => x.notification_id !== n.notification_id))
    if (!n.is_read) setUnread((count) => Math.max(0, count - 1))
    shell.refresh()
  }

  /** Answer a friend request without leaving the page. */
  async function respond(n: Notification, status: 'accepted' | 'declined') {
    if (!n.friend_request_id) return

    // goes through a function rather than a direct update -- see
    // respond_to_friend_request in 004_friends_and_sharing.sql
    const { error: failure } = await withRow(n.notification_id, () =>
      supabase.rpc('respond_to_friend_request', {
        request_id: n.friend_request_id,
        new_status: status,
      }),
    )

    if (failure) {
      setError(describeError(failure))
      return
    }

    // an answered request is not news anymore: the row goes rather than
    // sitting there read-but-buttonless. every friend_request notification
    // from this sender goes, not just the one clicked, so a re-sent request
    // does not leave a stale twin behind -- and the dashboard's activity
    // panel reads the same table, so it clears there too.
    const { error: clearError } = await supabase
      .from('notifications')
      .delete()
      .eq('type', 'friend_request')
      .eq('sender_id', n.sender_id)

    if (clearError) {
      setError(describeError(clearError))
      return
    }

    const cleared = notifications.filter(
      (x) => x.type === 'friend_request' && x.sender_id === n.sender_id,
    )
    setNotifications((prev) =>
      prev.filter((x) => !(x.type === 'friend_request' && x.sender_id === n.sender_id)),
    )
    setUnread((count) => Math.max(0, count - cleared.filter((x) => !x.is_read).length))
    shell.refresh()
  }

  const counts = useMemo(
    () => ({
      all: notifications.length,
      unread: notifications.filter((n) => !n.is_read).length,
      requests: notifications.filter((n) => n.friend_request_id).length,
    }),
    [notifications],
  )

  const visible = useMemo(() => {
    if (tab === 'unread') return notifications.filter((n) => !n.is_read)
    if (tab === 'requests') return notifications.filter((n) => n.friend_request_id)
    return notifications
  }, [notifications, tab])

  return (
    <div className="notif">
      <header className="notif-head">
        <div className="notif-headline">
          <p className="notif-eyebrow">
            {loading ? 'Loading' : unread > 0 ? `${unread} unread` : 'All caught up'}
          </p>
          <h1 className="notif-title">Notifications</h1>
        </div>

        <div className="notif-head-actions">
          <button
            type="button"
            className="notif-clear"
            onClick={markAllRead}
            disabled={clearing || unread === 0}
          >
            {clearing ? 'Marking...' : 'Mark all read'}
          </button>
        </div>
      </header>

      {error && <p className="notif-error">{error}</p>}

      <div className="notif-body">
        <div className="notif-toolbar">
          <h2>
            {tab === 'unread' ? 'Unread' : tab === 'requests' ? 'Friend requests' : 'Everything'}
          </h2>

          <div className="notif-tabs">
            <span className="notif-tabs-label">Show</span>
            {TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                className={tab === t.key ? 'notif-tab notif-tab--on' : 'notif-tab'}
                onClick={() => setTab(t.key)}
              >
                {t.label}
                {counts[t.key] > 0 && <small>{counts[t.key]}</small>}
              </button>
            ))}
          </div>
        </div>

        <ul className="notif-list">
          {visible.map((n) => {
            const busy = busyRows.includes(n.notification_id)

            return (
              <li
                key={n.notification_id}
                className={n.is_read ? 'notif-item' : 'notif-item notif-item--unread'}
              >
                <span className="notif-avatar" aria-hidden="true">
                  {n.sender_avatar ? (
                    <img src={n.sender_avatar} alt="" loading="lazy" />
                  ) : (
                    initialsFor(actorName(n))
                  )}
                </span>

                <div className="notif-text">
                  <button type="button" className="notif-message" onClick={() => open(n)}>
                    {n.message ?? 'You have a new notification'}
                  </button>

                  <p className="notif-sub">
                    <span className="notif-who">@{actorName(n)}</span>
                    <time dateTime={n.created_at}>{timeAgo(n.created_at)}</time>
                    {n.wishlist_name && <span className="notif-list-name">{n.wishlist_name}</span>}
                  </p>

                  {n.friend_request_id && (
                    <div className="notif-respond">
                      <button
                        type="button"
                        className="notif-accept"
                        disabled={busy}
                        onClick={() => respond(n, 'accepted')}
                      >
                        Accept
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => respond(n, 'declined')}
                      >
                        Decline
                      </button>
                    </div>
                  )}
                </div>

                <span className="notif-actions">
                  <button
                    type="button"
                    className="notif-toggle"
                    onClick={() => setRead(n, !n.is_read)}
                    title={n.is_read ? 'Mark as unread' : 'Mark as read'}
                    aria-label={n.is_read ? 'Mark as unread' : 'Mark as read'}
                  >
                    {n.is_read ? 'Unread' : 'Read'}
                  </button>

                  <button
                    type="button"
                    className="notif-dismiss"
                    onClick={() => remove(n)}
                    disabled={busy}
                    aria-label="Dismiss this notification"
                    title="Dismiss"
                  >
                    &times;
                  </button>
                </span>
              </li>
            )
          })}

          {!loading && visible.length === 0 && (
            <li className="notif-empty">
              {tab === 'unread'
                ? 'Nothing unread.'
                : tab === 'requests'
                  ? 'No friend requests waiting on you.'
                  : 'Nothing yet. Friend requests, claimed wishes and upcoming dates all land here.'}
            </li>
          )}
        </ul>

        {hasMore && tab === 'all' && (
          <div className="notif-more">
            <button type="button" onClick={loadMore} disabled={loadingMore}>
              {loadingMore ? 'Loading...' : 'Show older'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

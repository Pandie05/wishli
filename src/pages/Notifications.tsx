import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { timeAgo } from '../lib/dates'
import { supabase } from '../lib/supabase'
import { useShell } from '../components/AppShell'
import '../css/notifications.css'

/** Enough to fill a screen; the rest is a click away rather than a download. */
const PAGE_SIZE = 25

type Notification = {
  notification_id: string
  message: string | null
  wishlist_id: string | null
  is_read: boolean
  created_at: string
}

const COLUMNS = 'notification_id, message, wishlist_id, is_read, created_at'

export default function Notifications() {
  const navigate = useNavigate()
  // the rail's unread badge outlives a navigation now, so it has to be told
  // when this page reads or dismisses something
  const shell = useShell()
  const [notifications, setNotifications] = useState<Notification[]>([])
  // counted on the server rather than derived from the rows above -- with
  // paging, what is loaded is not the whole story
  const [unread, setUnread] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [clearing, setClearing] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function load() {
      const { data } = await supabase.auth.getSession()
      const user = data.session?.user

      if (!user) {
        if (!cancelled) navigate('/login', { replace: true })
        return
      }

      const [{ data: rows }, { count }] = await Promise.all([
        supabase
          .from('notifications')
          .select(COLUMNS)
          .order('created_at', { ascending: false })
          .range(0, PAGE_SIZE - 1),
        supabase
          .from('notifications')
          .select('notification_id', { count: 'exact', head: true })
          .eq('is_read', false),
      ])

      if (cancelled) return
      setNotifications(rows ?? [])
      setUnread(count ?? 0)
      setHasMore((rows?.length ?? 0) === PAGE_SIZE)
      setLoading(false)
    }

    load()
    return () => {
      cancelled = true
    }
  }, [navigate])

  async function loadMore() {
    if (loadingMore) return
    setLoadingMore(true)

    const { data: rows } = await supabase
      .from('notifications')
      .select(COLUMNS)
      .order('created_at', { ascending: false })
      .range(notifications.length, notifications.length + PAGE_SIZE - 1)

    setLoadingMore(false)
    setNotifications((prev) => [...prev, ...(rows ?? [])])
    setHasMore((rows?.length ?? 0) === PAGE_SIZE)
  }

  async function markRead(n: Notification) {
    if (!n.is_read) {
      await supabase
        .from('notifications')
        .update({ is_read: true })
        .eq('notification_id', n.notification_id)
      setNotifications((prev) =>
        prev.map((x) => (x.notification_id === n.notification_id ? { ...x, is_read: true } : x)),
      )
      setUnread((n2) => Math.max(0, n2 - 1))
      shell.refresh()
    }
    if (n.wishlist_id) navigate(`/wishlist/${n.wishlist_id}`)
  }

  // rls already scopes this to your own rows, so no user filter is needed --
  // and it clears everything, including anything not loaded onto the page yet
  async function markAllRead() {
    if (clearing) return
    setClearing(true)
    await supabase.from('notifications').update({ is_read: true }).eq('is_read', false)
    setClearing(false)
    setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })))
    setUnread(0)
    shell.refresh()
  }

  async function remove(n: Notification) {
    await supabase.from('notifications').delete().eq('notification_id', n.notification_id)
    setNotifications((prev) => prev.filter((x) => x.notification_id !== n.notification_id))
    if (!n.is_read) setUnread((count) => Math.max(0, count - 1))
    shell.refresh()
  }

  return (
    <div className="notif">
      <header className="notif-head">
        <div className="notif-headline">
          <p className="notif-eyebrow">
            {loading ? 'Loading' : unread > 0 ? `${unread} unread` : 'All caught up'}
          </p>
          <h1 className="notif-title">Notifications</h1>
        </div>

        {unread > 0 && (
          <button type="button" className="notif-clear" onClick={markAllRead} disabled={clearing}>
            {clearing ? 'Marking...' : 'Mark all read'}
          </button>
        )}
      </header>

      <ul className="notif-list">
        {notifications.map((n) => (
          <li
            key={n.notification_id}
            className={n.is_read ? 'notif-item' : 'notif-item notif-item--unread'}
          >
            <span className="notif-dot" aria-hidden="true" />

            <button type="button" className="notif-message" onClick={() => markRead(n)}>
              {n.message}
              {n.wishlist_id && <span className="notif-go">Open list</span>}
            </button>

            <time className="notif-when" dateTime={n.created_at}>
              {timeAgo(n.created_at)}
            </time>

            <button
              type="button"
              className="notif-dismiss"
              onClick={() => remove(n)}
              aria-label="Dismiss this notification"
              title="Dismiss"
            >
              &times;
            </button>
          </li>
        ))}

        {!loading && notifications.length === 0 && (
          <li className="notif-empty">
            Nothing yet. Friend requests, claimed wishes and upcoming dates all land here.
          </li>
        )}
      </ul>

      {hasMore && (
        <div className="notif-more">
          <button type="button" onClick={loadMore} disabled={loadingMore}>
            {loadingMore ? 'Loading...' : 'Show older'}
          </button>
        </div>
      )}
    </div>
  )
}

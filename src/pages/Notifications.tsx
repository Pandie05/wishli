import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { timeAgo } from '../lib/dates'
import { supabase } from '../lib/supabase'
import { useShell } from '../components/AppShell'
import '../css/notifications.css'

type Notification = {
  notification_id: string
  message: string | null
  wishlist_id: string | null
  is_read: boolean
  created_at: string
}

export default function Notifications() {
  const navigate = useNavigate()
  // the rail's unread badge outlives a navigation now, so it has to be told
  // when this page reads or dismisses something
  const shell = useShell()
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [loading, setLoading] = useState(true)
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

      const { data: rows } = await supabase
        .from('notifications')
        .select('notification_id, message, wishlist_id, is_read, created_at')
        .order('created_at', { ascending: false })

      if (!cancelled) {
        setNotifications(rows ?? [])
        setLoading(false)
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [navigate])

  async function markRead(n: Notification) {
    if (!n.is_read) {
      await supabase
        .from('notifications')
        .update({ is_read: true })
        .eq('notification_id', n.notification_id)
      setNotifications((prev) =>
        prev.map((x) => (x.notification_id === n.notification_id ? { ...x, is_read: true } : x)),
      )
      shell.refresh()
    }
    if (n.wishlist_id) navigate(`/wishlist/${n.wishlist_id}`)
  }

  // rls already scopes this to your own rows, so no user filter is needed
  async function markAllRead() {
    if (clearing) return
    setClearing(true)
    await supabase.from('notifications').update({ is_read: true }).eq('is_read', false)
    setClearing(false)
    setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })))
    shell.refresh()
  }

  async function remove(id: string) {
    await supabase.from('notifications').delete().eq('notification_id', id)
    setNotifications((prev) => prev.filter((n) => n.notification_id !== id))
    shell.refresh()
  }

  const unread = notifications.filter((n) => !n.is_read).length

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
              onClick={() => remove(n.notification_id)}
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
    </div>
  )
}

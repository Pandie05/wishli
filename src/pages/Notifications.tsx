import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useShell } from '../components/AppShell'
import '../css/notifications-temp.css'

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

  async function remove(id: string) {
    await supabase.from('notifications').delete().eq('notification_id', id)
    setNotifications((prev) => prev.filter((n) => n.notification_id !== id))
    shell.refresh()
  }

  return (
    <div className="notif">
      <h1>Notifications</h1>

      <ul className="notif-list">
        {notifications.map((n) => (
          <li
            key={n.notification_id}
            className={n.is_read ? 'notif-item' : 'notif-item notif-item--unread'}
          >
            <button type="button" className="notif-item-message" onClick={() => markRead(n)}>
              {n.message}
            </button>
            <button type="button" onClick={() => remove(n.notification_id)}>
              Dismiss
            </button>
          </li>
        ))}
        {!loading && notifications.length === 0 && (
          <li className="notif-empty">no notifications yet</li>
        )}
      </ul>
    </div>
  )
}

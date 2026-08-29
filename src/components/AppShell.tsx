import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import AddWishModal from './AddWishModal'
import PageTransition from './PageTransition'
import WishlistFormModal from './WishlistFormModal'
import type { WishlistRow } from './WishlistFormModal'
import '../css/app-shell.css'

type NavKey = 'dashboard' | 'friends' | 'notifications' | 'settings' | null

type ShellApi = {
  userId: string | null
  /** the wishlists this account can add to -- owned plus shared-in */
  wishlists: WishlistRow[]
  /** bumped whenever anything is created or changed; pages reload on it */
  dataVersion: number
  refresh: () => void
  openAddWish: (options?: { url?: string; wishlistId?: string }) => void
  openAddWishlist: () => void
}

const ShellContext = createContext<ShellApi | null>(null)

/**
 * Lets a page drive the shell's global modals, so the dashboard's "+ add wish"
 * button opens the very same modal the nav item does, and tell the shell when
 * it has changed something the nav also renders.
 */
export function useShell(): ShellApi {
  const api = useContext(ShellContext)
  if (!api) throw new Error('useShell must be used inside <AppShell>')
  return api
}

function Icon({ path }: { path: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
      <path d={path} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

const ICONS = {
  dashboard: 'M2.5 2.5h4.5v4.5H2.5zM9 2.5h4.5v4.5H9zM2.5 9h4.5v4.5H2.5zM9 9h4.5v4.5H9z',
  wish: 'M8 3.5v9M3.5 8h9',
  list: 'M2.5 3h11M2.5 8h11M2.5 13h7',
  friends:
    'M6 7.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM1.5 13c0-2 2-3.2 4.5-3.2S10.5 11 10.5 13M11 4.2a2 2 0 0 1 0 3.6M12.2 9.9c1.4.4 2.3 1.3 2.3 2.6',
  bell: 'M8 2.2a3.6 3.6 0 0 0-3.6 3.6c0 3-1.1 3.9-1.1 3.9h9.4s-1.1-.9-1.1-3.9A3.6 3.6 0 0 0 8 2.2zM6.7 12.2a1.4 1.4 0 0 0 2.6 0',
  gear: 'M8 10.1a2.1 2.1 0 1 0 0-4.2 2.1 2.1 0 0 0 0 4.2zM8 1.6l.9 1.7 1.9-.3.5 1.8 1.7.9-.9 1.7.9 1.7-1.7.9-.5 1.8-1.9-.3L8 14.4l-.9-1.7-1.9.3-.5-1.8-1.7-.9.9-1.7-.9-1.7 1.7-.9.5-1.8 1.9.3z',
}

export function initialsFor(name: string): string {
  const clean = name.trim()
  if (!clean) return '?'
  const parts = clean.split(/[\s._-]+/).filter(Boolean)
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
  return clean.slice(0, 2).toUpperCase()
}

function navKeyFor(pathname: string): NavKey {
  // a wishlist is reached from the dashboard and reads as part of it
  if (pathname.startsWith('/dashboard') || pathname.startsWith('/wishlist')) return 'dashboard'
  if (pathname.startsWith('/friends')) return 'friends'
  if (pathname.startsWith('/notifications')) return 'notifications'
  if (pathname.startsWith('/settings')) return 'settings'
  return null
}

/**
 * The chrome every signed-in page renders inside. It is mounted once, by the
 * layout route in App.tsx, rather than by each page -- that is what lets the
 * rail survive a navigation, so the active pill can slide to its new row
 * instead of the whole nav being torn down and rebuilt.
 */
export default function AppShell() {
  const navigate = useNavigate()
  const location = useLocation()
  const active = navKeyFor(location.pathname)

  const [userId, setUserId] = useState<string | null>(null)
  const [username, setUsername] = useState('')
  const [unread, setUnread] = useState(0)
  const [wishlists, setWishlists] = useState<WishlistRow[]>([])
  const [dataVersion, setDataVersion] = useState(0)

  const [menuOpen, setMenuOpen] = useState(false)
  const [showAddWish, setShowAddWish] = useState(false)
  const [presetUrl, setPresetUrl] = useState('')
  const [presetWishlistId, setPresetWishlistId] = useState('')
  const [showAddWishlist, setShowAddWishlist] = useState(false)
  // set when add-wish sent you off to make a list first, so you land back on
  // the wish you were adding once the list exists
  const [resumeAddWish, setResumeAddWish] = useState(false)
  const userRef = useRef<HTMLDivElement | null>(null)

  // the sliding active pill: one absolutely-positioned element behind the
  // links, moved to whichever row is current
  const linksRef = useRef<HTMLDivElement | null>(null)
  const [pill, setPill] = useState<{ top: number; height: number } | null>(null)
  const [pillReady, setPillReady] = useState(false)

  const refresh = useCallback(() => setDataVersion((n) => n + 1), [])

  useEffect(() => {
    let cancelled = false

    async function load() {
      const { data } = await supabase.auth.getSession()
      const user = data.session?.user
      if (!user) return

      const [{ data: profile }, { data: rows }, { count }] = await Promise.all([
        supabase.from('users').select('username').eq('id', user.id).single(),
        // rls already scopes this to lists you own or are a member of
        supabase
          .from('wishlists')
          .select('wishlist_id, id, name, budget, created_at, purchase_visibility, item_img, description, occasion, target_date')
          .order('created_at', { ascending: false }),
        supabase
          .from('notifications')
          .select('notification_id', { count: 'exact', head: true })
          .eq('is_read', false),
      ])

      if (cancelled) return
      setUserId(user.id)
      setUsername(profile?.username ?? '')
      setWishlists(rows ?? [])
      setUnread(count ?? 0)
    }

    load()
    return () => {
      cancelled = true
    }
  }, [dataVersion])

  // measure before paint so the pill is never seen in the wrong place. on a
  // route with no nav row of its own (a wishlist) there is nothing to measure,
  // so the last position is kept and the pill is faded out where it stands
  // rather than snapping to the top.
  useLayoutEffect(() => {
    const el = linksRef.current?.querySelector<HTMLElement>('[data-nav-active="true"]')
    if (!el) return

    setPill({ top: el.offsetTop, height: el.offsetHeight })
    // the slide is only enabled once the pill has been placed, so a cold load
    // does not animate it in from the top of the rail
    const frame = requestAnimationFrame(() => setPillReady(true))
    return () => cancelAnimationFrame(frame)
  }, [active])

  // click-outside for the log out menu hanging off the avatar
  useEffect(() => {
    if (!menuOpen) return

    function onDown(event: MouseEvent) {
      if (!userRef.current?.contains(event.target as Node)) setMenuOpen(false)
    }

    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [menuOpen])

  function startWishlistFirst() {
    setShowAddWish(false)
    setResumeAddWish(true)
    setShowAddWishlist(true)
  }

  function closeAddWishlist() {
    setShowAddWishlist(false)
    setResumeAddWish(false)
  }

  function handleWishlistSaved(row: WishlistRow) {
    // folded in here rather than waiting on the refetch, so add-wish reopens
    // with the new list already selected instead of flashing its empty state
    setWishlists((prev) =>
      prev.some((w) => w.wishlist_id === row.wishlist_id)
        ? prev.map((w) => (w.wishlist_id === row.wishlist_id ? row : w))
        : [row, ...prev],
    )
    refresh()

    if (resumeAddWish) {
      setResumeAddWish(false)
      setShowAddWish(true)
    }
  }

  async function handleLogout() {
    await supabase.auth.signOut()
    navigate('/login', { replace: true })
  }

  const api: ShellApi = {
    userId,
    wishlists,
    dataVersion,
    refresh,
    openAddWish: (options) => {
      setPresetUrl(options?.url ?? '')
      setPresetWishlistId(options?.wishlistId ?? '')
      setShowAddWish(true)
    },
    openAddWishlist: () => setShowAddWishlist(true),
  }

  function linkProps(key: NavKey) {
    const on = key === active
    return {
      className: on ? 'shell-link shell-link--active' : 'shell-link',
      'data-nav-active': on ? 'true' : undefined,
    }
  }

  return (
    <ShellContext.Provider value={api}>
      <div className="shell">
        <nav className="shell-nav">
          <Link to="/dashboard" className="shell-mark">
            wishli<span className="shell-mark-dot" />
          </Link>

          <div className="shell-links" ref={linksRef}>
            <span
              className="shell-pill"
              data-ready={pillReady ? 'true' : undefined}
              data-off={active && pill ? undefined : 'true'}
              style={pill ? { transform: `translateY(${pill.top}px)`, height: pill.height } : undefined}
              aria-hidden="true"
            />

            <Link to="/dashboard" {...linkProps('dashboard')}>
              <Icon path={ICONS.dashboard} />
              Dashboard
            </Link>

            <button type="button" className="shell-link" onClick={() => api.openAddWish()}>
              <Icon path={ICONS.wish} />
              Add wish
            </button>

            <button type="button" className="shell-link" onClick={api.openAddWishlist}>
              <Icon path={ICONS.list} />
              Add wishlist
            </button>

            <Link to="/friends" {...linkProps('friends')}>
              <Icon path={ICONS.friends} />
              Friends
            </Link>

            <Link to="/notifications" {...linkProps('notifications')}>
              <Icon path={ICONS.bell} />
              Notifications
              {unread > 0 && <span className="shell-link-badge">{unread}</span>}
            </Link>

            <Link to="/settings" {...linkProps('settings')}>
              <Icon path={ICONS.gear} />
              Settings
            </Link>
          </div>

          <div className="shell-user" ref={userRef}>
            {menuOpen && (
              <div className="shell-user-menu">
                <button type="button" onClick={handleLogout}>
                  Log out
                </button>
              </div>
            )}
            <button
              type="button"
              className="shell-user-button"
              onClick={() => setMenuOpen((open) => !open)}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
            >
              <span className="shell-avatar">{initialsFor(username)}</span>
              <span className="shell-user-text">
                <span className="shell-user-name">{username || 'Account'}</span>
                <span className="shell-user-handle">@{username || '...'}</span>
              </span>
            </button>
          </div>
        </nav>

        <main className="shell-main">
          <PageTransition />
        </main>
      </div>

      <WishlistFormModal
        open={showAddWishlist}
        userId={userId}
        onClose={closeAddWishlist}
        onSaved={handleWishlistSaved}
      />

      <AddWishModal
        open={showAddWish}
        userId={userId}
        wishlists={wishlists}
        presetUrl={presetUrl}
        presetWishlistId={presetWishlistId}
        onClose={() => setShowAddWish(false)}
        onNeedWishlist={startWishlistFirst}
        onSaved={refresh}
      />
    </ShellContext.Provider>
  )
}

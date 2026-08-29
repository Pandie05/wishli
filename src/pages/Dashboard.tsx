import { useCallback, useEffect, useMemo, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { describeError } from '../lib/errors'
import { supabase } from '../lib/supabase'
import { initialsFor, useShell } from '../components/AppShell'
import ConfirmModal from '../components/ConfirmModal'
import Spinner from '../components/Spinner'
import WishlistFormModal from '../components/WishlistFormModal'
import type { WishlistRow } from '../components/WishlistFormModal'
import '../css/dashboard.css'

type ItemRow = {
  item_id: string
  wishlist_id: string
  price: number | null
  image_url: string | null
  claimed_by: string | null
  added_at: string
}

type ActivityRow = {
  notification_id: string
  sender_id: string | null
  wishlist_id: string | null
  message: string | null
  is_read: boolean
  created_at: string
}

type SortMode = 'recent' | 'az' | 'value'

/** "$1,349" / "$12.50" — whole numbers stay whole, the mockup shows no .00 */
function money(value: number): string {
  return `$${value.toLocaleString('en-US', {
    minimumFractionDigits: value % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })}`
}

function ordinal(index: number): string {
  return String(index + 1).padStart(2, '0')
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime()
  const minutes = Math.max(0, Math.round((Date.now() - then) / 60000))
  if (minutes < 60) return `${minutes}m`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.round(hours / 24)
  if (days === 1) return 'Yesterday'
  if (days < 7) return `${days}d`
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

/**
 * The mockup picks the thing an activity line is *about* out in blue. Item
 * names arrive quoted from the notification triggers (see 007/009) and
 * wishlist names arrive bare, so both are matched and wrapped.
 */
function highlight(message: string, listNames: string[]): ReactNode[] {
  const names = listNames
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)
    .map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))

  const pattern = new RegExp(`"[^"]+"${names.length ? `|${names.join('|')}` : ''}`, 'g')

  const out: ReactNode[] = []
  let last = 0
  let match: RegExpExecArray | null

  while ((match = pattern.exec(message)) !== null) {
    if (match.index > last) out.push(message.slice(last, match.index))
    out.push(
      <span key={match.index} className="dash-activity-entity">
        {match[0].replace(/"/g, '')}
      </span>,
    )
    last = match.index + match[0].length
  }

  if (last < message.length) out.push(message.slice(last))
  return out
}

/** A stable blue-family gradient per wishlist, for lists with no cover art. */
function coverGradient(id: string): CSSProperties {
  let hash = 0
  for (let i = 0; i < id.length; i += 1) hash = (hash * 31 + id.charCodeAt(i)) >>> 0
  const hue = 198 + (hash % 31) // 198–228deg: the mockup's art is all blue
  return {
    '--cover-a': `hsl(${hue} 30% 27%)`,
    '--cover-b': `hsl(${(hue + 14) % 360} 34% 63%)`,
  } as CSSProperties
}

function greeting(date: Date): string {
  const hour = date.getHours()
  if (hour < 12) return 'Good morning'
  if (hour < 18) return 'Good afternoon'
  return 'Good evening'
}

export default function Dashboard() {
  const navigate = useNavigate()
  // the shell owns the add-wish/add-wishlist modals and a dataVersion counter;
  // reloading on that counter is what keeps this page in step with a create
  // made from the nav rather than from here
  const shell = useShell()

  const [userId, setUserId] = useState<string | null>(null)
  const [username, setUsername] = useState('')
  const [wishlists, setWishlists] = useState<WishlistRow[]>([])
  const [items, setItems] = useState<ItemRow[]>([])
  const [memberships, setMemberships] = useState<{ wishlist_id: string; user_id: string }[]>([])
  const [activity, setActivity] = useState<ActivityRow[]>([])
  const [senderNames, setSenderNames] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<SortMode>('recent')
  const [includeShared, setIncludeShared] = useState(false)

  const [editing, setEditing] = useState<WishlistRow | null>(null)
  // the wishlist the delete confirmation is asking about
  const [pendingDelete, setPendingDelete] = useState<WishlistRow | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [openMenu, setOpenMenu] = useState<string | null>(null)

  const [quickUrl, setQuickUrl] = useState('')
  const [quickBusy, setQuickBusy] = useState(false)
  const [quickNote, setQuickNote] = useState<{ text: string; ok: boolean } | null>(null)

  const load = useCallback(async () => {
    const { data } = await supabase.auth.getSession()
    const user = data.session?.user

    if (!user) {
      navigate('/login', { replace: true })
      return
    }

    const [
      { data: profile },
      { data: listRows, error: listError },
      { data: itemRows, error: itemError },
      { data: memberRows },
      { data: notifRows },
    ] = await Promise.all([
        supabase.from('users').select('username').eq('id', user.id).single(),
        // rls returns lists you own plus lists you have been added to
        supabase
          .from('wishlists')
          .select('wishlist_id, id, name, budget, created_at, purchase_visibility, item_img, description, occasion, target_date')
          .order('created_at', { ascending: false }),
        supabase
          .from('items')
          .select('item_id, wishlist_id, price, image_url, claimed_by, added_at')
          .order('added_at', { ascending: false }),
        supabase.from('wishlist_members').select('wishlist_id, user_id'),
        supabase
          .from('notifications')
          .select('notification_id, sender_id, wishlist_id, message, is_read, created_at')
          .order('created_at', { ascending: false })
          .limit(6),
      ])

    // a rejected query used to look exactly like an empty account
    setError(describeError(listError ?? itemError))

    setUserId(user.id)
    setUsername(profile?.username ?? '')
    setWishlists((listRows ?? []) as WishlistRow[])
    setItems((itemRows ?? []) as ItemRow[])
    setMemberships(memberRows ?? [])
    setActivity((notifRows ?? []) as ActivityRow[])
    setLoading(false)

    // notifications only carry the sender's id; the username behind it comes
    // from the same security-definer function the friends page uses
    const ids = [...new Set((notifRows ?? []).map((n) => n.sender_id).filter(Boolean))] as string[]
    const names = await Promise.all(
      ids.map(async (id) => {
        const { data: name } = await supabase.rpc('username_for_id', { id })
        return [id, (name as string) ?? 'Someone'] as const
      }),
    )
    setSenderNames(Object.fromEntries(names))
  }, [navigate])

  useEffect(() => {
    load()
  }, [load, shell.dataVersion])

  // returning from a wishlist should show the grid straight away -- the shell
  // survived the navigation and still has the rows, so borrow them until this
  // page's own fetch lands
  useEffect(() => {
    if (!loading || shell.wishlists.length === 0) return
    setWishlists((prev) => (prev.length ? prev : shell.wishlists))
  }, [shell.wishlists, loading])

  const owned = useMemo(() => wishlists.filter((w) => w.id === userId), [wishlists, userId])

  const { counts, totals, covers, reserved, ownedItemCount } = useMemo(() => {
    const counts: Record<string, number> = {}
    const totals: Record<string, number> = {}
    const covers: Record<string, string> = {}
    const ownedIds = new Set(owned.map((w) => w.wishlist_id))
    let reserved = 0
    let ownedItemCount = 0

    // items arrive newest-first, so the last write per list is its oldest
    // item -- take only the first one seen to get the newest image
    for (const item of items) {
      counts[item.wishlist_id] = (counts[item.wishlist_id] ?? 0) + 1
      totals[item.wishlist_id] = (totals[item.wishlist_id] ?? 0) + (item.price ?? 0)
      if (item.image_url && !covers[item.wishlist_id]) covers[item.wishlist_id] = item.image_url

      if (ownedIds.has(item.wishlist_id)) {
        ownedItemCount += 1
        if (item.claimed_by && item.claimed_by !== userId) reserved += 1
      }
    }

    return { counts, totals, covers, reserved, ownedItemCount }
  }, [items, owned, userId])

  const memberCounts = useMemo(() => {
    const byList: Record<string, number> = {}
    for (const m of memberships) byList[m.wishlist_id] = (byList[m.wishlist_id] ?? 0) + 1
    return byList
  }, [memberships])

  const collaborators = useMemo(() => {
    const ownedIds = new Set(owned.map((w) => w.wishlist_id))
    const people = new Set(
      memberships.filter((m) => ownedIds.has(m.wishlist_id) && m.user_id !== userId).map((m) => m.user_id),
    )
    return people.size
  }, [memberships, owned, userId])

  const totalValue = useMemo(
    () => owned.reduce((sum, w) => sum + (totals[w.wishlist_id] ?? 0), 0),
    [owned, totals],
  )

  const visible = useMemo(() => {
    const base = includeShared ? wishlists : owned
    const needle = query.trim().toLowerCase()
    const filtered = needle ? base.filter((w) => w.name.toLowerCase().includes(needle)) : base

    const sorted = [...filtered]
    if (sort === 'az') sorted.sort((a, b) => a.name.localeCompare(b.name))
    else if (sort === 'value')
      sorted.sort((a, b) => (totals[b.wishlist_id] ?? 0) - (totals[a.wishlist_id] ?? 0))
    return sorted
  }, [wishlists, owned, includeShared, query, sort, totals])

  async function deleteWishlist() {
    if (!pendingDelete || deleting) return

    setDeleting(true)
    const { error: deleteError } = await supabase
      .from('wishlists')
      .delete()
      .eq('wishlist_id', pendingDelete.wishlist_id)
    setDeleting(false)

    if (deleteError) {
      setError(deleteError.message)
      return
    }

    setPendingDelete(null)
    setOpenMenu(null)
    shell.refresh()
  }

  /** Quick add: resolve the link, then drop it straight into the default list. */
  async function quickSave() {
    const url = quickUrl.trim()
    if (!url || quickBusy || !userId) return

    const target = owned[0]
    if (!target) {
      setQuickNote({ text: 'make a wishlist first', ok: false })
      return
    }

    setQuickBusy(true)
    setQuickNote(null)

    const { data: preview } = await supabase.functions.invoke('fetch-link-preview', {
      body: { url },
    })

    const { error: insertError } = await supabase.from('items').insert({
      wishlist_id: target.wishlist_id,
      user_id: userId,
      name: preview?.title ?? url,
      product_url: url,
      image_url: preview?.image ?? null,
      price: preview?.price != null ? Number(preview.price) : null,
    })

    setQuickBusy(false)

    if (insertError) {
      setQuickNote({ text: insertError.message, ok: false })
      return
    }

    setQuickUrl('')
    setQuickNote({ text: `Saved to ${target.name}`, ok: true })
    shell.refresh()
  }

  // the page renders immediately now, so a figure must not flash a zero on
  // its way to the real number -- it shows a rule until the first load lands
  const stat = (value: ReactNode) => (loading ? <i className="dash-stat-idle">—</i> : value)

  const now = new Date()
  const stamp = now
    .toLocaleDateString(undefined, { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' })
    .replace(/,/g, '')

  return (
    <div className="dash">
      <header className="dash-head">
        <div>
          <p className="dash-eyebrow">
            {stamp} · {greeting(now)}, {username}
          </p>
          <h1 className="dash-title">Dashboard</h1>
        </div>

        <div className="dash-head-actions">
          <label className="dash-search">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
              <circle cx="7" cy="7" r="4.5" />
              <path d="M10.5 10.5 14 14" strokeLinecap="round" />
            </svg>
            <input
              type="text"
              placeholder="Search"
              aria-label="Search wishlists"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>

          <button type="button" className="dash-add" onClick={() => shell.openAddWish()}>
            + Add wish
          </button>
        </div>
      </header>

      <section className="dash-stats">
        <div className="dash-stat">
          <span className="dash-stat-label">
            <b>{ordinal(0)}</b> / Wishlists
          </span>
          <span className="dash-stat-value">{stat(String(owned.length).padStart(2, '0'))}</span>
        </div>

        <div className="dash-stat">
          <span className="dash-stat-label">
            <b>{ordinal(1)}</b> / Total value
          </span>
          <span className="dash-stat-value">{stat(money(totalValue))}</span>
        </div>

        <div className="dash-stat">
          <span className="dash-stat-label">
            <b>{ordinal(2)}</b> / Reserved by friends
          </span>
          <span className="dash-stat-value">
            {stat(
              <>
                {reserved}
                <small>/{ownedItemCount}</small>
              </>,
            )}
          </span>
        </div>

        <div className="dash-stat">
          <span className="dash-stat-label">
            <b>{ordinal(3)}</b> / Collaborators
          </span>
          <span className="dash-stat-value">{stat(collaborators)}</span>
        </div>
      </section>

      {error && <p className="dash-error">{error}</p>}

      <div className="dash-cols">
        <div className="dash-lists">
          <div className="dash-lists-head">
            <h2>{includeShared ? 'All wishlists' : 'Your wishlists'}</h2>

            <div className="dash-filters">
              <span className="dash-filters-label">Sort</span>
              <button
                type="button"
                className={sort === 'az' ? 'dash-filter dash-filter--on' : 'dash-filter'}
                onClick={() => setSort((s) => (s === 'az' ? 'recent' : 'az'))}
              >
                A–Z
              </button>
              <button
                type="button"
                className={sort === 'value' ? 'dash-filter dash-filter--on' : 'dash-filter'}
                onClick={() => setSort((s) => (s === 'value' ? 'recent' : 'value'))}
              >
                Value
              </button>
              <button
                type="button"
                className={includeShared ? 'dash-filter dash-filter--on' : 'dash-filter'}
                onClick={() => setIncludeShared((on) => !on)}
                title="Include wishlists shared with you"
              >
                View all
              </button>
            </div>
          </div>

          <ul className="dash-grid">
            {visible.map((w, index) => {
              const cover = w.item_img ?? covers[w.wishlist_id] ?? null
              const spent = totals[w.wishlist_id] ?? 0
              const friends = memberCounts[w.wishlist_id] ?? 0
              const overBudget = w.budget != null && spent > w.budget

              return (
                <li key={w.wishlist_id} className="dash-card">
                  <div className="dash-card-media" style={coverGradient(w.wishlist_id)}>
                    {cover && <img src={cover} alt="" loading="lazy" />}
                    <span className="dash-card-num">{ordinal(index)}</span>
                  </div>

                  {/* deliberately a child of the card, not of the media: the
                      media dims on hover, and an opacity below 1 makes a
                      stacking context that would trap this button underneath
                      the card-wide link overlay */}
                  {w.id === userId && (
                    <button
                      type="button"
                      className="dash-card-menu"
                      aria-label={`Options for ${w.name}`}
                      aria-expanded={openMenu === w.wishlist_id}
                      onClick={() =>
                        setOpenMenu((id) => (id === w.wishlist_id ? null : w.wishlist_id))
                      }
                    >
                      ⋯
                    </button>
                  )}

                  {openMenu === w.wishlist_id && (
                    <div className="dash-card-pop">
                      <button
                        type="button"
                        onClick={() => {
                          setEditing(w)
                          setOpenMenu(null)
                        }}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setPendingDelete(w)
                          setOpenMenu(null)
                        }}
                      >
                        Delete
                      </button>
                    </div>
                  )}

                  <div className="dash-card-title">
                    <Link to={`/wishlist/${w.wishlist_id}`}>{w.name}</Link>
                    <span
                      className={overBudget ? 'dash-card-price dash-card-price--over' : 'dash-card-price'}
                    >
                      {money(spent)}
                      {w.budget != null && <small> / {money(w.budget)}</small>}
                    </span>
                  </div>

                  <div className="dash-card-meta">
                    <span className="dash-faces">
                      {Array.from({ length: 1 + Math.min(friends, 2) }).map((_, i) => (
                        <span key={i} className={`dash-face dash-face--n${i + 1}`} />
                      ))}
                    </span>
                    <span>
                      {friends === 0 ? 'Just you' : `${friends} friend${friends === 1 ? '' : 's'}`}
                      {w.id !== userId && ' · shared with you'}
                    </span>
                    <span className="dash-card-meta-right">{counts[w.wishlist_id] ?? 0} items</span>
                  </div>
                </li>
              )
            })}

            {!loading && visible.length === 0 && (
              <li className="dash-empty">
                {query.trim()
                  ? `nothing matches "${query.trim()}"`
                  : includeShared
                    ? 'no wishlists yet'
                    : 'no wishlists yet — add one from the left'}
              </li>
            )}
          </ul>
        </div>

        <aside className="dash-rail">
          <section className="dash-rail-section">
            <h2 className="dash-rail-title">Activity</h2>

            <ul className="dash-activity">
              {activity.map((n) => (
                <li key={n.notification_id} className="dash-activity-row">
                  <span className="dash-activity-avatar">
                    {initialsFor(n.sender_id ? senderNames[n.sender_id] ?? '' : 'wishli')}
                  </span>
                  <button
                    type="button"
                    className={
                      n.is_read
                        ? 'dash-activity-text'
                        : 'dash-activity-text dash-activity-text--unread'
                    }
                    onClick={() =>
                      navigate(n.wishlist_id ? `/wishlist/${n.wishlist_id}` : '/notifications')
                    }
                  >
                    {highlight(n.message ?? '', wishlists.map((w) => w.name))}
                    <span className="dash-activity-time">{relativeTime(n.created_at)}</span>
                  </button>
                </li>
              ))}

              {!loading && activity.length === 0 && (
                <li className="dash-rail-empty">nothing yet</li>
              )}
            </ul>
          </section>

          <section className="dash-rail-section">
            <h2 className="dash-rail-title">Quick add</h2>

            <div className="dash-quick">
              <div className="dash-quick-input">
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
                  <path
                    d="M6.6 9.4a2.6 2.6 0 0 0 3.8 0l2-2a2.7 2.7 0 0 0-3.8-3.8l-.6.6M9.4 6.6a2.6 2.6 0 0 0-3.8 0l-2 2a2.7 2.7 0 0 0 3.8 3.8l.6-.6"
                    strokeLinecap="round"
                  />
                </svg>
                <input
                  type="url"
                  placeholder="Paste a product link"
                  aria-label="Paste a product link"
                  value={quickUrl}
                  onChange={(e) => setQuickUrl(e.target.value)}
                />
              </div>

              <div className="dash-quick-row">
                <button
                  type="button"
                  className="dash-quick-save"
                  onClick={quickSave}
                  disabled={quickBusy || !quickUrl.trim()}
                >
                  {quickBusy ? (
                    <span className="spinner-btn">
                      <Spinner label="Reading the link" />
                      <span>Saving</span>
                    </span>
                  ) : (
                    'Save to list'
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => shell.openAddWish({ url: quickUrl.trim() })}
                  disabled={!quickUrl.trim()}
                >
                  Choose list
                </button>
              </div>

              {quickNote && (
                <p className={quickNote.ok ? 'dash-quick-note' : 'dash-quick-note dash-quick-note--error'}>
                  {quickNote.text}
                </p>
              )}
              {!quickNote && owned[0] && (
                <p className="dash-quick-note">Saves to {owned[0].name} unless you choose a list.</p>
              )}
            </div>
          </section>
        </aside>
      </div>

      <ConfirmModal
        open={!!pendingDelete}
        eyebrow="Delete wishlist"
        title={pendingDelete ? `Delete ${pendingDelete.name}?` : 'Delete wishlist?'}
        confirmLabel="Delete wishlist"
        busy={deleting}
        onConfirm={deleteWishlist}
        onClose={() => setPendingDelete(null)}
      >
        <p className="modal-empty-lead">This cannot be undone.</p>
        <p className="modal-empty-note">
          {(() => {
            const count = pendingDelete ? (counts[pendingDelete.wishlist_id] ?? 0) : 0
            return count === 0
              ? 'The wishlist is empty, so nothing else goes with it.'
              : `Its ${count} ${count === 1 ? 'wish goes' : 'wishes go'} with it, along with anything friends have reserved or pledged towards them.`
          })()}
        </p>
      </ConfirmModal>

      <WishlistFormModal
        open={!!editing}
        userId={userId}
        wishlist={editing}
        onClose={() => setEditing(null)}
        onSaved={shell.refresh}
      />
    </div>
  )
}

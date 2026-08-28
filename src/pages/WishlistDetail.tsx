import { useCallback, useEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { describeError } from '../lib/errors'
import { supabase } from '../lib/supabase'
import { WISH_COLUMNS } from '../lib/types'
import type { Contribution, Friend, WishItem, WishlistMember } from '../lib/types'
import AddWishModal from '../components/AddWishModal'
import { useShell } from '../components/AppShell'
import ConfirmModal from '../components/ConfirmModal'
import ManagePeopleModal from '../components/ManagePeopleModal'
import WishDetailModal from '../components/WishDetailModal'
import WishlistFormModal from '../components/WishlistFormModal'
import type { WishlistRow } from '../components/WishlistFormModal'
import '../css/wishlist-detail.css'

type Tab = 'all' | 'available' | 'reserved' | 'bought'
type SortMode = 'priority' | 'price' | 'added'

function money(value: number): string {
  return `$${value.toLocaleString('en-US', {
    minimumFractionDigits: value % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })}`
}

/** Same stable blue-family fallback the dashboard cards use. */
function coverGradient(id: string): CSSProperties {
  let hash = 0
  for (let i = 0; i < id.length; i += 1) hash = (hash * 31 + id.charCodeAt(i)) >>> 0
  const hue = 198 + (hash % 31)
  return {
    '--cover-a': `hsl(${hue} 30% 27%)`,
    '--cover-b': `hsl(${(hue + 14) % 360} 34% 63%)`,
  } as CSSProperties
}

function sortWishes(items: WishItem[], mode: SortMode): WishItem[] {
  const sorted = [...items]
  switch (mode) {
    case 'priority':
      return sorted.sort(
        (a, b) =>
          (b.priority ?? 0) - (a.priority ?? 0) ||
          new Date(b.added_at).getTime() - new Date(a.added_at).getTime(),
      )
    case 'price':
      return sorted.sort((a, b) => (b.price ?? -Infinity) - (a.price ?? -Infinity))
    case 'added':
      return sorted.sort(
        (a, b) => new Date(b.added_at).getTime() - new Date(a.added_at).getTime(),
      )
  }
}

export default function WishlistDetail() {
  const { wishlistId = '' } = useParams()
  const navigate = useNavigate()
  const shell = useShell()

  const [userId, setUserId] = useState<string | null>(null)
  const [wishlist, setWishlist] = useState<WishlistRow | null>(null)
  const [items, setItems] = useState<WishItem[]>([])
  const [members, setMembers] = useState<WishlistMember[]>([])
  const [friends, setFriends] = useState<Friend[]>([])
  const [contributions, setContributions] = useState<Contribution[]>([])
  const [names, setNames] = useState<Record<string, string>>({})
  const [myRole, setMyRole] = useState<'viewer' | 'editor' | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [tab, setTab] = useState<Tab>('all')
  const [sort, setSort] = useState<SortMode>('priority')

  const [viewing, setViewing] = useState<WishItem | null>(null)
  const [editingWish, setEditingWish] = useState<WishItem | null>(null)
  const [deletingWish, setDeletingWish] = useState<WishItem | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [editingList, setEditingList] = useState(false)
  const [showPeople, setShowPeople] = useState(false)

  const load = useCallback(async () => {
    const { data: auth } = await supabase.auth.getSession()
    const user = auth.session?.user
    if (!user) {
      navigate('/login', { replace: true })
      return
    }

    setUserId(user.id)

    // one wave, not four: the friend list used to wait on everything above it
    const [
      { data: list, error: listError },
      { data: itemRows, error: itemError },
      { data: memberRows },
      { data: contribRows },
      { data: requests },
    ] = await Promise.all([
      supabase
        .from('wishlists')
        .select(
          'wishlist_id, id, name, budget, created_at, purchase_visibility, item_img, description, occasion, target_date',
        )
        .eq('wishlist_id', wishlistId)
        .single(),
      supabase.from('items').select(WISH_COLUMNS).eq('wishlist_id', wishlistId),
      supabase
        .from('wishlist_members')
        .select('member_id, user_id, role')
        .eq('wishlist_id', wishlistId),
      supabase.from('item_contributions').select('contribution_id, item_id, user_id, amount'),
      supabase
        .from('friend_requests')
        .select('sender_id, receiver_id, status')
        .eq('status', 'accepted'),
    ])

    setError(describeError(listError ?? itemError))
    if (list) setWishlist(list as WishlistRow)
    setItems((itemRows ?? []) as WishItem[])
    setMembers(
      (memberRows ?? []).map((m) => ({
        member_id: m.member_id,
        user_id: m.user_id,
        username: '',
        role: (m.role as 'viewer' | 'editor') ?? 'viewer',
      })),
    )
    setContributions(
      (contribRows ?? []).map((c) => ({
        contribution_id: c.contribution_id,
        item_id: c.item_id,
        user_id: c.user_id,
        amount: Number(c.amount),
        username: '',
      })),
    )
    setMyRole(
      ((memberRows ?? []).find((m) => m.user_id === user.id)?.role as 'viewer' | 'editor') ?? null,
    )

    // the page is usable from here -- everything below is names, which only
    // the people modal and the reserved-by line need, so it must not block
    setLoading(false)

    const memberIds = new Set((memberRows ?? []).map((m) => m.user_id))
    const friendIds = [
      ...new Set(
        (requests ?? [])
          .map((r) => (r.sender_id === user.id ? r.receiver_id : r.sender_id))
          .filter((id) => id !== user.id),
      ),
    ]

    const ids = new Set<string>(friendIds)
    for (const m of memberRows ?? []) ids.add(m.user_id)
    for (const c of contribRows ?? []) ids.add(c.user_id)
    for (const i of itemRows ?? []) if (i.claimed_by) ids.add(i.claimed_by)

    // rls on public.users only exposes your own row, so each name comes from
    // the security-definer function -- they at least all go out together
    const resolved = Object.fromEntries(
      await Promise.all(
        [...ids].map(async (id) => {
          const { data: name } = await supabase.rpc('username_for_id', { id })
          return [id, (name as string) ?? 'someone'] as const
        }),
      ),
    ) as Record<string, string>

    setNames(resolved)
    setMembers((prev) => prev.map((m) => ({ ...m, username: resolved[m.user_id] ?? '' })))
    setContributions((prev) => prev.map((c) => ({ ...c, username: resolved[c.user_id] ?? '' })))
    setFriends(
      friendIds
        .filter((id) => !memberIds.has(id))
        .map((id) => ({ id, username: resolved[id] ?? '' })),
    )
  }, [navigate, wishlistId])

  useEffect(() => {
    load()
  }, [load, shell.dataVersion])

  // the shell keeps its wishlists across navigations, so the header can be
  // drawn from memory immediately instead of waiting on a round trip
  useEffect(() => {
    if (wishlist) return
    const known = shell.wishlists.find((w) => w.wishlist_id === wishlistId)
    if (known) setWishlist(known)
  }, [shell.wishlists, wishlistId, wishlist])

  const isOwner = !!userId && wishlist?.id === userId
  const canEdit = isOwner || myRole === 'editor'
  // the whole point of aggregate visibility: the owner is not told who
  // reserved or bought what, only how much of the list is spoken for
  const aggregate = isOwner && wishlist?.purchase_visibility === 'aggregate'

  const counts = useMemo(() => {
    const bought = items.filter((i) => i.purchased).length
    const reserved = items.filter((i) => i.claimed_by && !i.purchased).length
    return { all: items.length, bought, reserved, available: items.length - bought - reserved }
  }, [items])

  const spent = useMemo(() => items.reduce((sum, i) => sum + (i.price ?? 0), 0), [items])

  const visible = useMemo(() => {
    const filtered = aggregate
      ? items
      : items.filter((item) => {
          if (tab === 'all') return true
          if (tab === 'bought') return item.purchased
          if (tab === 'reserved') return !!item.claimed_by && !item.purchased
          return !item.claimed_by && !item.purchased
        })
    return sortWishes(filtered, sort)
  }, [items, tab, sort, aggregate])

  const contributionsFor = useCallback(
    (itemId: string) => contributions.filter((c) => c.item_id === itemId),
    [contributions],
  )

  async function deleteWish() {
    if (!deletingWish || deleting) return
    setDeleting(true)
    const { error: failure } = await supabase
      .from('items')
      .delete()
      .eq('item_id', deletingWish.item_id)
    setDeleting(false)

    if (failure) {
      setError(failure.message)
      return
    }

    setDeletingWish(null)
    setViewing(null)
    shell.refresh()
  }

  const spokenFor = counts.reserved + counts.bought

  return (
    <div className="wl">
      <header className="wl-head">
        <div className="wl-cover" style={coverGradient(wishlistId)}>
          {wishlist?.item_img && <img src={wishlist.item_img} alt="" />}
        </div>

        <div className="wl-headline">
          <p className="wl-eyebrow">
            <Link to="/dashboard">Wishlists</Link> / {wishlist?.name ?? '...'}
          </p>
          <h1 className="wl-title">{wishlist?.name ?? ' '}</h1>
          {wishlist?.description && <p className="wl-desc">{wishlist.description}</p>}

          <div className="wl-headfoot">
            <div className="wl-facts">
              <div className="wl-fact">
                <span className="wl-fact-label">Total cost</span>
                <span className="wl-fact-value">
                  {loading ? '—' : money(spent)}
                  {wishlist?.budget != null && <small>/ {money(wishlist.budget)}</small>}
                </span>
              </div>

              <div className="wl-fact">
                <span className="wl-fact-label">Items</span>
                <span className="wl-fact-value">{loading ? '—' : items.length}</span>
              </div>

              <button type="button" className="wl-fact" onClick={() => setShowPeople(true)}>
                <span className="wl-fact-label">Friends</span>
                <span className="wl-fact-value">
                  <span className="wl-faces">
                    {members.slice(0, 3).map((m, i) => (
                      <span key={m.member_id} className={`wl-face wl-face--n${i + 1}`} />
                    ))}
                  </span>
                  {members.length === 0
                    ? 'Just you'
                    : `${members.length} friend${members.length === 1 ? '' : 's'}`}
                </span>
              </button>
            </div>

            <div className="wl-headactions">
              {/* visual only for now -- public share links would need a share
                  token and a read policy that does not require a session. use
                  Manage people to let someone in. */}
              <button
                type="button"
                disabled
                title="Public share links are not available yet — invite people from Manage people instead."
              >
                Share link
              </button>

              {isOwner && (
                <button type="button" onClick={() => setEditingList(true)}>
                  Edit list
                </button>
              )}

              {canEdit && (
                <button
                  type="button"
                  className="wl-add"
                  onClick={() => shell.openAddWish({ wishlistId })}
                >
                  + Add wish
                </button>
              )}
            </div>
          </div>
        </div>

        {/* leaves the wishlist the same way the breadcrumb does. it goes to
            the dashboard rather than back through history, so it behaves the
            same on a deep link or a refresh as it does mid-session. */}
        <button
          type="button"
          className="wl-close"
          onClick={() => navigate('/dashboard')}
          aria-label="Close this wishlist"
          title="Back to your wishlists"
        >
          &times;
        </button>
      </header>

      <div className="wl-bar">
        {aggregate ? (
          <span className="wl-aggregate">
            {spokenFor} of {counts.all} spoken for
          </span>
        ) : (
          <div className="wl-tabs">
            {(
              [
                ['all', 'All', counts.all],
                ['available', 'Available', counts.available],
                ['reserved', 'Reserved', counts.reserved],
                ['bought', 'Bought', counts.bought],
              ] as const
            ).map(([key, label, count]) => (
              <button
                key={key}
                type="button"
                className={tab === key ? 'wl-tab wl-tab--on' : 'wl-tab'}
                onClick={() => setTab(key)}
              >
                {label}
                <span className="wl-tab-count">{count}</span>
              </button>
            ))}
          </div>
        )}

        <div className="wl-sorts">
          <span className="wl-sorts-label">Sort</span>
          {(
            [
              ['priority', 'Priority'],
              ['price', 'Price'],
              ['added', 'Added'],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              className={sort === key ? 'wl-sort wl-sort--on' : 'wl-sort'}
              onClick={() => setSort(key)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {error && <p className="wl-error">{error}</p>}

      <ul className="wl-grid">
        {visible.map((item) => (
          <li key={item.item_id} className="wl-card">
            <div className="wl-card-media">
              {item.image_url ? (
                <img src={item.image_url} alt="" loading="lazy" />
              ) : (
                <span className="wl-card-blank">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <rect x="3" y="4.5" width="18" height="15" rx="2" />
                    <circle cx="8.5" cy="10" r="1.6" />
                    <path d="m4 17 5-4.5 4 3.5 3-2.5 4 3.5" strokeLinejoin="round" />
                  </svg>
                </span>
              )}

              {!aggregate && (
                <span
                  className={
                    item.purchased
                      ? 'wl-chip wl-chip--bought'
                      : item.claimed_by
                        ? 'wl-chip wl-chip--reserved'
                        : 'wl-chip'
                  }
                >
                  {item.purchased ? 'Bought' : item.claimed_by ? 'Reserved' : 'Available'}
                </span>
              )}

              {item.product_url && (
                <a
                  className="wl-card-open"
                  href={item.product_url}
                  target="_blank"
                  rel="noreferrer noopener"
                  aria-label={`Open the product page for ${item.name}`}
                >
                  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6">
                    <path d="M6 10 10.5 5.5M6.5 5.5h4.5V10" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </a>
              )}
            </div>

            <div className="wl-card-title">
              <span className="wl-card-name">{item.name}</span>
              {item.price != null && <span className="wl-card-price">{money(item.price)}</span>}
            </div>

            {item.notes && <p className="wl-card-note">{item.notes}</p>}

            <div className="wl-card-actions">
              <button type="button" onClick={() => setViewing(item)}>
                View
              </button>
              {canEdit && (
                <button type="button" onClick={() => setEditingWish(item)}>
                  Edit
                </button>
              )}
            </div>
          </li>
        ))}

        {!loading && visible.length === 0 && (
          <li className="wl-empty">
            {items.length === 0 ? 'No wishes on this list yet.' : 'Nothing in this filter.'}
          </li>
        )}
      </ul>

      <WishDetailModal
        open={!!viewing}
        item={viewing}
        userId={userId}
        names={names}
        contributions={viewing ? contributionsFor(viewing.item_id) : []}
        hideDetail={aggregate}
        canEdit={canEdit}
        onClose={() => setViewing(null)}
        onChanged={() => {
          shell.refresh()
          setViewing(null)
        }}
        onEdit={() => {
          setEditingWish(viewing)
          setViewing(null)
        }}
        onDelete={() => {
          setDeletingWish(viewing)
          setViewing(null)
        }}
      />

      <AddWishModal
        open={!!editingWish}
        item={editingWish}
        userId={userId}
        wishlists={wishlist ? [wishlist] : []}
        presetWishlistId={wishlistId}
        onClose={() => setEditingWish(null)}
        onNeedWishlist={() => setEditingWish(null)}
        onSaved={() => {
          setEditingWish(null)
          shell.refresh()
        }}
      />

      <WishlistFormModal
        open={editingList}
        userId={userId}
        wishlist={wishlist}
        onClose={() => setEditingList(false)}
        onSaved={(row) => {
          setWishlist(row)
          shell.refresh()
        }}
      />

      <ManagePeopleModal
        open={showPeople}
        wishlistId={wishlistId}
        members={members}
        friends={friends}
        isOwner={isOwner}
        onClose={() => setShowPeople(false)}
        onChanged={shell.refresh}
      />

      <ConfirmModal
        open={!!deletingWish}
        eyebrow="Delete wish"
        title={deletingWish ? `Delete ${deletingWish.name}?` : 'Delete wish?'}
        confirmLabel="Delete wish"
        busy={deleting}
        onConfirm={deleteWish}
        onClose={() => setDeletingWish(null)}
      >
        <p className="modal-empty-lead">This cannot be undone.</p>
        <p className="modal-empty-note">
          It is removed from this wishlist for everyone who can see it.
        </p>
      </ConfirmModal>
    </div>
  )
}

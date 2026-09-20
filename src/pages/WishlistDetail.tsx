import { useCallback, useEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { daysUntil, formatTargetDate } from '../lib/dates'
import { describeError } from '../lib/errors'
import { deleteStoredImages } from '../lib/storage'
import { supabase } from '../lib/supabase'
import { WISH_COLUMNS } from '../lib/types'
import type { Contribution, ItemClaim, Friend, WishItem, WishlistMember } from '../lib/types'
import AddWishModal from '../components/AddWishModal'
import { useShell } from '../components/AppShell'
import ConfirmModal from '../components/ConfirmModal'
import ManagePeopleModal from '../components/ManagePeopleModal'
import ShareModal from '../components/ShareModal'
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
  const [claims, setClaims] = useState<ItemClaim[]>([])
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
  const [sharing, setSharing] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)

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
      { data: claimRows },
      { data: requests },
    ] = await Promise.all([
      supabase
        .from('wishlists')
        .select(
          'wishlist_id, id, name, budget, created_at, purchase_visibility, item_img, description, occasion, target_date, share_token',
        )
        .eq('wishlist_id', wishlistId)
        .single(),
      supabase.from('items').select(WISH_COLUMNS).eq('wishlist_id', wishlistId),
      supabase
        .from('wishlist_members')
        .select('member_id, user_id, role')
        .eq('wishlist_id', wishlistId),
      // the !inner join is what scopes these to this list. without it rls
      // still allows the read, so it returned every pledge and every claim
      // on every list this account can see, to render one of them
      supabase
        .from('item_contributions')
        .select('contribution_id, item_id, user_id, amount, items!inner(wishlist_id)')
        .eq('items.wishlist_id', wishlistId),
      supabase
        .from('item_claims')
        .select('claim_id, item_id, user_id, quantity, items!inner(wishlist_id)')
        .eq('items.wishlist_id', wishlistId),
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
    setClaims(
      (claimRows ?? []).map((c) => ({
        claim_id: c.claim_id,
        item_id: c.item_id,
        user_id: c.user_id,
        quantity: Number(c.quantity),
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
    for (const c of claimRows ?? []) ids.add(c.user_id)

    // rls on public.users only exposes your own row, so names come from a
    // security-definer function -- usernames_for_ids (018) answers for the
    // whole set at once rather than one request per person
    const { data: nameRows } = ids.size
      ? await supabase.rpc('usernames_for_ids', { ids: [...ids] })
      : { data: [] }

    const resolved = Object.fromEntries(
      ((nameRows ?? []) as { id: string; username: string | null }[]).map((row) => [
        row.id,
        row.username ?? 'someone',
      ]),
    ) as Record<string, string>

    setNames(resolved)
    setMembers((prev) => prev.map((m) => ({ ...m, username: resolved[m.user_id] ?? '' })))
    setContributions((prev) => prev.map((c) => ({ ...c, username: resolved[c.user_id] ?? '' })))
    setClaims((prev) => prev.map((c) => ({ ...c, username: resolved[c.user_id] ?? '' })))
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

  /** item_id -> how many of it are already spoken for */
  const claimedByItem = useMemo(() => {
    const totals: Record<string, number> = {}
    for (const c of claims) totals[c.item_id] = (totals[c.item_id] ?? 0) + c.quantity
    return totals
  }, [claims])

  // a wish with 3 wanted and 1 reserved is still available -- "reserved"
  // means every one of them is accounted for
  const isSpokenFor = useCallback(
    (item: WishItem) => (claimedByItem[item.item_id] ?? 0) >= item.quantity,
    [claimedByItem],
  )

  const counts = useMemo(() => {
    const bought = items.filter((i) => i.purchased).length
    const reserved = items.filter((i) => !i.purchased && isSpokenFor(i)).length
    return { all: items.length, bought, reserved, available: items.length - bought - reserved }
  }, [items, isSpokenFor])

  const spent = useMemo(() => items.reduce((sum, i) => sum + (i.price ?? 0), 0), [items])

  const visible = useMemo(() => {
    const filtered = aggregate
      ? items
      : items.filter((item) => {
          if (tab === 'all') return true
          if (tab === 'bought') return item.purchased
          if (tab === 'reserved') return !item.purchased && isSpokenFor(item)
          return !item.purchased && !isSpokenFor(item)
        })
    return sortWishes(filtered, sort)
  }, [items, tab, sort, aggregate, isSpokenFor])

  const contributionsFor = useCallback(
    (itemId: string) => contributions.filter((c) => c.item_id === itemId),
    [contributions],
  )

  const claimsFor = useCallback(
    (itemId: string) => claims.filter((c) => c.item_id === itemId),
    [claims],
  )

  /**
   * First open with no token yet generates one; after that the same link is
   * shown every time. A token is never cleared here -- turning sharing back
   * off would need its own explicit control.
   */
  async function handleShare() {
    if (sharing || !wishlist) return

    if (!wishlist.share_token) {
      setSharing(true)
      const token = crypto.randomUUID()
      const { error: failure } = await supabase
        .from('wishlists')
        .update({ share_token: token })
        .eq('wishlist_id', wishlist.wishlist_id)
      setSharing(false)

      if (failure) {
        setError(failure.message)
        return
      }

      setWishlist((prev) => (prev ? { ...prev, share_token: token } : prev))
    }

    setShareOpen(true)
  }

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

    // the row is gone, so nothing points at its picture any more
    await deleteStoredImages([deletingWish.image_url])

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

          {(wishlist?.occasion || wishlist?.target_date) && (
            <p
              className={
                wishlist?.target_date && daysUntil(wishlist.target_date) <= 3 && daysUntil(wishlist.target_date) >= 0
                  ? 'wl-occasion wl-occasion--soon'
                  : 'wl-occasion'
              }
            >
              {wishlist.occasion}
              {wishlist.occasion && wishlist.target_date && ' · '}
              {wishlist.target_date &&
                (wishlist.occasion ? formatTargetDate(wishlist.target_date) : `Due ${formatTargetDate(wishlist.target_date)}`)}
            </p>
          )}

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
              {isOwner && (
                <button
                  type="button"
                  onClick={handleShare}
                  disabled={sharing}
                  title="Anyone with the link can view this wishlist, read-only — they still need to sign in to reserve anything."
                >
                  {sharing ? 'Creating link...' : 'Share link'}
                </button>
              )}

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
                      : isSpokenFor(item)
                        ? 'wl-chip wl-chip--reserved'
                        : 'wl-chip'
                  }
                >
                  {item.purchased
                    ? 'Bought'
                    : isSpokenFor(item)
                      ? 'Reserved'
                      : item.quantity > 1
                        ? `${item.quantity - (claimedByItem[item.item_id] ?? 0)} of ${item.quantity} left`
                        : 'Available'}
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
        claims={viewing ? claimsFor(viewing.item_id) : []}
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

      <ShareModal
        open={shareOpen}
        title={wishlist?.name ?? 'this wishlist'}
        url={
          wishlist?.share_token
            ? `${window.location.origin}/share/${wishlist.share_token}`
            : null
        }
        onClose={() => setShareOpen(false)}
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

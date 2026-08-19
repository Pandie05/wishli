import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import '../css/wishlist-detail-temp.css'

type Item = {
  item_id: string
  name: string
  product_url: string | null
  image_url: string | null
  price: number | null
  notes: string | null
  purchased: boolean
  priority: number | null
  added_at: string
}

type SortMode = 'priority' | 'added_asc' | 'added_desc' | 'price_asc' | 'price_desc'

function sortItems(items: Item[], mode: SortMode): Item[] {
  const sorted = [...items]
  switch (mode) {
    case 'priority':
      return sorted.sort(
        (a, b) =>
          (b.priority ?? 0) - (a.priority ?? 0) ||
          new Date(b.added_at).getTime() - new Date(a.added_at).getTime(),
      )
    case 'added_asc':
      return sorted.sort((a, b) => new Date(a.added_at).getTime() - new Date(b.added_at).getTime())
    case 'added_desc':
      return sorted.sort((a, b) => new Date(b.added_at).getTime() - new Date(a.added_at).getTime())
    case 'price_asc':
      return sorted.sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity))
    case 'price_desc':
      return sorted.sort((a, b) => (b.price ?? -Infinity) - (a.price ?? -Infinity))
  }
}

type Member = {
  member_id: string
  user_id: string
  username: string
}

type Friend = {
  id: string
  username: string
}

export default function WishlistDetail() {
  const { wishlistId } = useParams<{ wishlistId: string }>()
  const navigate = useNavigate()

  const [userId, setUserId] = useState<string | null>(null)
  const [wishlistName, setWishlistName] = useState('')
  const [wishlistBudget, setWishlistBudget] = useState<number | null>(null)
  const [purchaseVisibility, setPurchaseVisibility] = useState<'full' | 'aggregate'>('full')
  const [ownerId, setOwnerId] = useState<string | null>(null)
  const [items, setItems] = useState<Item[]>([])
  const [members, setMembers] = useState<Member[]>([])
  const [friends, setFriends] = useState<Friend[]>([])
  const [selectedFriendId, setSelectedFriendId] = useState('')
  const [sortMode, setSortMode] = useState<SortMode>('priority')
  const [loading, setLoading] = useState(true)

  const [name, setName] = useState('')
  const [productUrl, setProductUrl] = useState('')
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [price, setPrice] = useState('')
  const [mostWanted, setMostWanted] = useState(false)
  const [notes, setNotes] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [fetchingPreview, setFetchingPreview] = useState(false)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editProductUrl, setEditProductUrl] = useState('')
  const [editPrice, setEditPrice] = useState('')
  const [editMostWanted, setEditMostWanted] = useState(false)
  const [editNotes, setEditNotes] = useState('')

  useEffect(() => {
    let cancelled = false

    async function load() {
      const { data } = await supabase.auth.getUser()
      const user = data.user

      if (!user) {
        if (!cancelled) navigate('/login', { replace: true })
        return
      }

      // rls hides wishlists that aren't yours or shared with you, so a bad
      // id just gets no row
      const { data: wishlist } = await supabase
        .from('wishlists')
        .select('id, name, budget, purchase_visibility')
        .eq('wishlist_id', wishlistId)
        .single()

      const { data: rows, error: fetchError } = await supabase
        .from('items')
        .select('item_id, name, product_url, image_url, price, notes, purchased, priority, added_at')
        .eq('wishlist_id', wishlistId)
        .order('added_at', { ascending: false })

      const isOwner = wishlist?.id === user.id

      let memberRows: Member[] = []
      let friendRows: Friend[] = []

      if (isOwner) {
        const { data: memberships } = await supabase
          .from('wishlist_members')
          .select('member_id, user_id')
          .eq('wishlist_id', wishlistId)

        memberRows = await Promise.all(
          (memberships ?? []).map(async (m) => {
            const { data: username } = await supabase.rpc('username_for_id', { id: m.user_id })
            return { member_id: m.member_id, user_id: m.user_id, username: username ?? '(unknown)' }
          }),
        )

        const { data: requests } = await supabase
          .from('friend_requests')
          .select('sender_id, receiver_id, status')
          .eq('status', 'accepted')

        const friendIds = (requests ?? []).map((r) =>
          r.sender_id === user.id ? r.receiver_id : r.sender_id,
        )
        const memberIds = new Set(memberRows.map((m) => m.user_id))

        friendRows = await Promise.all(
          friendIds
            .filter((id) => !memberIds.has(id))
            .map(async (id) => {
              const { data: username } = await supabase.rpc('username_for_id', { id })
              return { id, username: username ?? '(unknown)' }
            }),
        )
      }

      if (!cancelled) {
        setUserId(user.id)
        setWishlistName(wishlist?.name ?? '')
        setWishlistBudget(wishlist?.budget ?? null)
        setPurchaseVisibility(wishlist?.purchase_visibility ?? 'full')
        setOwnerId(wishlist?.id ?? null)
        if (!fetchError) setItems(rows ?? [])
        setMembers(memberRows)
        setFriends(friendRows)
        setLoading(false)
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [navigate, wishlistId])

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting || !userId) return

    const trimmed = name.trim()
    if (!trimmed) {
      setError('give it a name')
      return
    }

    setError(null)
    setSubmitting(true)

    const { data, error: insertError } = await supabase
      .from('items')
      .insert({
        wishlist_id: wishlistId,
        user_id: userId,
        name: trimmed,
        product_url: productUrl.trim() || null,
        image_url: imageUrl,
        price: price ? Number(price) : null,
        priority: mostWanted ? 1 : null,
        notes: notes.trim() || null,
      })
      .select('item_id, name, product_url, image_url, price, notes, purchased, priority, added_at')
      .single()

    if (insertError) {
      setError(insertError.message)
      setSubmitting(false)
      return
    }

    setItems((prev) => [data, ...prev])
    setName('')
    setProductUrl('')
    setImageUrl(null)
    setPrice('')
    setMostWanted(false)
    setNotes('')
    setSubmitting(false)
  }

  async function fetchPreview() {
    const url = productUrl.trim()
    if (!url || fetchingPreview) return

    setFetchingPreview(true)
    setError(null)

    const { data, error: fnError } = await supabase.functions.invoke('fetch-link-preview', {
      body: { url },
    })

    setFetchingPreview(false)

    if (fnError) {
      setError('could not fetch details for that link')
      return
    }

    if (data?.title && !name.trim()) setName(data.title)
    if (data?.price != null) setPrice(String(data.price))
    if (data?.image) setImageUrl(data.image)
  }

  function startEdit(item: Item) {
    setEditingId(item.item_id)
    setEditName(item.name)
    setEditProductUrl(item.product_url ?? '')
    setEditPrice(item.price != null ? String(item.price) : '')
    setEditMostWanted(item.priority != null)
    setEditNotes(item.notes ?? '')
  }

  function cancelEdit() {
    setEditingId(null)
  }

  async function saveEdit(id: string) {
    const trimmed = editName.trim()
    if (!trimmed) return

    const { data, error: updateError } = await supabase
      .from('items')
      .update({
        name: trimmed,
        product_url: editProductUrl.trim() || null,
        price: editPrice ? Number(editPrice) : null,
        priority: editMostWanted ? 1 : null,
        notes: editNotes.trim() || null,
      })
      .eq('item_id', id)
      .select('item_id, name, product_url, image_url, price, notes, purchased, priority, added_at')
      .single()

    if (updateError) {
      setError(updateError.message)
      return
    }

    setItems((prev) => prev.map((item) => (item.item_id === id ? data : item)))
    setEditingId(null)
  }

  async function togglePurchased(item: Item) {
    // members can only flip this one column, not edit the item, so this goes
    // through a function instead of a direct table update
    const { error: rpcError } = await supabase.rpc('set_item_purchased', {
      item_id: item.item_id,
      purchased: !item.purchased,
    })

    if (rpcError) {
      setError(rpcError.message)
      return
    }

    setItems((prev) =>
      prev.map((i) => (i.item_id === item.item_id ? { ...i, purchased: !i.purchased } : i)),
    )
  }

  async function addMember() {
    if (!selectedFriendId) return

    const { data, error: insertError } = await supabase
      .from('wishlist_members')
      .insert({ wishlist_id: wishlistId, user_id: selectedFriendId })
      .select('member_id, user_id')
      .single()

    if (insertError) {
      setError(insertError.message)
      return
    }

    const friend = friends.find((f) => f.id === selectedFriendId)
    setMembers((prev) => [
      ...prev,
      { member_id: data.member_id, user_id: data.user_id, username: friend?.username ?? '' },
    ])
    setFriends((prev) => prev.filter((f) => f.id !== selectedFriendId))
    setSelectedFriendId('')
  }

  async function removeMember(member: Member) {
    const { error: deleteError } = await supabase
      .from('wishlist_members')
      .delete()
      .eq('member_id', member.member_id)

    if (deleteError) {
      setError(deleteError.message)
      return
    }

    setMembers((prev) => prev.filter((m) => m.member_id !== member.member_id))
    setFriends((prev) => [...prev, { id: member.user_id, username: member.username }])
  }

  async function deleteItem(id: string) {
    if (!window.confirm('Delete this item?')) return

    const { error: deleteError } = await supabase.from('items').delete().eq('item_id', id)
    if (deleteError) {
      setError(deleteError.message)
      return
    }

    setItems((prev) => prev.filter((item) => item.item_id !== id))
  }

  if (loading) return <p>Loading...</p>

  const isOwner = ownerId !== null && ownerId === userId
  const spent = items.reduce((sum, item) => sum + (item.price ?? 0), 0)
  const overBudget = wishlistBudget != null && spent > wishlistBudget
  // owner opted into not spoiling their own surprise -- members still see
  // full detail regardless, this only affects what the owner sees
  const hidePurchasedDetail = isOwner && purchaseVisibility === 'aggregate'
  const purchasedCount = items.filter((item) => item.purchased).length
  const sortedItems = sortItems(items, sortMode)

  return (
    <div className="wl-detail">
      <Link to="/dashboard">back to dashboard</Link>
      <h1>{wishlistName || 'Wishlist'}</h1>

      <div className="wl-budget">
        {wishlistBudget != null ? (
          <>
            <span className={overBudget ? 'wl-budget-label wl-budget-label--over' : 'wl-budget-label'}>
              ${spent} of ${wishlistBudget}
            </span>
            <div className="wl-budget-bar">
              <div
                className={overBudget ? 'wl-budget-bar-fill wl-budget-bar-fill--over' : 'wl-budget-bar-fill'}
                style={{ width: `${Math.min((spent / wishlistBudget) * 100, 100)}%` }}
              />
            </div>
          </>
        ) : (
          <span className="wl-budget-label">${spent} spent (no budget set)</span>
        )}
      </div>

      {isOwner && (
        <form className="wl-form" onSubmit={handleCreate}>
          <input
            type="text"
            placeholder="item name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <input
            type="url"
            placeholder="product url (optional)"
            value={productUrl}
            onChange={(e) => setProductUrl(e.target.value)}
          />
          <button type="button" onClick={fetchPreview} disabled={!productUrl.trim() || fetchingPreview}>
            {fetchingPreview ? 'Fetching...' : 'Fetch details'}
          </button>
          {imageUrl && <img src={imageUrl} alt="" className="wl-form-preview" />}
          <input
            type="number"
            placeholder="price (optional)"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
          />
          <label className="wl-checkbox-label">
            <input
              type="checkbox"
              checked={mostWanted}
              onChange={(e) => setMostWanted(e.target.checked)}
            />
            Most wanted
          </label>
          <input
            type="text"
            placeholder="notes (optional)"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
          <button type="submit" disabled={submitting}>
            {submitting ? 'Adding...' : 'Add item'}
          </button>
        </form>
      )}

      {error && <p className="wl-error">{error}</p>}

      {hidePurchasedDetail && (
        <p className="wl-budget-label">
          {purchasedCount} of {items.length} items claimed
        </p>
      )}

      <div className="wl-sort">
        <label htmlFor="wl-sort-select">Sort by</label>
        <select
          id="wl-sort-select"
          value={sortMode}
          onChange={(e) => setSortMode(e.target.value as SortMode)}
        >
          <option value="priority">Most wanted first</option>
          <option value="added_desc">Newest added</option>
          <option value="added_asc">Oldest added</option>
          <option value="price_asc">Price: low to high</option>
          <option value="price_desc">Price: high to low</option>
        </select>
      </div>

      <ul className="wl-list">
        {sortedItems.map((item) =>
          editingId === item.item_id ? (
            <li key={item.item_id} className="wl-list-item wl-list-item--editing">
              <input
                type="text"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
              />
              <input
                type="url"
                value={editProductUrl}
                onChange={(e) => setEditProductUrl(e.target.value)}
              />
              <input
                type="number"
                value={editPrice}
                onChange={(e) => setEditPrice(e.target.value)}
              />
              <label className="wl-checkbox-label">
                <input
                  type="checkbox"
                  checked={editMostWanted}
                  onChange={(e) => setEditMostWanted(e.target.checked)}
                />
                Most wanted
              </label>
              <input
                type="text"
                value={editNotes}
                onChange={(e) => setEditNotes(e.target.value)}
              />
              <button type="button" onClick={() => saveEdit(item.item_id)}>
                Save
              </button>
              <button type="button" onClick={cancelEdit}>
                Cancel
              </button>
            </li>
          ) : (
            <li
              key={item.item_id}
              className={
                item.purchased && !hidePurchasedDetail
                  ? 'wl-list-item wl-list-item--purchased'
                  : 'wl-list-item'
              }
            >
              {!hidePurchasedDetail && (
                <input
                  type="checkbox"
                  checked={item.purchased}
                  onChange={() => togglePurchased(item)}
                />
              )}
              {item.image_url && <img src={item.image_url} alt="" className="wl-list-item-thumb" />}
              {item.product_url ? (
                <a href={item.product_url} target="_blank" rel="noreferrer">
                  {item.name}
                </a>
              ) : (
                <span>{item.name}</span>
              )}
              {item.price != null && <span>${item.price}</span>}
              {item.priority != null && (
                <span className="wl-list-item-priority">Most wanted</span>
              )}
              <span className="wl-list-item-date">
                added {new Date(item.added_at).toLocaleDateString()}
              </span>
              {isOwner && (
                <>
                  <button type="button" onClick={() => startEdit(item)}>
                    Edit
                  </button>
                  <button type="button" onClick={() => deleteItem(item.item_id)}>
                    Delete
                  </button>
                </>
              )}
            </li>
          ),
        )}
        {items.length === 0 && <li className="wl-empty">no items yet</li>}
      </ul>

      {isOwner && (
        <>
          <h2>Share</h2>
          <ul className="wl-list">
            {members.map((m) => (
              <li key={m.member_id} className="wl-list-item">
                <span>{m.username}</span>
                <button type="button" onClick={() => removeMember(m)}>
                  Remove
                </button>
              </li>
            ))}
            {members.length === 0 && <li className="wl-empty">not shared with anyone</li>}
          </ul>

          {friends.length > 0 && (
            <div className="wl-form">
              <select
                value={selectedFriendId}
                onChange={(e) => setSelectedFriendId(e.target.value)}
              >
                <option value="">choose a friend...</option>
                {friends.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.username}
                  </option>
                ))}
              </select>
              <button type="button" onClick={addMember}>
                Add
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

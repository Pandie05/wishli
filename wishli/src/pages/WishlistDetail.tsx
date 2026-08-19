import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import '../css/wishlist-detail-temp.css'

type Item = {
  item_id: string
  name: string
  product_url: string | null
  price: number | null
  notes: string | null
  purchased: boolean
  added_at: string
}

export default function WishlistDetail() {
  const { wishlistId } = useParams<{ wishlistId: string }>()
  const navigate = useNavigate()

  const [userId, setUserId] = useState<string | null>(null)
  const [wishlistName, setWishlistName] = useState('')
  const [items, setItems] = useState<Item[]>([])
  const [loading, setLoading] = useState(true)

  const [name, setName] = useState('')
  const [productUrl, setProductUrl] = useState('')
  const [price, setPrice] = useState('')
  const [notes, setNotes] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editProductUrl, setEditProductUrl] = useState('')
  const [editPrice, setEditPrice] = useState('')
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

      // rls hides wishlists that aren't yours, so a bad id just gets no row
      const { data: wishlist } = await supabase
        .from('wishlists')
        .select('name')
        .eq('wishlist_id', wishlistId)
        .single()

      const { data: rows, error: fetchError } = await supabase
        .from('items')
        .select('item_id, name, product_url, price, notes, purchased, added_at')
        .eq('wishlist_id', wishlistId)
        .order('added_at', { ascending: false })

      if (!cancelled) {
        setUserId(user.id)
        setWishlistName(wishlist?.name ?? '')
        if (!fetchError) setItems(rows ?? [])
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
        price: price ? Number(price) : null,
        notes: notes.trim() || null,
      })
      .select('item_id, name, product_url, price, notes, purchased, added_at')
      .single()

    if (insertError) {
      setError(insertError.message)
      setSubmitting(false)
      return
    }

    setItems((prev) => [data, ...prev])
    setName('')
    setProductUrl('')
    setPrice('')
    setNotes('')
    setSubmitting(false)
  }

  function startEdit(item: Item) {
    setEditingId(item.item_id)
    setEditName(item.name)
    setEditProductUrl(item.product_url ?? '')
    setEditPrice(item.price != null ? String(item.price) : '')
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
        notes: editNotes.trim() || null,
      })
      .eq('item_id', id)
      .select('item_id, name, product_url, price, notes, purchased, added_at')
      .single()

    if (updateError) {
      setError(updateError.message)
      return
    }

    setItems((prev) => prev.map((item) => (item.item_id === id ? data : item)))
    setEditingId(null)
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

  return (
    <div className="wl-detail">
      <Link to="/dashboard">back to dashboard</Link>
      <h1>{wishlistName || 'Wishlist'}</h1>

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
        <input
          type="number"
          placeholder="price (optional)"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
        />
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

      {error && <p className="wl-error">{error}</p>}

      <ul className="wl-list">
        {items.map((item) =>
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
            <li key={item.item_id} className="wl-list-item">
              {item.product_url ? (
                <a href={item.product_url} target="_blank" rel="noreferrer">
                  {item.name}
                </a>
              ) : (
                <span>{item.name}</span>
              )}
              {item.price != null && <span>${item.price}</span>}
              <button type="button" onClick={() => startEdit(item)}>
                Edit
              </button>
              <button type="button" onClick={() => deleteItem(item.item_id)}>
                Delete
              </button>
            </li>
          ),
        )}
        {items.length === 0 && <li className="wl-empty">no items yet</li>}
      </ul>
    </div>
  )
}

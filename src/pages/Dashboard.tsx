import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import Modal from '../components/Modal'
import '../css/dashboard-temp.css'

type Wishlist = {
  wishlist_id: string
  name: string
  budget: number | null
  created_at: string
  purchase_visibility: 'full' | 'aggregate'
}

export default function Dashboard() {
  const navigate = useNavigate()
  const [userId, setUserId] = useState<string | null>(null)
  const [username, setUsername] = useState('')
  const [wishlists, setWishlists] = useState<Wishlist[]>([])
  const [sharedWishlists, setSharedWishlists] = useState<Wishlist[]>([])
  const [itemCounts, setItemCounts] = useState<Record<string, number>>({})
  const [itemTotals, setItemTotals] = useState<Record<string, number>>({})
  const [unreadCount, setUnreadCount] = useState(0)
  const [loading, setLoading] = useState(true)

  const [name, setName] = useState('')
  const [budget, setBudget] = useState('')
  const [visibility, setVisibility] = useState<'full' | 'aggregate'>('full')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [showAddModal, setShowAddModal] = useState(false)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editBudget, setEditBudget] = useState('')
  const [editVisibility, setEditVisibility] = useState<'full' | 'aggregate'>('full')

  useEffect(() => {
    let cancelled = false

    async function load() {
      const { data } = await supabase.auth.getUser()
      const user = data.user

      if (!user) {
        if (!cancelled) navigate('/login', { replace: true })
        return
      }

      const { data: profile } = await supabase
        .from('users')
        .select('username')
        .eq('id', user.id)
        .single()

      const { data: rows, error: fetchError } = await supabase
        .from('wishlists')
        .select('wishlist_id, name, budget, created_at, purchase_visibility')
        .eq('id', user.id)
        .order('created_at', { ascending: false })

      // rls also scopes wishlists you're a member of, not just own, so this
      // picks up everything else the previous query's .eq() excluded
      const { data: sharedRows } = await supabase
        .from('wishlists')
        .select('wishlist_id, name, budget, created_at, purchase_visibility')
        .neq('id', user.id)
        .order('created_at', { ascending: false })

      // rls on items already scopes this to items on wishlists you can see
      const { data: itemRows } = await supabase.from('items').select('wishlist_id, price')

      const counts: Record<string, number> = {}
      const totals: Record<string, number> = {}
      for (const item of itemRows ?? []) {
        counts[item.wishlist_id] = (counts[item.wishlist_id] ?? 0) + 1
        totals[item.wishlist_id] = (totals[item.wishlist_id] ?? 0) + (item.price ?? 0)
      }

      const { count } = await supabase
        .from('notifications')
        .select('notification_id', { count: 'exact', head: true })
        .eq('is_read', false)

      if (!cancelled) {
        setUserId(user.id)
        setUsername(profile?.username ?? '')
        if (!fetchError) setWishlists(rows ?? [])
        setSharedWishlists(sharedRows ?? [])
        setItemCounts(counts)
        setItemTotals(totals)
        setUnreadCount(count ?? 0)
        setLoading(false)
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [navigate])

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

    // insert() with .select() so we get the row back without a refetch
    const { data, error: insertError } = await supabase
      .from('wishlists')
      .insert({
        id: userId,
        name: trimmed,
        budget: budget ? Number(budget) : null,
        purchase_visibility: visibility,
      })
      .select('wishlist_id, name, budget, created_at, purchase_visibility')
      .single()

    if (insertError) {
      setError(insertError.message)
      setSubmitting(false)
      return
    }

    setWishlists((prev) => [data, ...prev])
    setName('')
    setBudget('')
    setVisibility('full')
    setSubmitting(false)
    setShowAddModal(false)
  }

  function startEdit(w: Wishlist) {
    setEditingId(w.wishlist_id)
    setEditName(w.name)
    setEditBudget(w.budget != null ? String(w.budget) : '')
    setEditVisibility(w.purchase_visibility)
  }

  function cancelEdit() {
    setEditingId(null)
  }

  async function saveEdit(id: string) {
    const trimmed = editName.trim()
    if (!trimmed) return

    const { data, error: updateError } = await supabase
      .from('wishlists')
      .update({
        name: trimmed,
        budget: editBudget ? Number(editBudget) : null,
        purchase_visibility: editVisibility,
      })
      .eq('wishlist_id', id)
      .select('wishlist_id, name, budget, created_at, purchase_visibility')
      .single()

    if (updateError) {
      setError(updateError.message)
      return
    }

    setWishlists((prev) => prev.map((w) => (w.wishlist_id === id ? data : w)))
    setEditingId(null)
  }

  async function deleteWishlist(id: string) {
    if (!window.confirm('Delete this wishlist?')) return

    const { error: deleteError } = await supabase.from('wishlists').delete().eq('wishlist_id', id)
    if (deleteError) {
      setError(deleteError.message)
      return
    }

    setWishlists((prev) => prev.filter((w) => w.wishlist_id !== id))
  }

  async function handleLogout() {
    await supabase.auth.signOut()
    navigate('/login', { replace: true })
  }

  if (loading) return <p>Loading...</p>

  const totalBudget = wishlists.reduce((sum, w) => sum + (w.budget ?? 0), 0)
  const totalSpent = wishlists.reduce((sum, w) => sum + (itemTotals[w.wishlist_id] ?? 0), 0)
  const totalItems = Object.values(itemCounts).reduce((sum, c) => sum + c, 0)

  return (
    <div className="dash">
      <div className="dash-header">
        <h1>Dashboard</h1>
        <span className="dash-greeting">Hello: {username}</span>
        <Link to="/friends">Friends</Link>
        <Link to="/notifications">
          Notifications{unreadCount > 0 ? ` (${unreadCount})` : ''}
        </Link>
        <Link to="/settings">Settings</Link>
        <button type="button" onClick={handleLogout}>
          Logout
        </button>
      </div>

      <div className="dash-stats">
        <div className="dash-stat">
          <span className="dash-stat-value">{wishlists.length}</span>
          <span className="dash-stat-label">wishlists</span>
        </div>
        <div className="dash-stat">
          <span className="dash-stat-value">
            ${totalSpent} <span className="dash-stat-value-sub">/ ${totalBudget}</span>
          </span>
          <span className="dash-stat-label">spent / budget</span>
        </div>
        <div className="dash-stat">
          <span className="dash-stat-value">{totalItems}</span>
          <span className="dash-stat-label">items</span>
        </div>
      </div>

      <button type="button" onClick={() => setShowAddModal(true)}>
        + Add wishlist
      </button>

      <Modal open={showAddModal} onClose={() => setShowAddModal(false)} title="Create a wishlist">
        {error && <p className="dash-error">{error}</p>}
        <form className="dash-form" onSubmit={handleCreate}>
          <input
            type="text"
            placeholder="wishlist name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <input
            type="number"
            placeholder="budget (optional)"
            value={budget}
            onChange={(e) => setBudget(e.target.value)}
          />
          <select
            value={visibility}
            onChange={(e) => setVisibility(e.target.value as 'full' | 'aggregate')}
          >
            <option value="full">Full purchase visibility</option>
            <option value="aggregate">Aggregate only (hide from me)</option>
          </select>
          <button type="submit" disabled={submitting}>
            {submitting ? 'Adding...' : 'Add wishlist'}
          </button>
        </form>
      </Modal>

      {error && <p className="dash-error">{error}</p>}

      <ul className="dash-list">
        {wishlists.map((w) =>
          editingId === w.wishlist_id ? (
            <li key={w.wishlist_id} className="dash-list-item">
              <input
                type="text"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
              />
              <input
                type="number"
                value={editBudget}
                onChange={(e) => setEditBudget(e.target.value)}
              />
              <select
                value={editVisibility}
                onChange={(e) => setEditVisibility(e.target.value as 'full' | 'aggregate')}
              >
                <option value="full">Full purchase visibility</option>
                <option value="aggregate">Aggregate only (hide from me)</option>
              </select>
              <button type="button" onClick={() => saveEdit(w.wishlist_id)}>
                Save
              </button>
              <button type="button" onClick={cancelEdit}>
                Cancel
              </button>
            </li>
          ) : (
            <li key={w.wishlist_id} className="dash-list-item">
              <span>
                <Link to={`/wishlist/${w.wishlist_id}`}>{w.name}</Link>
                <span className="dash-list-item-count">
                  {itemCounts[w.wishlist_id] ?? 0} items
                </span>
              </span>
              {w.budget != null ? (
                <span>
                  ${itemTotals[w.wishlist_id] ?? 0} / ${w.budget}
                </span>
              ) : (
                (itemTotals[w.wishlist_id] ?? 0) > 0 && <span>${itemTotals[w.wishlist_id]} spent</span>
              )}
              <button type="button" onClick={() => startEdit(w)}>
                Edit
              </button>
              <button type="button" onClick={() => deleteWishlist(w.wishlist_id)}>
                Delete
              </button>
            </li>
          ),
        )}
        {wishlists.length === 0 && <li className="dash-empty">no wishlists yet</li>}
      </ul>

      <h2>Shared with me</h2>
      <ul className="dash-list">
        {sharedWishlists.map((w) => (
          <li key={w.wishlist_id} className="dash-list-item">
            <span>
              <Link to={`/wishlist/${w.wishlist_id}`}>{w.name}</Link>
              <span className="dash-list-item-count">
                {itemCounts[w.wishlist_id] ?? 0} items
              </span>
            </span>
            {w.budget != null ? (
              <span>
                ${itemTotals[w.wishlist_id] ?? 0} / ${w.budget}
              </span>
            ) : (
              (itemTotals[w.wishlist_id] ?? 0) > 0 && <span>${itemTotals[w.wishlist_id]} spent</span>
            )}
          </li>
        ))}
        {sharedWishlists.length === 0 && (
          <li className="dash-empty">nothing shared with you yet</li>
        )}
      </ul>
    </div>
  )
}

import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import '../css/dashboard-temp.css'

type Wishlist = {
  wishlist_id: string
  name: string
  budget: number | null
  created_at: string
}

export default function Dashboard() {
  const navigate = useNavigate()
  const [userId, setUserId] = useState<string | null>(null)
  const [wishlists, setWishlists] = useState<Wishlist[]>([])
  const [loading, setLoading] = useState(true)

  const [name, setName] = useState('')
  const [budget, setBudget] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function load() {
      const { data } = await supabase.auth.getUser()
      const user = data.user

      if (!user) {
        if (!cancelled) navigate('/login', { replace: true })
        return
      }

      const { data: rows, error: fetchError } = await supabase
        .from('wishlists')
        .select('wishlist_id, name, budget, created_at')
        .eq('id', user.id)
        .order('created_at', { ascending: false })

      if (!cancelled) {
        setUserId(user.id)
        if (!fetchError) setWishlists(rows ?? [])
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
      })
      .select('wishlist_id, name, budget, created_at')
      .single()

    if (insertError) {
      setError(insertError.message)
      setSubmitting(false)
      return
    }

    setWishlists((prev) => [data, ...prev])
    setName('')
    setBudget('')
    setSubmitting(false)
  }

  async function handleLogout() {
    await supabase.auth.signOut()
    navigate('/login', { replace: true })
  }

  if (loading) return <p>Loading...</p>

  const totalBudget = wishlists.reduce((sum, w) => sum + (w.budget ?? 0), 0)

  return (
    <div className="dash">
      <div className="dash-header">
        <h1>Dashboard</h1>
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
          <span className="dash-stat-value">${totalBudget}</span>
          <span className="dash-stat-label">budget</span>
        </div>
        <div className="dash-stat">
          {/* items table has no rls yet, wire this up once add-item exists */}
          <span className="dash-stat-value">0</span>
          <span className="dash-stat-label">items</span>
        </div>
      </div>

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
        <button type="submit" disabled={submitting}>
          {submitting ? 'Adding...' : 'Add wishlist'}
        </button>
      </form>

      {error && <p className="dash-error">{error}</p>}

      <ul className="dash-list">
        {wishlists.map((w) => (
          <li key={w.wishlist_id} className="dash-list-item">
            <Link to={`/wishlist/${w.wishlist_id}`}>{w.name}</Link>
            {w.budget != null && <span>${w.budget}</span>}
          </li>
        ))}
        {wishlists.length === 0 && <li className="dash-empty">no wishlists yet</li>}
      </ul>
    </div>
  )
}

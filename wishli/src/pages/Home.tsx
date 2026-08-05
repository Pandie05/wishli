import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

// Placeholder landing page. Intentionally unstyled.
export default function Home() {
  const navigate = useNavigate()
  const [username, setUsername] = useState('')
  const [loading, setLoading] = useState(true)

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

      if (!cancelled) {
        setUsername(profile?.username ?? user.email ?? '')
        setLoading(false)
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [navigate])

  async function handleLogout() {
    await supabase.auth.signOut()
    navigate('/login', { replace: true })
  }

  if (loading) return <p>Loading...</p>

  return (
    <div>
      <p>ur logged in {username}</p>
      <Link to="/wishlist">Wishlist</Link>
      <button type="button" onClick={handleLogout}>
        Logout
      </button>
    </div>
  )
}

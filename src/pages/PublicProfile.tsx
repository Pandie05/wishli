import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { formatTargetDate } from '../lib/dates'
import { coverGradient } from '../lib/format'
import { supabase } from '../lib/supabase'
import '../css/shared-wishlist.css'

type Profile = {
  username: string
  avatar_url: string | null
}

type ProfileWishlist = {
  wishlist_id: string
  name: string
  description: string | null
  occasion: string | null
  target_date: string | null
  item_img: string | null
  share_token: string
  item_count: number
}

function initials(name: string): string {
  return name.slice(0, 2).toUpperCase()
}

/**
 * Someone's public page at /u/<username> -- no session needed, same tier as
 * the share links it points at. Both requests go through security-definer
 * functions (016) that answer only for handles which have switched the
 * profile on, and only list wishlists that already have a share token, so
 * nothing here is reachable that the owner did not deliberately publish.
 */
export default function PublicProfile() {
  const { username = '' } = useParams()
  const [profile, setProfile] = useState<Profile | null>(null)
  const [wishlists, setWishlists] = useState<ProfileWishlist[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    async function load() {
      const [{ data: found }, { data: rows }] = await Promise.all([
        supabase.rpc('get_public_profile', { handle: username }).maybeSingle(),
        supabase.rpc('get_public_profile_wishlists', { handle: username }),
      ])

      if (cancelled) return
      setProfile((found as Profile | null) ?? null)
      setWishlists((rows ?? []) as ProfileWishlist[])
      setLoading(false)
    }

    load()
    return () => {
      cancelled = true
    }
  }, [username])

  if (loading) {
    return (
      <div className="shared-page">
        <p className="shared-status">Loading...</p>
      </div>
    )
  }

  // a private profile and a username nobody has are deliberately the same
  // answer -- otherwise this page would confirm which handles exist
  if (!profile) {
    return (
      <div className="shared-page">
        <p className="shared-status">There is no public profile at this address.</p>
      </div>
    )
  }

  return (
    <div className="shared-page">
      <header className="shared-head">
        <span className="shared-brand">
          wishli<span className="shared-brand-dot" />
        </span>
        <Link to="/login" className="shared-cta">
          Make your own
        </Link>
      </header>

      <div className="profile">
        <div className="profile-id">
          <span className="profile-avatar">
            {profile.avatar_url ? (
              <img src={profile.avatar_url} alt="" />
            ) : (
              initials(profile.username)
            )}
          </span>
          <h1 className="profile-name">@{profile.username}</h1>
          <p className="profile-count">
            {wishlists.length === 0
              ? 'No shared wishlists yet'
              : `${wishlists.length} shared wishlist${wishlists.length === 1 ? '' : 's'}`}
          </p>
        </div>

        <ul className="profile-grid">
          {wishlists.map((w) => (
            <li key={w.wishlist_id}>
              <Link to={`/share/${w.share_token}`} className="profile-card">
                <span className="profile-cover" style={coverGradient(w.wishlist_id)}>
                  {w.item_img && <img src={w.item_img} alt="" loading="lazy" />}
                </span>

                <span className="profile-card-body">
                  <span className="profile-card-name">{w.name}</span>

                  {(w.occasion || w.target_date) && (
                    <span className="profile-card-when">
                      {w.occasion}
                      {w.occasion && w.target_date && ' · '}
                      {w.target_date && formatTargetDate(w.target_date)}
                    </span>
                  )}

                  <span className="profile-card-count">
                    {w.item_count} item{w.item_count === 1 ? '' : 's'}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { formatTargetDate } from '../lib/dates'
import { supabase } from '../lib/supabase'
import '../css/wishlist-detail.css'
import '../css/shared-wishlist.css'

type SharedWishlistRow = {
  wishlist_id: string
  name: string
  description: string | null
  occasion: string | null
  target_date: string | null
  item_img: string | null
  budget: number | null
}

type SharedItem = {
  item_id: string
  name: string
  product_url: string | null
  image_url: string | null
  price: number | null
  notes: string | null
  quantity: number
  claimed_quantity: number
  reserved: boolean
}

function money(value: number): string {
  return `$${value.toLocaleString('en-US', {
    minimumFractionDigits: value % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })}`
}

/**
 * The read-only page a share link opens to -- no session, no shell. Both
 * requests go through security-definer functions keyed on the token (see
 * get_shared_wishlist/-items in 013) rather than any direct table access, so
 * there is nothing here an anonymous visitor can reach beyond the one
 * wishlist whose exact token they were given.
 */
export default function SharedWishlist() {
  const { token = '' } = useParams()
  const [wishlist, setWishlist] = useState<SharedWishlistRow | null>(null)
  const [items, setItems] = useState<SharedItem[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    async function load() {
      const [{ data: list }, { data: rows }] = await Promise.all([
        supabase.rpc('get_shared_wishlist', { token }).maybeSingle(),
        supabase.rpc('get_shared_wishlist_items', { token }),
      ])

      if (cancelled) return
      setWishlist((list as SharedWishlistRow | null) ?? null)
      setItems((rows ?? []) as SharedItem[])
      setLoading(false)
    }

    load()
    return () => {
      cancelled = true
    }
  }, [token])

  if (loading) {
    return (
      <div className="shared-page">
        <p className="shared-status">Loading...</p>
      </div>
    )
  }

  if (!wishlist) {
    return (
      <div className="shared-page">
        <p className="shared-status">This link does not point to a wishlist anymore.</p>
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
          Sign in to reserve something
        </Link>
      </header>

      <div className="wl">
        <div className="wl-headline shared-headline">
          <h1 className="wl-title">{wishlist.name}</h1>

          {(wishlist.occasion || wishlist.target_date) && (
            <p className="wl-occasion">
              {wishlist.occasion}
              {wishlist.occasion && wishlist.target_date && ' · '}
              {wishlist.target_date && formatTargetDate(wishlist.target_date)}
            </p>
          )}

          {wishlist.description && <p className="wl-desc">{wishlist.description}</p>}
        </div>

        <ul className="wl-grid">
          {items.map((item) => (
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

                <span className={item.reserved ? 'wl-chip wl-chip--reserved' : 'wl-chip'}>
                  {item.reserved
                    ? 'Reserved'
                    : item.quantity > 1
                      ? `${item.quantity - item.claimed_quantity} of ${item.quantity} left`
                      : 'Available'}
                </span>

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
            </li>
          ))}

          {items.length === 0 && <li className="wl-empty">No wishes on this list yet.</li>}
        </ul>
      </div>
    </div>
  )
}

/**
 * Row shapes shared between the wishlist page and the modals it opens.
 *
 * They live here rather than in the page because the modals would otherwise
 * have to import from it, and the page imports them -- a cycle.
 */

export type WishItem = {
  item_id: string
  user_id: string
  name: string
  product_url: string | null
  image_url: string | null
  price: number | null
  notes: string | null
  purchased: boolean
  priority: number | null
  claimed_by: string | null
  claimed_at: string | null
  added_at: string
}

/** Every column the app reads back after writing an item. */
export const WISH_COLUMNS =
  'item_id, user_id, name, product_url, image_url, price, notes, purchased, priority, claimed_by, claimed_at, added_at'

export type WishlistMember = {
  member_id: string
  user_id: string
  username: string
  role: 'viewer' | 'editor'
}

export type Friend = {
  id: string
  username: string
}

export type Contribution = {
  contribution_id: string
  item_id: string
  user_id: string
  username: string
  amount: number
}

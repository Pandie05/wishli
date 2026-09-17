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
  /** how many the owner wants; who reserved how many lives in item_claims */
  quantity: number
  added_at: string
}

/** Every column the app reads back after writing an item. */
export const WISH_COLUMNS =
  'item_id, user_id, name, product_url, image_url, price, notes, purchased, priority, quantity, added_at'

export type ItemClaim = {
  claim_id: string
  item_id: string
  user_id: string
  username: string
  quantity: number
}

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

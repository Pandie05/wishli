import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAsyncAction } from '../lib/useAsyncAction'
import Modal from './Modal'
import type { WishlistRow } from './WishlistFormModal'

type Props = {
  open: boolean
  /** null while closed; the friend the list is being shared with */
  friend: { other_id: string; username: string } | null
  /** lists this account owns -- only an owner can add a member (see 004) */
  wishlists: WishlistRow[]
  /** every membership row this account can read, to mark lists they are on */
  memberships: { wishlist_id: string; user_id: string }[]
  onClose: () => void
  onChanged: () => void
}

/**
 * "Add @someone to a wishlist", opened from a friend's ⋯ menu. The friends
 * page is where you think about a person, so sharing from there saves opening
 * the list first and finding Manage people inside it -- it writes the same
 * wishlist_members row ManagePeopleModal does.
 */
export default function AddToWishlistModal({
  open,
  friend,
  wishlists,
  memberships,
  onClose,
  onChanged,
}: Props) {
  const { busy, error, run } = useAsyncAction()
  // which list is mid-write, so only that row's button says so
  const [pending, setPending] = useState<string | null>(null)

  const onList = new Set(
    memberships.filter((m) => m.user_id === friend?.other_id).map((m) => m.wishlist_id),
  )

  function add(wishlistId: string) {
    if (!friend || busy) return
    setPending(wishlistId)
    void run(async () =>
      supabase
        .from('wishlist_members')
        .insert({ wishlist_id: wishlistId, user_id: friend.other_id }),
    ).then((ok) => {
      setPending(null)
      if (ok) onChanged()
    })
  }

  function remove(wishlistId: string) {
    if (!friend || busy) return
    setPending(wishlistId)
    void run(async () =>
      supabase
        .from('wishlist_members')
        .delete()
        .eq('wishlist_id', wishlistId)
        .eq('user_id', friend.other_id),
    ).then((ok) => {
      setPending(null)
      if (ok) onChanged()
    })
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      eyebrow="Share a list"
      title={friend ? `Add @${friend.username} to a wishlist` : 'Add to a wishlist'}
      footer={
        <button type="button" onClick={onClose}>
          Done
        </button>
      }
    >
      {error && <p className="modal-error">{error}</p>}

      <div className="field-stack">
        <div className="field">
          <span className="field-label">Your wishlists</span>

          <ul className="fr-share-list">
            {wishlists.map((w) => {
              const member = onList.has(w.wishlist_id)
              const working = pending === w.wishlist_id

              return (
                <li key={w.wishlist_id} className="fr-share-row">
                  <span className="fr-share-name">{w.name}</span>
                  {member && <span className="fr-share-tag">shared</span>}

                  <span className="fr-share-actions">
                    {member ? (
                      <button
                        type="button"
                        onClick={() => remove(w.wishlist_id)}
                        disabled={busy}
                      >
                        {working ? 'Removing...' : 'Remove'}
                      </button>
                    ) : (
                      <button type="button" onClick={() => add(w.wishlist_id)} disabled={busy}>
                        {working ? 'Adding...' : 'Add'}
                      </button>
                    )}
                  </span>
                </li>
              )
            })}

            {wishlists.length === 0 && (
              <li className="fr-share-empty">You do not own a wishlist to share yet.</li>
            )}
          </ul>

          <p className="field-note">
            They join as a viewer, so they can reserve and pledge but not change what is on the
            list. Open the list itself to make someone an editor.
          </p>
        </div>
      </div>
    </Modal>
  )
}

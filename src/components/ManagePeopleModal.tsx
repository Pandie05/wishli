import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { initialsFor } from './AppShell'
import Modal from './Modal'
import type { Friend, WishlistMember } from '../lib/types'

type Props = {
  open: boolean
  wishlistId: string
  members: WishlistMember[]
  /** friends not already on the list */
  friends: Friend[]
  /** only the owner can add, remove or change roles */
  isOwner: boolean
  onClose: () => void
  onChanged: () => void
}

/**
 * Who can see this wishlist, and what they can do on it. Opened from the
 * FRIENDS group in the page header rather than living below the grid, so the
 * page itself stays as drawn.
 */
export default function ManagePeopleModal({
  open,
  wishlistId,
  members,
  friends,
  isOwner,
  onClose,
  onChanged,
}: Props) {
  const [adding, setAdding] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function run(work: () => Promise<{ error: { message: string } | null }>) {
    if (busy) return
    setBusy(true)
    setError(null)
    const { error: failure } = await work()
    setBusy(false)
    if (failure) {
      setError(failure.message)
      return
    }
    onChanged()
  }

  function addMember() {
    if (!adding) return
    void run(async () =>
      supabase.from('wishlist_members').insert({ wishlist_id: wishlistId, user_id: adding }),
    ).then(() => setAdding(''))
  }

  function setRole(member: WishlistMember, role: 'viewer' | 'editor') {
    // goes through the function rather than a direct update -- see
    // set_wishlist_member_role in 009
    void run(async () =>
      supabase.rpc('set_wishlist_member_role', {
        wishlist_id: wishlistId,
        user_id: member.user_id,
        role,
      }),
    )
  }

  function remove(member: WishlistMember) {
    void run(async () =>
      supabase.from('wishlist_members').delete().eq('member_id', member.member_id),
    )
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      eyebrow="Wishlist"
      title="Manage people"
      footer={
        <button type="button" onClick={onClose}>
          Done
        </button>
      }
    >
      {error && <p className="modal-error">{error}</p>}

      <div className="field-stack">
        {isOwner && (
          <div className="field">
            <span className="field-label">Add a friend</span>
            <div className="form-row">
              <select value={adding} onChange={(e) => setAdding(e.target.value)}>
                <option value="">
                  {friends.length ? 'Choose a friend' : 'no friends left to add'}
                </option>
                {friends.map((friend) => (
                  <option key={friend.id} value={friend.id}>
                    @{friend.username}
                  </option>
                ))}
              </select>
              <button type="button" onClick={addMember} disabled={!adding || busy}>
                Add
              </button>
            </div>
          </div>
        )}

        <div className="field">
          <span className="field-label">On this list</span>

          <ul className="people-list">
            {members.map((member) => (
              <li key={member.member_id} className="people-row">
                <span className="invite-avatar">{initialsFor(member.username)}</span>
                <span className="people-name">@{member.username}</span>
                <span className="people-role">{member.role}</span>

                {isOwner && (
                  <span className="people-actions">
                    <button
                      type="button"
                      onClick={() => setRole(member, member.role === 'editor' ? 'viewer' : 'editor')}
                      disabled={busy}
                    >
                      Make {member.role === 'editor' ? 'viewer' : 'editor'}
                    </button>
                    <button type="button" onClick={() => remove(member)} disabled={busy}>
                      Remove
                    </button>
                  </span>
                )}
              </li>
            ))}

            {members.length === 0 && (
              <li className="people-empty">Nobody else can see this list yet.</li>
            )}
          </ul>

          <p className="field-note">
            An editor can add and change wishes on this list. A viewer can reserve and pledge,
            but not change what is on it.
          </p>
        </div>
      </div>
    </Modal>
  )
}

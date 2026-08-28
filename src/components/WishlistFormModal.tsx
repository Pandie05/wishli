import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import FriendPicker from './FriendPicker'
import type { Friend } from './FriendPicker'
import ImageDrop from './ImageDrop'
import MoneyInput, { clampMoney } from './MoneyInput'
import Modal from './Modal'

export type WishlistRow = {
  wishlist_id: string
  /** the owner's user id -- wishlists.id, not the wishlist's own key */
  id: string
  name: string
  budget: number | null
  created_at: string
  purchase_visibility: 'full' | 'aggregate'
  item_img: string | null
  description: string | null
  occasion: string | null
  target_date: string | null
}

const COLUMNS =
  'wishlist_id, id, name, budget, created_at, purchase_visibility, item_img, description, occasion, target_date'

/** Free text in the database, so this list can change without a migration. */
const OCCASIONS = [
  'Birthday',
  'Christmas',
  'Wedding',
  'Anniversary',
  'Graduation',
  'Housewarming',
  'Baby shower',
  'Holiday',
  'Other',
]

const FORM_ID = 'wishlist-form'

type Props = {
  open: boolean
  userId: string | null
  /** present = edit that row, absent = create a new one */
  wishlist?: WishlistRow | null
  onClose: () => void
  onSaved: (wishlist: WishlistRow) => void
}

export default function WishlistFormModal({ open, userId, wishlist, onClose, onSaved }: Props) {
  const editing = !!wishlist
  const [name, setName] = useState('')
  const [cover, setCover] = useState<string | null>(null)
  const [description, setDescription] = useState('')
  const [occasion, setOccasion] = useState('')
  const [targetDate, setTargetDate] = useState('')
  const [budget, setBudget] = useState('')
  const [invited, setInvited] = useState<Friend[]>([])
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  // reset to the row being edited (or to blank) each time the modal opens
  useEffect(() => {
    if (!open) return
    setName(wishlist?.name ?? '')
    setCover(wishlist?.item_img ?? null)
    setDescription(wishlist?.description ?? '')
    setOccasion(wishlist?.occasion ?? '')
    setTargetDate(wishlist?.target_date ?? '')
    setBudget(wishlist?.budget != null ? clampMoney(String(wishlist.budget)) : '')
    setInvited([])
    setError(null)
  }, [open, wishlist])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting) return

    const trimmed = name.trim()
    if (!trimmed) {
      setError('give it a name')
      return
    }

    setError(null)
    setSubmitting(true)

    const values = {
      name: trimmed,
      budget: budget ? Number(budget) : null,
      item_img: cover,
      description: description.trim() || null,
      occasion: occasion || null,
      target_date: targetDate || null,
    }

    const query = editing
      ? supabase.from('wishlists').update(values).eq('wishlist_id', wishlist!.wishlist_id)
      : supabase.from('wishlists').insert({ ...values, id: userId })

    const { data, error: saveError } = await query.select(COLUMNS).single()

    if (saveError) {
      setSubmitting(false)
      setError(saveError.message)
      return
    }

    const saved = data as WishlistRow

    // members can only be added once the list exists, so this is a second
    // round trip rather than part of the insert above
    if (invited.length > 0) {
      const { error: inviteError } = await supabase.from('wishlist_members').insert(
        invited.map((friend) => ({
          wishlist_id: saved.wishlist_id,
          user_id: friend.id,
        })),
      )

      if (inviteError) {
        // the list itself saved, so say what did and did not happen rather
        // than leaving them to guess
        setSubmitting(false)
        setError(`Wishlist saved, but the invites failed: ${inviteError.message}`)
        onSaved(saved)
        return
      }
    }

    setSubmitting(false)
    onSaved(saved)
    onClose()
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      eyebrow={editing ? 'Edit wishlist' : 'New wishlist'}
      title={editing ? 'Edit wishlist' : 'Create a wishlist'}
      footer={
        <>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form={FORM_ID} disabled={submitting}>
            {submitting ? 'Saving...' : editing ? 'Save changes' : 'Create wishlist'}
          </button>
        </>
      }
    >
      {error && <p className="modal-error">{error}</p>}

      <form id={FORM_ID} className="field-stack" onSubmit={handleSubmit}>
        <div className="field">
          <span className="field-label">Cover image</span>
          <ImageDrop value={cover} onChange={setCover} userId={userId} onError={setError} />
        </div>

        <label className="field">
          <span className="field-label">Title</span>
          <input
            type="text"
            placeholder="e.g. Autumn Trip"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>

        <label className="field">
          <span className="field-label">Description (optional)</span>
          <textarea
            placeholder="What the list is for, and anything people should know before reserving."
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>

        <div className="field-row">
          <label className="field">
            <span className="field-label">Occasion</span>
            <select value={occasion} onChange={(e) => setOccasion(e.target.value)}>
              <option value="">No occasion</option>
              {OCCASIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span className="field-label">Target date</span>
            <input
              type="date"
              value={targetDate}
              onChange={(e) => setTargetDate(e.target.value)}
            />
          </label>
        </div>

        <label className="field">
          <span className="field-label">Budget (optional)</span>
          <MoneyInput placeholder="0.00" value={budget} onChange={setBudget} />
        </label>

        {/* the three-way control is drawn as designed, but only Private is
            real today: a list is visible to its owner and to the friends
            invited below it, and nothing else is wired to open it wider */}
        <div className="field">
          <span className="field-label">Privacy</span>
          <div className="segments">
            <button type="button" className="segment" aria-pressed={false} disabled>
              Friends only
            </button>
            <button type="button" className="segment" aria-pressed={false} disabled>
              Link only
            </button>
            <button type="button" className="segment" aria-pressed={true} disabled>
              Private
            </button>
          </div>
          <p className="field-note">
            Private to you and the friends you invite below. The other two modes are not
            available yet.
          </p>
        </div>

        <div className="field">
          <span className="field-label">Invite friends</span>
          <FriendPicker selected={invited} onChange={setInvited} />
        </div>
      </form>
    </Modal>
  )
}

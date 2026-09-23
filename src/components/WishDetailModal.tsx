import { useEffect, useState } from 'react'
import { money } from '../lib/format'
import { supabase } from '../lib/supabase'
import type { Contribution, ItemClaim, WishItem } from '../lib/types'
import { useAsyncAction } from '../lib/useAsyncAction'
import Modal from './Modal'
import MoneyInput from './MoneyInput'
import { PRIORITY_LABELS } from './PriorityPicker'
import Spinner from './Spinner'
// delete this line and src/css/wish-detail.css to revert the modal refresh
import '../css/wish-detail.css'

type Props = {
  item: WishItem | null
  open: boolean
  userId: string | null
  /** names for claimant / contributor ids, resolved by the page */
  names: Record<string, string>
  contributions: Contribution[]
  claims: ItemClaim[]
  /** the owner of an aggregate-visibility list must not see who did what */
  hideDetail: boolean
  canEdit: boolean
  /** the wishlist owner can't pledge toward their own wish -- RLS blocks it */
  isOwner: boolean
  onClose: () => void
  onChanged: () => void
  onEdit: () => void
  onDelete: () => void
}

/**
 * Everything about one wish that does not fit on its card: the picture and
 * notes, and the actions that used to sit inline on the list -- reserving it,
 * marking it bought, and pledging towards it.
 */
export default function WishDetailModal({
  item,
  open,
  userId,
  names,
  contributions,
  claims,
  hideDetail,
  canEdit,
  isOwner,
  onClose,
  onChanged,
  onEdit,
  onDelete,
}: Props) {
  const { busy, error, setError, run } = useAsyncAction()
  const [pledge, setPledge] = useState('')
  const [take, setTake] = useState('1')

  // the modal stays mounted between wishes, so without this the box would
  // still hold whatever was typed against the last item -- and someone who
  // already reserved 2 would see "1" and quietly drop to 1 by pressing Update
  const myClaimQuantity = claims.find((c) => c.user_id === userId)?.quantity ?? 0
  const openItemId = item?.item_id
  useEffect(() => {
    setTake(String(myClaimQuantity || 1))
  }, [openItemId, myClaimQuantity])

  if (!item) return null

  const mine = contributions.find((c) => c.user_id === userId)
  const pledged = contributions.reduce((sum, c) => sum + c.amount, 0)

  const myClaim = claims.find((c) => c.user_id === userId)
  const claimed = claims.reduce((sum, c) => sum + c.quantity, 0)
  const left = item.quantity - claimed
  // releasing your own claim frees it back up, so your ceiling includes it
  const mostICanTake = left + (myClaim?.quantity ?? 0)
  const multiple = item.quantity > 1
  // set_item_purchased raises 'claimed by someone else' in exactly this
  // state: you have no claim of your own and someone else has claimed part
  // of it. unmarking a purchase never hits that guard, so it's always allowed.
  const canMarkBought = item.purchased || claimed === 0 || Boolean(myClaim)

  function reserve(quantity: number) {
    if (!item || !userId || quantity < 1) return
    void run(async () =>
      supabase
        .from('item_claims')
        .upsert({ item_id: item.item_id, user_id: userId, quantity }, { onConflict: 'item_id,user_id' }),
    ).then((ok) => ok && onChanged())
  }

  function release() {
    if (!item || !userId) return
    void run(async () =>
      supabase.from('item_claims').delete().eq('item_id', item.item_id).eq('user_id', userId),
    ).then((ok) => ok && onChanged())
  }

  function togglePurchased() {
    if (!item) return
    void run(async () =>
      supabase.rpc('set_item_purchased', {
        item_id: item.item_id,
        purchased: !item.purchased,
      }),
    ).then((ok) => ok && onChanged())
  }

  function savePledge() {
    if (!item || !userId) return
    const amount = Number(pledge)
    if (!amount || amount <= 0) {
      setError('enter an amount to pledge')
      return
    }

    void run(async () =>
      supabase
        .from('item_contributions')
        .upsert(
          { item_id: item.item_id, user_id: userId, amount },
          { onConflict: 'item_id,user_id' },
        ),
    ).then((ok) => {
      if (ok) {
        setPledge('')
        onChanged()
      }
    })
  }

  function removePledge() {
    if (!item || !userId) return
    void run(async () =>
      supabase
        .from('item_contributions')
        .delete()
        .eq('item_id', item.item_id)
        .eq('user_id', userId),
    ).then((ok) => ok && onChanged())
  }

  function statusChip() {
    if (!item) return null
    if (item.purchased) return <span className="wl-chip wl-chip--bought">Bought</span>
    if (claimed >= item.quantity) {
      const solo = claims.length === 1 ? claims[0] : null
      return (
        <span className="wl-chip wl-chip--reserved">
          Reserved
          {solo
            ? solo.user_id === userId
              ? ' by you'
              : ` by ${solo.username || names[solo.user_id] || 'a friend'}`
            : ''}
        </span>
      )
    }
    if (claimed > 0) {
      return (
        <span className="wl-chip wl-chip--reserved">
          {claimed} of {item.quantity} reserved
        </span>
      )
    }
    return <span className="wl-chip">Available{multiple ? ` — ${item.quantity} wanted` : ''}</span>
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      eyebrow="Wish"
      title={item.name}
      footer={
        <>
          {canEdit && (
            <button type="button" className="modal-danger" onClick={onDelete}>
              Delete
            </button>
          )}
          <button type="button" onClick={onClose}>
            Close
          </button>
          {canEdit && (
            <button type="button" className="modal-primary" onClick={onEdit}>
              Edit wish
            </button>
          )}
        </>
      }
    >
      {error && <p className="modal-error">{error}</p>}

      <div className="wish-detail">
        {item.image_url && (
          <img src={item.image_url} alt="" className="wish-detail-image" />
        )}

        <div className="wish-detail-facts">
          {item.price != null && (
            <span className="wish-detail-price">{money(item.price)}</span>
          )}
          {multiple && <span className="wish-detail-tag">Wants {item.quantity}</span>}
          {item.priority != null && (
            <span className="wish-detail-tag">
              {item.priority} — {PRIORITY_LABELS[item.priority]}
            </span>
          )}
          {item.product_url && (
            <a
              className="wish-detail-link"
              href={item.product_url}
              target="_blank"
              rel="noreferrer noopener"
            >
              Open product page
            </a>
          )}
        </div>

        {item.notes && <p className="wish-detail-notes">{item.notes}</p>}

        {hideDetail ? (
          <p className="field-note">
            This list hides who reserved or bought what from you, so you get to be surprised.
          </p>
        ) : (
          <div className="wish-detail-actions">
            <div className="wish-detail-status">{statusChip()}</div>

            {multiple && claims.length > 0 && (
              <ul className="wish-detail-contribs">
                {claims.map((c) => (
                  <li key={c.claim_id}>
                    @{c.username || names[c.user_id] || 'someone'} — {c.quantity}
                  </li>
                ))}
              </ul>
            )}

            <div className="wish-detail-buttons">
              {multiple ? (
                <>
                  {mostICanTake > 0 && (
                    <>
                      {/* the max attribute does not stop anyone typing a
                          bigger number, so it is clamped here as well -- and
                          clamped in the field rather than silently at submit,
                          so what you press Reserve on is what you asked for */}
                      <input
                        type="number"
                        className="wish-detail-qty"
                        min={1}
                        max={mostICanTake}
                        value={take}
                        onChange={(e) => {
                          const typed = Number(e.target.value)
                          if (!e.target.value) {
                            setTake('')
                            return
                          }
                          setTake(String(Math.max(1, Math.min(typed, mostICanTake))))
                        }}
                        aria-label="How many to reserve"
                      />
                      <button
                        type="button"
                        onClick={() => reserve(Math.min(Number(take) || 1, mostICanTake))}
                        disabled={busy}
                      >
                        {busy && <Spinner />}
                        {myClaim ? 'Update' : 'Reserve'}
                      </button>
                      <span className="wish-detail-left">
                        {mostICanTake} left
                      </span>
                    </>
                  )}
                  {myClaim && (
                    <button type="button" onClick={release} disabled={busy}>
                      Release mine
                    </button>
                  )}
                </>
              ) : (
                (left > 0 || myClaim) && (
                  <button
                    type="button"
                    onClick={() => (myClaim ? release() : reserve(1))}
                    disabled={busy}
                  >
                    {busy && <Spinner />}
                    {myClaim ? 'Release' : 'Reserve this'}
                  </button>
                )
              )}

              {canMarkBought && (
                <button type="button" onClick={togglePurchased} disabled={busy}>
                  {item.purchased ? 'Mark not bought' : 'Mark bought'}
                </button>
              )}
            </div>

            <div className="wish-detail-pledges">
              <span className="field-label">
                Group pledges
                {pledged > 0 && (
                  <>
                    {' '}
                    — {money(pledged)}
                    {item.price != null ? ` of ${money(item.price)}` : ''}
                  </>
                )}
              </span>

              {item.price != null && pledged > 0 && (
                <div
                  className="wish-progress"
                  role="img"
                  aria-label={`${money(pledged)} pledged of ${money(item.price)}`}
                >
                  <span
                    className={
                      pledged >= item.price
                        ? 'wish-progress-fill wish-progress-fill--full'
                        : 'wish-progress-fill'
                    }
                    style={{ width: `${Math.min(100, (pledged / item.price) * 100)}%` }}
                  />
                </div>
              )}

              {contributions.length > 0 && (
                <ul className="wish-detail-contribs">
                  {contributions.map((c) => (
                    <li key={c.contribution_id}>
                      @{c.username} — {money(c.amount)}
                    </li>
                  ))}
                </ul>
              )}

              {/* RLS blocks the owner from pledging to their own wish -- see
                  the item_contributions insert policy in 009 */}
              {!isOwner && (
                <div className="wish-detail-pledge-form">
                  <MoneyInput
                    placeholder={mine ? String(mine.amount) : '0.00'}
                    value={pledge}
                    onChange={setPledge}
                  />
                  <button type="button" onClick={savePledge} disabled={busy}>
                    {mine ? 'Update' : 'Pledge'}
                  </button>
                  {mine && (
                    <button type="button" onClick={removePledge} disabled={busy}>
                      Remove
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}

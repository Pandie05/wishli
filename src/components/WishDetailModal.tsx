import { useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Contribution, WishItem } from '../lib/types'
import Modal from './Modal'
import MoneyInput from './MoneyInput'
import { PRIORITY_LABELS } from './PriorityPicker'
import Spinner from './Spinner'

type Props = {
  item: WishItem | null
  open: boolean
  userId: string | null
  /** names for claimant / contributor ids, resolved by the page */
  names: Record<string, string>
  contributions: Contribution[]
  /** the owner of an aggregate-visibility list must not see who did what */
  hideDetail: boolean
  canEdit: boolean
  onClose: () => void
  onChanged: () => void
  onEdit: () => void
  onDelete: () => void
}

function money(value: number): string {
  return `$${value.toLocaleString('en-US', {
    minimumFractionDigits: value % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })}`
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
  hideDetail,
  canEdit,
  onClose,
  onChanged,
  onEdit,
  onDelete,
}: Props) {
  const [busy, setBusy] = useState(false)
  const [pledge, setPledge] = useState('')
  const [error, setError] = useState<string | null>(null)

  if (!item) return null

  const mine = contributions.find((c) => c.user_id === userId)
  const pledged = contributions.reduce((sum, c) => sum + c.amount, 0)
  const claimedByMe = item.claimed_by === userId

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

  function toggleClaim() {
    if (!item) return
    void run(async () =>
      supabase.rpc('set_item_claimed', {
        item_id: item.item_id,
        claimed: !item.claimed_by,
      }),
    )
  }

  function togglePurchased() {
    if (!item) return
    void run(async () =>
      supabase.rpc('set_item_purchased', {
        item_id: item.item_id,
        purchased: !item.purchased,
      }),
    )
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
    ).then(() => setPledge(''))
  }

  function removePledge() {
    if (!item || !userId) return
    void run(async () =>
      supabase
        .from('item_contributions')
        .delete()
        .eq('item_id', item.item_id)
        .eq('user_id', userId),
    )
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
            <div className="wish-detail-status">
              {item.purchased ? (
                <span className="wl-chip wl-chip--bought">Bought</span>
              ) : item.claimed_by ? (
                <span className="wl-chip wl-chip--reserved">
                  Reserved{claimedByMe ? ' by you' : ` by ${names[item.claimed_by] ?? 'a friend'}`}
                </span>
              ) : (
                <span className="wl-chip">Available</span>
              )}
            </div>

            <div className="wish-detail-buttons">
              {(!item.claimed_by || claimedByMe) && (
                <button type="button" onClick={toggleClaim} disabled={busy}>
                  {busy && <Spinner />}
                  {item.claimed_by ? 'Release' : 'Reserve this'}
                </button>
              )}
              <button type="button" onClick={togglePurchased} disabled={busy}>
                {item.purchased ? 'Mark not bought' : 'Mark bought'}
              </button>
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

              {contributions.length > 0 && (
                <ul className="wish-detail-contribs">
                  {contributions.map((c) => (
                    <li key={c.contribution_id}>
                      @{c.username} — {money(c.amount)}
                    </li>
                  ))}
                </ul>
              )}

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
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}

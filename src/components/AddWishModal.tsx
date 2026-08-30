import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import ImageDrop from './ImageDrop'
import MoneyInput from './MoneyInput'
import Modal from './Modal'
import PriorityPicker from './PriorityPicker'
import Spinner from './Spinner'
import type { WishItem } from '../lib/types'
import type { WishlistRow } from './WishlistFormModal'

const FORM_ID = 'wish-form'

/** Loose enough to catch a pasted link, strict enough not to fire on prose. */
function looksLikeUrl(value: string): boolean {
  return /^https?:\/\/\S+\.\S+/i.test(value.trim())
}

type Props = {
  open: boolean
  userId: string | null
  wishlists: WishlistRow[]
  /** a link handed over from the dashboard's quick-add box */
  presetUrl?: string
  /** a list to start on, when opened from that list's own page */
  presetWishlistId?: string
  /** present = edit this wish rather than create a new one */
  item?: WishItem | null
  onClose: () => void
  /** there is nowhere to save a wish yet -- hand over to the wishlist modal */
  onNeedWishlist: () => void
  onSaved: (wishlistId: string) => void
}

/**
 * The add-a-wish form, lifted out of the wishlist page so it can run from
 * anywhere in the app. The only thing it adds over the in-page version is the
 * list picker -- opened from the nav there is no wishlist in context.
 */
export default function AddWishModal({
  open,
  userId,
  wishlists,
  presetUrl,
  presetWishlistId,
  item,
  onClose,
  onNeedWishlist,
  onSaved,
}: Props) {
  const [wishlistId, setWishlistId] = useState('')
  const [name, setName] = useState('')
  const [productUrl, setProductUrl] = useState('')
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [price, setPrice] = useState('')
  const [priority, setPriority] = useState<number | null>(null)
  const [notes, setNotes] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [fetching, setFetching] = useState(false)
  // the link read fine but Amazon does not give these up -- ask for them
  // rather than leaving empty fields that look like a failure
  const [askForPrice, setAskForPrice] = useState(false)
  const [askForImage, setAskForImage] = useState(false)
  // the last url actually looked up, so tabbing through the field does not
  // fire the same request again
  const fetchedRef = useRef('')

  useEffect(() => {
    if (!open) return
    setName(item?.name ?? '')
    setProductUrl(item?.product_url ?? presetUrl ?? '')
    fetchedRef.current = ''
    setImageUrl(item?.image_url ?? null)
    setPrice(item?.price != null ? String(item.price) : '')
    setPriority(item?.priority ?? null)
    setNotes(item?.notes ?? '')
    setError(null)
    setAskForPrice(false)
    setAskForImage(false)

    // a link handed over from the quick-add box starts reading immediately,
    // the same as pasting one in here would
    if (!item && presetUrl && looksLikeUrl(presetUrl)) void fillFromUrl(presetUrl)
    // fillFromUrl is stable in behaviour but redefined each render; depending
    // on it would reset the form on every keystroke
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, presetUrl, item])

  // keep the picker on a list that still exists -- the shell loads its
  // wishlists asynchronously, so the first render can have none
  useEffect(() => {
    if (!open) return
    if (wishlists.some((w) => w.wishlist_id === wishlistId)) return

    const preset = wishlists.find((w) => w.wishlist_id === presetWishlistId)
    // otherwise the most recent list you own -- you can always insert there,
    // whereas a shared list needs the editor role
    const mine = wishlists.find((w) => w.id === userId)
    setWishlistId((preset ?? mine ?? wishlists[0])?.wishlist_id ?? '')
  }, [open, wishlists, userId, wishlistId, presetWishlistId])

  /** Reads the link and fills in whatever it can. `override` lets a paste
   *  pass its own text, since state has not caught up at that point. */
  async function fillFromUrl(override?: string) {
    const url = (override ?? productUrl).trim()
    if (!url || fetching || url === fetchedRef.current) return

    fetchedRef.current = url
    setFetching(true)
    setError(null)

    const { data, error: fnError } = await supabase.functions.invoke('fetch-link-preview', {
      body: { url },
    })

    setFetching(false)

    if (fnError) {
      setError('could not fetch details for that link')
      return
    }

    if (data?.title && !name.trim()) setName(data.title)
    if (data?.price != null && !price) setPrice(String(data.price))
    if (data?.image && !imageUrl) setImageUrl(data.image)
    setAskForPrice(!!data?.priceUnavailable && !price)
    setAskForImage(!!data?.imageUnavailable && !imageUrl)
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting || !userId) return

    if (!wishlistId) {
      setError('make a wishlist first, then add wishes to it')
      return
    }

    const trimmed = name.trim()
    if (!trimmed) {
      setError('give it a name')
      return
    }

    setError(null)
    setSubmitting(true)

    const values = {
      name: trimmed,
      product_url: productUrl.trim() || null,
      image_url: imageUrl,
      price: price ? Number(price) : null,
      priority,
      notes: notes.trim() || null,
    }

    // the wishlist a wish belongs to is fixed once created -- moving one
    // between lists is not something the policies in 003/009 allow
    const { error: saveError } = item
      ? await supabase.from('items').update(values).eq('item_id', item.item_id)
      : await supabase
          .from('items')
          .insert({ ...values, wishlist_id: wishlistId, user_id: userId })

    setSubmitting(false)

    if (saveError) {
      setError(saveError.message)
      return
    }

    onSaved(wishlistId)
    onClose()
  }

  const hasWishlists = wishlists.length > 0

  if (!hasWishlists && !item) {
    return (
      <Modal
        open={open}
        onClose={onClose}
        eyebrow="New wish"
        title="Make a wishlist first"
        footer={
          <>
            <button type="button" onClick={onClose}>
              Cancel
            </button>
            <button type="button" className="modal-primary" onClick={onNeedWishlist}>
              Create a wishlist
            </button>
          </>
        }
      >
        <div className="modal-empty">
          <span className="modal-empty-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M4 6h16M4 12h10M4 18h7" strokeLinecap="round" />
              <path d="M17.5 14.5v6M14.5 17.5h6" strokeLinecap="round" />
            </svg>
          </span>
          <p className="modal-empty-lead">Wishes live inside a wishlist.</p>
          <p className="modal-empty-note">
            You do not have one yet, so there is nowhere to save this to. Create your first
            wishlist and we will bring you straight back here to finish adding the wish.
          </p>
        </div>
      </Modal>
    )
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      eyebrow={item ? 'Edit wish' : 'New wish'}
      title={item ? 'Edit a wish' : 'Add a wish'}
      footer={
        <>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form={FORM_ID} disabled={submitting}>
            {submitting ? 'Saving...' : item ? 'Save changes' : 'Save wish'}
          </button>
        </>
      }
    >
      {error && <p className="modal-error">{error}</p>}

      <form id={FORM_ID} className="field-stack" onSubmit={handleSubmit}>
        <label className="field">
          <span className="field-label">Product URL</span>
          <span className="field-affix" data-busy={fetching ? 'true' : undefined}>
            <input
              className="field-paste"
              type="url"
              placeholder="Paste a URL and we'll fill the rest."
              value={productUrl}
              onChange={(e) => setProductUrl(e.target.value)}
              onPaste={(e) => {
                // the input's value has not updated yet, so read the pasted
                // text straight off the clipboard and hand it over
                const pasted = e.clipboardData.getData('text')
                if (looksLikeUrl(pasted)) void fillFromUrl(pasted)
              }}
              onBlur={() => void fillFromUrl()}
            />
            {fetching && <Spinner label="Reading the link" />}
          </span>
          {fetching && <p className="field-note">Reading the page for a name, price and image...</p>}
        </label>

        <span className="field-divider">or enter manually</span>

        <div className="field">
          <span className="field-label">Product image</span>
          <ImageDrop
            value={imageUrl}
            onChange={(next) => {
              setImageUrl(next)
              if (next) setAskForImage(false)
            }}
            userId={userId}
            onError={setError}
          />
          {askForImage && !imageUrl && (
            <p className="field-note">We could not find a picture for this one — add your own.</p>
          )}
        </div>

        <label className="field">
          <span className="field-label">Wish name</span>
          <input
            type="text"
            placeholder="e.g. Linen oversized"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>

        <div className="field-row">
          <label className="field">
            <span className="field-label">Wish price</span>
            <MoneyInput
              placeholder="$0.00"
              value={price}
              onChange={(next) => {
                setPrice(next)
                if (next) setAskForPrice(false)
              }}
            />
            {askForPrice && !price && (
              <p className="field-note">No price on the listing — add one here.</p>
            )}
          </label>

          <label className="field">
            <span className="field-label">Wishlist</span>
            <select
              value={wishlistId}
              onChange={(e) => setWishlistId(e.target.value)}
              disabled={!!item}
            >
              {wishlists.map((w) => (
                <option key={w.wishlist_id} value={w.wishlist_id}>
                  {w.name}
                  {w.id === userId ? '' : ' (shared)'}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="field">
          <span className="field-label">Priority</span>
          <PriorityPicker value={priority} onChange={setPriority} />
        </div>

        <label className="field">
          <span className="field-label">Note</span>
          <textarea
            placeholder="Size M, Blue or Red..."
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </label>
      </form>
    </Modal>
  )
}

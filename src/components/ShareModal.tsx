import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import Modal from './Modal'

type Props = {
  open: boolean
  /** the wishlist's name, for the "point a phone at this" line */
  title: string
  /** null while the token is still being created */
  url: string | null
  onClose: () => void
}

/**
 * The read-only link to a wishlist, as something you can copy and as a code
 * a phone can read off a screen -- the point being that a room full of people
 * can open the list without anyone typing a URL.
 */
export default function ShareModal({ open, title, url, onClose }: Props) {
  const [qr, setQr] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!open || !url) return

    let cancelled = false
    // blank rather than briefly showing the previous wishlist's code
    setQr(null)
    QRCode.toDataURL(url, {
      width: 512,
      margin: 1,
      color: { dark: '#101a33', light: '#ffffff' },
    })
      .then((data) => {
        if (!cancelled) setQr(data)
      })
      .catch(() => {
        if (!cancelled) setQr(null)
      })

    return () => {
      cancelled = true
    }
  }, [open, url])

  async function copy() {
    if (!url) return
    await navigator.clipboard.writeText(url)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      eyebrow="Share"
      title="Anyone with this link"
      footer={
        <>
          <button type="button" onClick={onClose}>
            Done
          </button>
          <button type="button" className="modal-primary" onClick={copy} disabled={!url}>
            {copied ? 'Copied!' : 'Copy link'}
          </button>
        </>
      }
    >
      <div className="share">
        {qr ? (
          <img className="share-qr" src={qr} alt={`QR code linking to ${title}`} />
        ) : (
          <div className="share-qr share-qr--empty" />
        )}

        <input className="share-url" type="text" readOnly value={url ?? ''} onFocus={(e) => e.target.select()} />

        <p className="field-note">
          Read-only: they can see the list and what is left, but reserving something still
          needs an account. Point a phone camera at the code to open it.
        </p>

        {qr && (
          <a className="share-save" href={qr} download="wishli-share-code.png">
            Save the code as an image
          </a>
        )}
      </div>
    </Modal>
  )
}

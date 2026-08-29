import type { ReactNode } from 'react'
import Modal from './Modal'

type Props = {
  open: boolean
  /** small uppercase kicker, e.g. "delete wishlist" */
  eyebrow?: string
  title: string
  /** what is about to happen, and what it takes with it */
  children: ReactNode
  confirmLabel: string
  busy?: boolean
  onConfirm: () => void
  onClose: () => void
}

/**
 * Replaces window.confirm for destructive actions. The confirm button is the
 * danger colour rather than the usual accent, and Cancel keeps the neutral
 * treatment, so the safe option is the one that looks ordinary.
 */
export default function ConfirmModal({
  open,
  eyebrow,
  title,
  children,
  confirmLabel,
  busy,
  onConfirm,
  onClose,
}: Props) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      eyebrow={eyebrow}
      title={title}
      footer={
        <>
          <button type="button" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="modal-danger" onClick={onConfirm} disabled={busy}>
            {busy ? 'Deleting...' : confirmLabel}
          </button>
        </>
      }
    >
      <div className="modal-empty">
        <span className="modal-empty-icon modal-empty-icon--danger" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M4 7h16M10 11v6M14 11v6" strokeLinecap="round" />
            <path
              d="M6 7l1 12.5a1.5 1.5 0 0 0 1.5 1.5h7a1.5 1.5 0 0 0 1.5-1.5L18 7M9.5 7V4.5A1.5 1.5 0 0 1 11 3h2a1.5 1.5 0 0 1 1.5 1.5V7"
              strokeLinejoin="round"
            />
          </svg>
        </span>
        {children}
      </div>
    </Modal>
  )
}

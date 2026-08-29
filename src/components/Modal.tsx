import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import '../css/modal.css'

/** Fallback if --modal-motion cannot be read for any reason. */
const FALLBACK_MS = 180

/**
 * How long to keep a dismissed modal mounted. Read from --modal-motion rather
 * than hardcoded, so the timing lives in exactly one place -- if the CSS
 * duration changes this follows it instead of silently cutting the animation
 * short. The small buffer covers rounding, so the unmount always lands after
 * the last frame rather than clipping it.
 */
function exitDuration(): number {
  // no point holding a dismissed modal on screen for someone who has asked
  // for no motion -- the animation is suppressed for them anyway
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return 0

  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue('--modal-motion')
    .trim()

  const ms = raw.endsWith('ms')
    ? parseFloat(raw)
    : raw.endsWith('s')
      ? parseFloat(raw) * 1000
      : NaN

  return (Number.isFinite(ms) ? ms : FALLBACK_MS) + 40
}

type ModalProps = {
  open: boolean
  onClose: () => void
  /** small uppercase kicker above the title, e.g. "new wish" */
  eyebrow?: string
  title: string
  children: ReactNode
  /** buttons for the footer bar; the "esc to close" hint is added here */
  footer?: ReactNode
}

export default function Modal({ open, onClose, eyebrow, title, children, footer }: ModalProps) {
  // `open` going false starts the exit animation; the modal stays mounted
  // until it has finished, which is what `mounted` tracks
  const [mounted, setMounted] = useState(open)
  const [closing, setClosing] = useState(false)

  useEffect(() => {
    if (open) {
      setMounted(true)
      setClosing(false)
      return
    }

    if (!mounted) return

    setClosing(true)
    const timer = window.setTimeout(() => {
      setMounted(false)
      setClosing(false)
    }, exitDuration())

    // reopening mid-exit cancels the unmount rather than letting it fire late
    return () => window.clearTimeout(timer)
  }, [open, mounted])

  useEffect(() => {
    if (!open) return

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [open, onClose])

  if (!mounted) return null

  return (
    <div
      className="modal-backdrop"
      data-closing={closing ? 'true' : undefined}
      onClick={onClose}
    >
      <div
        className="modal-panel"
        data-closing={closing ? 'true' : undefined}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <div>
            {eyebrow && <p className="modal-eyebrow">{eyebrow}</p>}
            <h2>{title}</h2>
          </div>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
            &times;
          </button>
        </div>

        <div className="modal-body">{children}</div>

        {footer && (
          <div className="modal-foot">
            <span className="modal-hint">Esc to close</span>
            <div className="modal-actions">{footer}</div>
          </div>
        )}
      </div>
    </div>
  )
}

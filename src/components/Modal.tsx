import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import '../css/modal.css'

/** Fallback if --modal-motion cannot be read for any reason. */
const FALLBACK_MS = 140

/** Everything inside the panel a Tab can land on. */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

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
  const panelRef = useRef<HTMLDivElement | null>(null)
  // whatever had focus before this opened, so it can be handed back
  const returnFocusRef = useRef<HTMLElement | null>(null)

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

  /**
   * Move focus into the dialog on open and hand it back on close. Without
   * this, opening a modal left focus on the button behind it -- so a keyboard
   * user's next Tab went into the page underneath rather than into the form
   * they had just opened, and closing left them back at the top of the
   * document with no idea where they were.
   */
  useEffect(() => {
    if (!open) return

    returnFocusRef.current = document.activeElement as HTMLElement | null

    const panel = panelRef.current
    const first = panel?.querySelector<HTMLElement>(FOCUSABLE)
    ;(first ?? panel)?.focus()

    return () => returnFocusRef.current?.focus?.()
  }, [open])

  useEffect(() => {
    if (!open) return

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose()
        return
      }

      if (event.key !== 'Tab') return

      // aria-modal tells a screen reader the rest of the page is inert, but
      // it does nothing to the tab order -- that has to be done by hand
      const panel = panelRef.current
      if (!panel) return

      const items = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)]
      if (items.length === 0) return

      const first = items[0]
      const last = items[items.length - 1]
      const active = document.activeElement

      if (event.shiftKey && (active === first || !panel.contains(active))) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && active === last) {
        event.preventDefault()
        first.focus()
      }
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
        ref={panelRef}
        className="modal-panel"
        data-closing={closing ? 'true' : undefined}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        /* -1 so the panel can take focus itself if it holds no controls,
           without ever entering the tab order */
        tabIndex={-1}
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

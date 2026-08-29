import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { useLocation, useOutlet } from 'react-router-dom'

type Slot = { key: string; node: ReactNode }

/** How long the outgoing page stays mounted -- matches .page--out's
 *  animation in app-shell.css, which finishes well before the incoming one. */
const DURATION = 200

/**
 * Slides one routed page out to the left as the next comes in from the right.
 *
 * The trick is useOutlet() rather than <Outlet />. <Outlet /> is a single
 * element that reads the current route out of context, so holding on to it
 * would render the *new* page in both slots. useOutlet() hands back the
 * concrete element for whichever route is current, already carrying its own
 * route context, so a copy kept in state goes on rendering the old page (with
 * its own params) for as long as it is still on screen.
 *
 * Keeping that copy in state rather than a ref matters under StrictMode:
 * adjusting state during render is replayed safely on the double invocation,
 * where a ref written during render would not be. Holding a stale element is
 * fine -- if the page updates its own state React re-renders it in place, and
 * the identical element reference here just makes React skip the subtree.
 */
export default function PageTransition() {
  const location = useLocation()
  const outlet = useOutlet()

  const [shown, setShown] = useState<Slot>({ key: location.pathname, node: outlet })
  const [outgoing, setOutgoing] = useState<Slot | null>(null)

  // adjusted during render, not in an effect, so both pages are committed in
  // the same paint -- an effect would show one frame of the new page sitting
  // still before the animation began
  if (shown.key !== location.pathname) {
    setOutgoing(shown)
    setShown({ key: location.pathname, node: outlet })
  }

  useEffect(() => {
    if (!outgoing) return
    const timer = window.setTimeout(() => setOutgoing(null), DURATION)
    return () => window.clearTimeout(timer)
  }, [outgoing])

  return (
    <div className="page-stack">
      {outgoing && (
        <div key={outgoing.key} className="page page--out" aria-hidden="true">
          {outgoing.node}
        </div>
      )}
      <div key={location.pathname} className="page page--in">
        {outlet}
      </div>
    </div>
  )
}

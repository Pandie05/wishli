import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { initialsFor } from './AppShell'

export type Friend = { id: string; username: string }

type Props = {
  selected: Friend[]
  onChange: (friends: Friend[]) => void
}

/**
 * Type-ahead over people you are already friends with, backed by the
 * search_friends function in 011. That function is security definer but can
 * only return accepted friends, so it is not a way to enumerate accounts.
 */
export default function FriendPicker({ selected, onChange }: Props) {
  const [term, setTerm] = useState('')
  const [results, setResults] = useState<Friend[]>([])
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const query = term.trim()
    if (!query) {
      setResults([])
      return
    }

    // debounced so a fast typist does not fire a request per keystroke
    let cancelled = false
    const timer = window.setTimeout(async () => {
      const { data } = await supabase.rpc('search_friends', { term: query })
      if (!cancelled) setResults((data as Friend[]) ?? [])
    }, 200)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [term])

  function add(friend: Friend) {
    if (!selected.some((f) => f.id === friend.id)) onChange([...selected, friend])
    setTerm('')
    setResults([])
    setOpen(false)
  }

  const unpicked = results.filter((r) => !selected.some((f) => f.id === r.id))

  return (
    <div className="invite">
      <input
        type="text"
        placeholder="Search by name or @handle"
        value={term}
        onChange={(e) => {
          setTerm(e.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        // a click on a result must land before the list closes
        onBlur={() => window.setTimeout(() => setOpen(false), 120)}
      />

      {open && term.trim() !== '' && (
        <div className="invite-results">
          {unpicked.map((friend) => (
            <button
              key={friend.id}
              type="button"
              className="invite-result"
              onClick={() => add(friend)}
            >
              <span className="invite-avatar">{initialsFor(friend.username)}</span>@{friend.username}
            </button>
          ))}

          {unpicked.length === 0 && (
            <button type="button" className="invite-result" disabled>
              no friends match that
            </button>
          )}
        </div>
      )}

      {selected.length > 0 && (
        <div className="invite-chips">
          {selected.map((friend) => (
            <span key={friend.id} className="invite-chip">
              @{friend.username}
              <button
                type="button"
                aria-label={`Remove ${friend.username}`}
                onClick={() => onChange(selected.filter((f) => f.id !== friend.id))}
              >
                &times;
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * Shared between the dashboard card, the wishlist header, and the "Upcoming"
 * sort -- all three need the same notion of how far off a target_date is.
 */

function startOfToday(): Date {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return today
}

/** Whole days from today to the date, negative if it has already passed. */
export function daysUntil(dateStr: string | null): number {
  if (!dateStr) return Infinity
  const target = new Date(`${dateStr}T00:00:00`)
  return Math.round((target.getTime() - startOfToday().getTime()) / 86_400_000)
}

/** "today" / "tomorrow" / "in 5 days" / "3 days ago" / "Dec 12" once it is more than a week off either way. */
export function formatTargetDate(dateStr: string): string {
  const days = daysUntil(dateStr)

  if (days === 0) return 'today'
  if (days === 1) return 'tomorrow'
  if (days === -1) return 'yesterday'
  if (days > 1 && days <= 7) return `in ${days} days`
  if (days < -1 && days >= -7) return `${-days} days ago`

  return new Date(`${dateStr}T00:00:00`).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  })
}

/**
 * "just now" / "12m" / "5h" / "3d" / "Dec 12" for a full timestamp. Unlike
 * the functions above this takes an instant, not a calendar day, so it reads
 * the time of day too -- a notification from an hour ago and one from this
 * morning are both "today" but should not say the same thing.
 */
export function timeAgo(iso: string): string {
  const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000)

  if (seconds < 60) return 'just now'

  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m`

  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h`

  const days = Math.round(hours / 24)
  if (days < 7) return `${days}d`

  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

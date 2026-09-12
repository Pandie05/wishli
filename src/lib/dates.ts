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

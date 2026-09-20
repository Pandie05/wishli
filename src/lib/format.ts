import type { CSSProperties } from 'react'

/** "$12" for a whole number, "$12.50" once there's a fraction. */
export function money(value: number): string {
  return `$${value.toLocaleString('en-US', {
    minimumFractionDigits: value % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })}`
}

/**
 * A stable blue-family gradient derived from an id, for a wishlist cover
 * that has no image of its own. Same id always produces the same two colors,
 * so a list's card looks the same on the dashboard, its own page, and a
 * public profile without anything being stored for it.
 */
export function coverGradient(id: string): CSSProperties {
  let hash = 0
  for (let i = 0; i < id.length; i += 1) hash = (hash * 31 + id.charCodeAt(i)) >>> 0
  const hue = 198 + (hash % 31) // 198-228deg: the mockup's art is all blue
  return {
    '--cover-a': `hsl(${hue} 30% 27%)`,
    '--cover-b': `hsl(${(hue + 14) % 360} 34% 63%)`,
  } as CSSProperties
}

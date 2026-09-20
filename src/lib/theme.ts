/**
 * Theme preference.
 *
 * Three choices are offered but only two ever reach the stylesheet: "system"
 * is resolved here and written out as a concrete light/dark value on <html>.
 * That is what lets index.css carry a single `:root[data-theme='dark']` block
 * instead of repeating the whole palette for a prefers-color-scheme query and
 * again for a manual override -- and it removes any chance of the two
 * disagreeing about which one wins.
 *
 * The matching inline script in index.html does the same thing before first
 * paint, so the page never flashes light before React has started.
 */

export type ThemeChoice = 'system' | 'light' | 'dark'

const STORAGE_KEY = 'wishli-theme'

export function getThemeChoice(): ThemeChoice {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored === 'light' || stored === 'dark' || stored === 'system') return stored
  } catch {
    // private browsing and blocked site data both throw rather than return null
  }
  return 'system'
}

function systemPrefersDark(): boolean {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false
}

export function resolveTheme(choice: ThemeChoice): 'light' | 'dark' {
  if (choice === 'system') return systemPrefersDark() ? 'dark' : 'light'
  return choice
}

function apply(choice: ThemeChoice): void {
  document.documentElement.dataset.theme = resolveTheme(choice)
}

export function setThemeChoice(choice: ThemeChoice): void {
  try {
    localStorage.setItem(STORAGE_KEY, choice)
  } catch {
    // the choice still applies for this visit, it just will not be remembered
  }
  apply(choice)
}

/**
 * Follow the OS while the preference is "system". Returns the unsubscribe so
 * React can clean it up.
 */
export function watchSystemTheme(): () => void {
  const query = window.matchMedia?.('(prefers-color-scheme: dark)')
  if (!query) return () => {}

  const onChange = () => {
    if (getThemeChoice() === 'system') apply('system')
  }

  query.addEventListener('change', onChange)
  return () => query.removeEventListener('change', onChange)
}

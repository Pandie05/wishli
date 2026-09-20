import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !anonKey) {
  throw new Error(
    'Missing Supabase environment variables. Copy .env.example to .env and fill in VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY, then restart the dev server.',
  )
}

/**
 * "Remember me" decides *where* the session lives, not whether there is one:
 *
 *   on  -> localStorage,   survives closing the browser (stay logged in)
 *   off -> sessionStorage, dies with the tab
 *
 * Supabase only takes a single storage object, so the adapter below reads the
 * flag on every write and routes accordingly. Reads check both stores because
 * a session written before the flag changed can be sitting in either one.
 */
const REMEMBER_KEY = 'wishli.remember-me'

/** Private-mode browsers can throw on any storage access, so everything guards. */
function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn()
  } catch {
    return fallback
  }
}

/** Defaults to on -- the old behaviour, before the checkbox existed. */
export function getRememberMe(): boolean {
  return safe(() => window.localStorage.getItem(REMEMBER_KEY) !== 'false', true)
}

/**
 * Call this *before* signing in so the new session lands in the right store.
 * Any session already on the device is moved across too, which covers a user
 * who unticks the box while still logged in from a previous visit.
 */
export function setRememberMe(remember: boolean): void {
  safe(() => {
    window.localStorage.setItem(REMEMBER_KEY, remember ? 'true' : 'false')

    const from = remember ? window.sessionStorage : window.localStorage
    const to = remember ? window.localStorage : window.sessionStorage

    for (const key of Object.keys(from)) {
      if (key === REMEMBER_KEY || !key.startsWith('sb-')) continue
      const value = from.getItem(key)
      if (value === null) continue
      to.setItem(key, value)
      from.removeItem(key)
    }
  }, undefined)
}

const storage = {
  getItem(key: string): string | null {
    return safe(
      () => window.sessionStorage.getItem(key) ?? window.localStorage.getItem(key),
      null,
    )
  },
  setItem(key: string, value: string): void {
    safe(() => {
      const remember = getRememberMe()
      // Drop the copy in the other store first, or getItem could later find a
      // stale token that outranks this one.
      ;(remember ? window.sessionStorage : window.localStorage).removeItem(key)
      ;(remember ? window.localStorage : window.sessionStorage).setItem(key, value)
    }, undefined)
  },
  removeItem(key: string): void {
    safe(() => {
      window.localStorage.removeItem(key)
      window.sessionStorage.removeItem(key)
    }, undefined)
  },
}

export const supabase = createClient(url, anonKey, {
  auth: {
    storage,
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
})

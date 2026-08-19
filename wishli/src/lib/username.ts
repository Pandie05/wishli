import { supabase } from './supabase'

// Mirrors the check constraints on public.users so bad input is caught before
// it becomes an opaque database error.
export const USERNAME_PATTERN = /^[A-Za-z0-9_.]+$/
export const USERNAME_TAKEN = 'That username is already taken.'

export function validateUsername(username: string): string | null {
  if (username.length < 3 || username.length > 30)
    return 'Username must be 3 to 30 characters.'
  if (!USERNAME_PATTERN.test(username))
    return 'Username can only use letters, numbers, dots and underscores.'
  return null
}

/**
 * `email_for_login` matches on username OR email. Usernames cannot contain an
 * "@" (see USERNAME_PATTERN), so a hit here can only mean the username itself
 * is taken. Reusing it saves adding a second database function.
 *
 * This is only for a friendly error message — the unique index on
 * lower(username) is what actually prevents a duplicate, since another signup
 * could land between this check and the insert.
 */
export async function usernameTaken(username: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('email_for_login', {
    identifier: username,
  })

  if (error) throw error
  return data != null
}

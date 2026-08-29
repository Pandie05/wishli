/**
 * Turns a Supabase error into something worth showing.
 *
 * The case worth calling out is a missing column: PostgREST rejects the whole
 * query, the client gets null rows, and without this the page just renders as
 * if you owned nothing. That is nearly always a migration in sql-queries/
 * that has not been run yet, so the message says so.
 */
export function describeError(error: { message: string } | null | undefined): string | null {
  if (!error) return null

  if (/column .* does not exist/i.test(error.message)) {
    return `${error.message} — this usually means a migration in sql-queries/ has not been run on the database yet.`
  }

  return error.message
}

import { useCallback, useState } from 'react'
import { describeError } from './errors'

type Result = { error: { message: string } | null }

/**
 * The busy/error/mutation pattern every action modal needs: guard against a
 * double-submit, surface the error through describeError, and let the caller
 * know whether it actually worked. Returning success/failure (instead of
 * quietly resolving either way) is what lets a caller only clear its own
 * input, or fire its own onChanged, when the mutation actually succeeded.
 */
export function useAsyncAction() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = useCallback(async (work: () => Promise<Result>): Promise<boolean> => {
    if (busy) return false
    setBusy(true)
    setError(null)
    const { error: failure } = await work()
    setBusy(false)
    if (failure) {
      setError(describeError(failure))
      return false
    }
    return true
  }, [busy])

  return { busy, error, setError, run }
}

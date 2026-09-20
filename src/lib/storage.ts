/**
 * Cleaning up after ImageDrop.
 *
 * Uploads used to be one-way: every picture ever chosen stayed in the bucket
 * forever, including ones replaced a second later or attached to things that
 * were then deleted. Nothing referenced them again and nothing removed them,
 * so the bucket only ever grew.
 *
 * Every call here is best-effort on purpose. The storage policy from 011 only
 * lets you delete inside your own folder, so an owner clearing out a wishlist
 * cannot remove a picture an editor uploaded -- and a failure to tidy up must
 * never stop the delete or save the person actually asked for.
 */

import { supabase } from './supabase'

const BUCKET = 'wishli-images'

/**
 * Public URLs look like
 *   https://<project>.supabase.co/storage/v1/object/public/wishli-images/<uid>/<file>
 * and the bucket API wants everything after the bucket name. Anything that is
 * not one of our own public URLs (a pasted link from a shop, say) returns null
 * and is left alone.
 */
export function storagePathFromUrl(url: string | null | undefined): string | null {
  if (!url) return null
  const marker = `/${BUCKET}/`
  const at = url.indexOf(marker)
  if (at === -1) return null

  const path = url.slice(at + marker.length).split('?')[0]
  return path || null
}

/** Removes whichever of these are images we uploaded. Never throws. */
export async function deleteStoredImages(urls: (string | null | undefined)[]): Promise<void> {
  const paths = [...new Set(urls.map(storagePathFromUrl).filter((p): p is string => !!p))]
  if (paths.length === 0) return

  try {
    await supabase.storage.from(BUCKET).remove(paths)
  } catch {
    // an orphaned file is not worth surfacing to the person deleting something
  }
}

/**
 * For a form that may have uploaded a picture and then been cancelled: drop
 * the new one only if it is genuinely new, so cancelling out of an edit never
 * deletes the picture the item is still using.
 */
export async function discardUnsavedImage(
  current: string | null,
  original: string | null,
): Promise<void> {
  if (!current || current === original) return
  await deleteStoredImages([current])
}
